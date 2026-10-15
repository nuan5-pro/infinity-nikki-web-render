import { DataArrayTexture, Texture, type WebGLRenderer } from 'three';
import type {
	FurnitureAsset,
	FurnitureDB,
	FurniturePackedResource,
	FurnitureRawReference,
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
import type { PaperArray } from '../materials/textureInputs.js';

export interface FurnitureResourceReader {
	readonly renderer?: WebGLRenderer
	read(reference: FurnitureRawReference): Promise<Uint8Array>
	texture(key: string, load: () => Promise<Texture>): Promise<Texture>
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

	clearUnused(): void {
		this.images.clearUnused();
		this.members.clearUnused();
		this.binaries.clearUnused();
	}

	dispose(): void {
		this.images.clear();
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

async function inflatePaperArray(compressed: Uint8Array<ArrayBuffer>, length: number, checkOwner: () => void): Promise<Uint8Array<ArrayBuffer>> {
	const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
	const reader = stream.getReader();
	const data = new Uint8Array(length);
	let offset = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			checkOwner();
			if (done) break;
			if (offset + value.length > length) throw new Error('Native paper array decoded length overflow');

			data.set(value, offset);
			offset += value.length;
		}
	} finally {
		await reader.cancel();
	}

	if (offset !== length) throw new Error('Native paper array decoded length mismatch');

	return data;
}

/** Share decoded pixels by content. Each owner holds its sampler clones. */
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

		const key = `image:${asset.sha256}:${asset.bytes}:${definition.mimeType}`;
		return this.borrowTexture(key, this.cache.images, async (signal) => {
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

			return `${asset.sha256}:${asset.bytes}:${definition.mimeType}`;
		});
		return this.texture(`array:${keys.join(';')}`, async () => {
			const sources = await Promise.all(ids.map((id) => this.image(id, quality)));
			const images = sources.map((source) => source.source.data as ImageBitmap);
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

	async paperArray(reference: PaperArray): Promise<Texture> {
		const { width, height, depth } = reference;
		const length = width * height * depth * 4;
		if (
			reference.encoding !== 'rgba8-deflate' ||
			![width, height, depth].every((value) => Number.isSafeInteger(value) && value > 0) ||
			!Number.isSafeInteger(length) ||
			length > 512 * 1024 * 1024
		) throw new Error('Invalid native paper array dimensions or encoding');

		const gl = this.renderer?.getContext() as WebGL2RenderingContext | undefined;
		if (this.renderer && gl && (
			width > this.renderer.capabilities.maxTextureSize ||
			height > this.renderer.capabilities.maxTextureSize ||
			depth > gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)
		)) throw new Error('Native paper array exceeds GPU limits');

		return this.texture(`paper:${JSON.stringify(reference)}`, async () => {
			const compressed = await this.read(reference);
			const data = await inflatePaperArray(compressed as Uint8Array<ArrayBuffer>, length, () => {
				if (this.disposed) throw new Error('Native paper array owner disposed');
			});
			const texture = new DataArrayTexture(data, width, height, depth);
			texture.flipY = false;
			texture.needsUpdate = true;
			return texture;
		});
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
