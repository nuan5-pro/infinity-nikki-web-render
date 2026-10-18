import { DataArrayTexture, DataTexture, Texture, type WebGLRenderer } from 'three';
import type {
	FurnitureAsset,
	FurnitureDB,
	FurniturePackedResource,
	FurnitureRawReference,
	FurnitureTextureResource,
	ModelAssetProfile,
} from '../furniture/types.js';
import { AssetLeaseCache, type AssetLease } from './leaseCache.js';
import {
	furnitureAssetDigest,
	furnitureAssetKey,
	furnitureAssetUrl,
	validatePackedResource,
} from '../furniture/manifest.js';
import { ImageBitmapSource } from './imageBitmapSource.js';
import { ImagePixelDecoder, type ImagePixels } from './imagePixels.js';

export interface FurnitureResourceReader {
	readonly renderer?: WebGLRenderer;
	read(reference: FurnitureRawReference): Promise<Uint8Array>;
	texture(key: string, load: () => Promise<Texture>): Promise<Texture>;
}

const closedImages = new WeakSet<object>();

async function contentSHA256(data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export class FurnitureResourceCache {
	readonly binaries = new AssetLeaseCache<ArrayBuffer>(() => {}, true);
	readonly members = new AssetLeaseCache<Uint8Array<ArrayBuffer>>(() => {}, true);
	readonly images = new AssetLeaseCache<Texture>(disposeSourceTexture);
	readonly paperArrays = new AssetLeaseCache<Texture>(disposeSourceTexture);
	readonly pixels = new AssetLeaseCache<ImagePixels>(() => {});
	readonly pixelDecoder = new ImagePixelDecoder();

	clearUnused(): void {
		this.paperArrays.clearUnused();
		this.images.clearUnused();
		this.pixels.clearUnused();
		this.members.clearUnused();
		this.binaries.clearUnused();
	}

	dispose(): void {
		this.paperArrays.clear();
		this.images.clear();
		this.pixels.clear();
		this.pixelDecoder.dispose();
		this.members.clear();
		this.binaries.clear();
	}
}

export function disposeSourceTexture(texture: Texture): void {
	texture.dispose();

	const image = texture.source.data as { close?: () => void } | undefined;
	if (image && typeof image.close === 'function' && !closedImages.has(image)) {
		closedImages.add(image);
		image.close();
	}
}

export async function fetchFurnitureAsset(asset: FurnitureAsset, signal: AbortSignal, baseUrl: string): Promise<ArrayBuffer> {
	const url = furnitureAssetUrl(baseUrl, asset);
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`[Furniture] ${asset.path}: HTTP ${response.status}`);

	const data = await response.arrayBuffer();
	if (signal.aborted) throw new Error('[Furniture] Resource lease expired');
	if (data.byteLength !== asset.bytes) throw new Error(`[Furniture] ${asset.path}: byte length changed`);

	const hash = await contentSHA256(data);
	if (!hash.startsWith(furnitureAssetDigest(asset))) throw new Error(`[Furniture] ${asset.path}: content digest changed`);
	if (signal.aborted) throw new Error('[Furniture] Resource lease expired');

	return data;
}

async function decodeImage(data: Uint8Array<ArrayBuffer>, mimeType: string): Promise<Texture> {
	const image = await createImageBitmap(new Blob([data], { type: mimeType }), {
		premultiplyAlpha: 'none',
		colorSpaceConversion: 'none',
	});
	const texture = new Texture(image);
	texture.source = new ImageBitmapSource(image);
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}

/** Share immutable image sources and complete arrays; sampler clones stay local. */
export class FurnitureResources implements FurnitureResourceReader {
	private textures = new AssetLeaseCache<Texture>(disposeSourceTexture);
	private memberLeases = new Set<AssetLease<Uint8Array<ArrayBuffer>>>();
	private binaryLeases = new Map<string, AssetLease<ArrayBuffer>>();
	private textureLeases = new Map<string, AssetLease<Texture>>();
	private disposed = false;
	private catalog: Pick<FurnitureDB, 'textures' | 'rawResources' | 'bundles'>;
	private cache: FurnitureResourceCache;
	private decode: typeof decodeImage;
	private fetchAsset: (asset: FurnitureAsset, signal: AbortSignal) => Promise<ArrayBuffer>;

	constructor(
		catalog: Pick<FurnitureDB, 'textures' | 'rawResources' | 'bundles'>,
		root: string,
		cache: FurnitureResourceCache,
		decode = decodeImage,
		fetchAsset = (asset: FurnitureAsset, signal: AbortSignal) => fetchFurnitureAsset(asset, signal, root),
	) {
		this.catalog = catalog;
		this.cache = cache;
		this.decode = decode;
		this.fetchAsset = fetchAsset;
	}

	renderer?: WebGLRenderer;

	private binary(asset: FurnitureAsset): Promise<ArrayBuffer> {
		if (this.disposed) return Promise.reject(new Error('[Furniture] Resource owner disposed'));

		const key = furnitureAssetKey(asset);
		let lease = this.binaryLeases.get(key);
		if (!lease) {
			lease = this.cache.binaries.acquire(key, (signal) => this.fetchAsset(asset, signal));
			this.binaryLeases.set(key, lease);
		}

		const active = lease;
		return active.ready.catch((error) => {
			if (this.binaryLeases.get(key) === active) this.binaryLeases.delete(key);
			active.release();
			throw error;
		});
	}

	async readAsset(asset: FurnitureAsset): Promise<ArrayBuffer> {
		const buffer = await this.binary(asset);
		if (this.disposed) throw new Error('[Furniture] Resource owner disposed during asset loading');

		return buffer;
	}

	private acquirePacked(resource: FurniturePackedResource): AssetLease<Uint8Array<ArrayBuffer>> {
		const asset = validatePackedResource(resource, this.catalog.bundles);
		return this.cache.members.acquire(`${resource.sha256}:${resource.bytes}`, async (signal) => {
			// The shared load owns the packet lease across requesting owners.
			const packet = this.cache.binaries.acquire(furnitureAssetKey(asset), (signal) => this.fetchAsset(asset, signal));
			const abort = () => packet.release();
			signal.addEventListener('abort', abort, { once: true });
			try {
				const data = await packet.ready;
				const header = new DataView(data);
				if (
					data.byteLength < 16 ||
					header.getUint32(0, true) !== 0x4246354e ||
					header.getUint32(4, true) !== 1 ||
					!header.getUint32(8, true)
				) throw new Error('[Furniture] Invalid bundle header');

				const bytes = new Uint8Array(data, resource.byteOffset, resource.bytes);
				const hash = await contentSHA256(bytes);
				if (hash !== resource.sha256) throw new Error('[Furniture] Bundle member content digest changed');

				return bytes;
			} finally {
				signal.removeEventListener('abort', abort);
				packet.release();
			}
		});
	}

	private async packed(resource: FurniturePackedResource): Promise<Uint8Array<ArrayBuffer>> {
		const lease = this.acquirePacked(resource);
		this.memberLeases.add(lease);
		try {
			return await lease.ready;
		} finally {
			this.memberLeases.delete(lease);
			lease.release();
		}
	}

	async read(reference: FurnitureRawReference): Promise<Uint8Array> {
		const { resource, byteOffset, byteLength } = reference;
		const asset = this.catalog.rawResources[resource];
		if (
			!asset ||
			resource !== `r-${asset.sha256.slice(0, 16)}` ||
			!Number.isSafeInteger(byteOffset) ||
			!Number.isSafeInteger(byteLength) ||
			byteOffset < 0 ||
			byteLength <= 0 ||
			byteOffset + byteLength > asset.bytes
		) throw new Error('[Furniture] Invalid typed resource range');
		if (this.disposed) throw new Error('[Furniture] Resource owner disposed');

		const buffer = await this.packed(asset);
		if (this.disposed) throw new Error('[Furniture] Resource owner lease expired during typed loading');

		return new Uint8Array(buffer.buffer, buffer.byteOffset + byteOffset, byteLength);
	}

	async image(id: string, quality: ModelAssetProfile): Promise<Texture> {
		if (this.disposed) throw new Error('[Furniture] Resource owner disposed');

		const definition = this.catalog.textures[id];
		const asset = definition?.[quality];
		if (!asset) throw new Error(`[Furniture] Image ${id}/${quality} unavailable; no fallback`);

		validatePackedResource(asset, this.catalog.bundles);

		const key = `image:${this.imageKey(definition, quality)}`;
		return this.borrowTexture(key, this.cache.images, async (signal) => {
			if (definition.encoding === 'rgb-alpha') {
				const lease = this.acquireImagePixels(definition, quality);
				const abort = () => lease.release();
				signal.addEventListener('abort', abort, { once: true });

				try {
					signal.throwIfAborted();
					const image = await lease.ready;
					signal.throwIfAborted();

					const texture = new DataTexture(image.data, image.width, image.height);
					texture.flipY = false;
					texture.needsUpdate = true;
					return texture;
				} finally {
					signal.removeEventListener('abort', abort);
					lease.release();
				}
			}

			const lease = this.acquirePacked(asset);
			const abort = () => lease.release();
			signal.addEventListener('abort', abort, { once: true });
			try {
				signal.throwIfAborted();
				return await this.decode(await lease.ready, definition.mimeType);
			} finally {
				signal.removeEventListener('abort', abort);
				lease.release();
			}
		});
	}

	async arrayImage(ids: string[], quality: ModelAssetProfile): Promise<Texture> {
		if (!ids.length || this.disposed) throw new Error('[Furniture] Complete array images require an active resource owner');

		const keys = ids.map((id) => {
			const definition = this.catalog.textures[id];
			const asset = definition?.[quality];
			if (!asset) throw new Error(`[Furniture] Array image ${id}/${quality} unavailable`);

			return this.imageKey(definition, quality);
		});
		return this.texture(`array:${keys.join(';')}`, async () => {
			const sources = await Promise.all(ids.map((id) => this.image(id, quality)));
			const images = sources.map((source) => source.source.data as ImageBitmap | ImagePixels);
			const { width, height } = images[0]!;
			if (
				!width ||
				!height ||
				images.some((image) => image.width !== width || image.height !== height)
			) throw new Error('[Furniture] Array image dimensions differ');

			const canvas = new OffscreenCanvas(width, height);
			const context = canvas.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('[Furniture] Array image pixel decoder unavailable');

			const data = new Uint8Array(width * height * 4 * images.length);
			images.forEach((image, index) => {
				if ('data' in image) {
					data.set(image.data, index * width * height * 4);
					return;
				}

				context.clearRect(0, 0, width, height);
				context.drawImage(image, 0, 0);
				data.set(context.getImageData(0, 0, width, height).data, index * width * height * 4);
			});

			const texture = new DataArrayTexture(data, width, height, images.length);
			texture.flipY = false;
			texture.needsUpdate = true;
			return texture;
		});
	}

	private imageKey(definition: FurnitureTextureResource, quality: ModelAssetProfile): string {
		const asset = definition[quality];
		const alpha = definition.alpha?.[quality];
		return `${asset.sha256}:${asset.bytes}:${definition.mimeType}:${definition.encoding ?? ''}:${alpha?.sha256 ?? ''}:${alpha?.bytes ?? 0}`;
	}

	private acquireImagePixels(definition: FurnitureTextureResource, quality: ModelAssetProfile): AssetLease<ImagePixels> {
		if (definition.encoding !== 'rgb-alpha') throw new Error('Paper array requires split images');

		return this.cache.pixels.acquire(this.imageKey(definition, quality), async (signal) => {
			const color = this.acquirePacked(definition[quality]);
			let alpha: AssetLease<Uint8Array<ArrayBuffer>> | undefined;
			const abort = () => {
				color.release();
				alpha?.release();
			};
			signal.addEventListener('abort', abort, { once: true });

			try {
				signal.throwIfAborted();
				if (definition.alpha?.[quality]) alpha = this.acquirePacked(definition.alpha[quality]!);

				const [rgb, mask] = await Promise.all([color.ready, alpha?.ready]);
				return await this.cache.pixelDecoder.decode(rgb, mask, signal);
			} finally {
				signal.removeEventListener('abort', abort);
				abort();
			}
		});
	}

	async paperArray(ids: readonly string[], quality: ModelAssetProfile): Promise<Texture> {
		if (!ids.length || this.disposed) throw new Error('Paper array requires an active resource owner and layers');

		const definitions = ids.map((id) => {
			const definition = this.catalog.textures[id];
			if (!definition?.[quality] || definition.encoding !== 'rgb-alpha') throw new Error(`Paper layer ${id}/${quality} is not a split image`);

			return definition;
		});
		const key = `paper:${definitions.map((definition) => this.imageKey(definition, quality)).join(';')}`;
		const texture = await this.borrowTexture(key, this.cache.paperArrays, async (signal) => {
			let data: Uint8Array<ArrayBuffer> | undefined;
			let width = 0;
			let height = 0;

			for (let i = 0; i < definitions.length; i++) {
				signal.throwIfAborted();

				const lease = this.acquireImagePixels(definitions[i]!, quality);
				const abort = () => lease.release();
				signal.addEventListener('abort', abort, { once: true });

				try {
					const image = await lease.ready;
					signal.throwIfAborted();

					if (!data) {
						width = image.width;
						height = image.height;
						const length = width * height * definitions.length * 4;
						if (
							![width, height, length].every((value) => Number.isSafeInteger(value) && value > 0) ||
							length > 512 * 1024 * 1024
						) throw new Error('Invalid native paper array dimensions');

						data = new Uint8Array(length);
					}

					if (
						image.width !== width ||
						image.height !== height ||
						image.data.length !== width * height * 4
					) throw new Error('Paper array image dimensions differ');

					data.set(image.data, i * width * height * 4);
				} finally {
					signal.removeEventListener('abort', abort);
					lease.release();
				}
			}

			const array = new DataArrayTexture(data!, width, height, definitions.length);
			array.flipY = false;
			array.needsUpdate = true;
			return array;
		}) as DataArrayTexture;
		const { width, height, depth } = texture.image;
		const gl = this.renderer?.getContext() as WebGL2RenderingContext | undefined;
		if (this.renderer && gl && (
			width > this.renderer.capabilities.maxTextureSize ||
			height > this.renderer.capabilities.maxTextureSize ||
			depth > gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)
		)) throw new Error('Native paper array exceeds GPU limits');

		return texture;
	}

	texture(key: string, load: () => Promise<Texture>): Promise<Texture> {
		return this.borrowTexture(key, this.textures, load);
	}

	private borrowTexture(key: string, cache: AssetLeaseCache<Texture>, load: (signal: AbortSignal) => Promise<Texture>): Promise<Texture> {
		if (this.disposed) return Promise.reject(new Error('[Furniture] Resource owner disposed'));

		let lease = this.textureLeases.get(key);
		if (!lease) {
			lease = cache.acquire(key, load);
			this.textureLeases.set(key, lease);
		}

		const active = lease;
		return active.ready.catch((error) => {
			if (this.textureLeases.get(key) === active) this.textureLeases.delete(key);
			active.release();
			throw error;
		});
	}

	dispose(): void {
		if (this.disposed) return;

		this.disposed = true;
		for (const lease of this.textureLeases.values()) lease.release();

		for (const lease of this.binaryLeases.values()) lease.release();

		this.textureLeases.clear();
		this.binaryLeases.clear();
		for (const lease of this.memberLeases) lease.release();

		this.memberLeases.clear();
		this.textures.clear();
	}
}
