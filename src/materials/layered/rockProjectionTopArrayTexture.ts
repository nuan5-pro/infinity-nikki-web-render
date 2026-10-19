import {
	DataArrayTexture,
	LinearFilter,
	LinearMipmapLinearFilter,
	NoColorSpace,
	RepeatWrapping,
	RGBAFormat,
	UnsignedByteType,
	type Texture,
	type WebGLRenderer,
} from 'three';
import type { FurnitureLayered, LayeredRole } from './layeredShader.js';
import { readTextureInputs } from '../textureInputs.js';

export const ROCK_PROJECTION_TOP_ROLES = ['D2', 'N2', 'O2'] as const;

interface PreviewImage {
	width: number;
	height: number;
}

export interface TopPreviewPixels extends PreviewImage {
	data: Uint8Array | Uint8ClampedArray;
	flipY: boolean;
}

function imageSize(image: unknown): PreviewImage {
	if (!image || typeof image !== 'object') throw new Error('[RockProjectionTopArray] image missing');

	const value = image as { width?: unknown; height?: unknown };
	if (
		typeof value.width !== 'number' ||
		typeof value.height !== 'number' ||
		!Number.isInteger(value.width) ||
		!Number.isInteger(value.height) ||
		value.width < 1 ||
		value.height < 1 ||
		value.width > 2048 ||
		value.height > 2048
	) throw new Error('[RockProjectionTopArray] invalid preview image dimensions');

	return { width: value.width, height: value.height };
}

export function assertRockProjectionTopInputs(
	config: FurnitureLayered,
	inputs: Partial<Record<LayeredRole, Texture | null>>,
	userData: Record<string, unknown>,
): [Texture, Texture, Texture] {
	const references = readTextureInputs(userData);
	if (!references) throw new Error('[RockProjectionTopArray] source image references missing');

	const textures: Texture[] = [];
	const images = new Set<string>();
	const sources = new Set<object>();
	let size: PreviewImage | undefined;
	for (const [slice, role] of ROCK_PROJECTION_TOP_ROLES.entries()) {
		const descriptor = config.textures[role];
		const reference = references[role];
		const texture = inputs[role];
		if (
			!descriptor ||
			descriptor.key !== 'Top Layer Texture Array' ||
			descriptor.slice !== slice ||
			descriptor.constant ||
			descriptor.srgb ||
			!reference ||
			reference.images.length !== 1 ||
			reference.srgb !== false ||
			!texture
		) throw new Error(`[RockProjectionTopArray] invalid preview source slice ${role}`);

		const imageName = reference.images[0];
		if (!imageName || images.has(imageName) || sources.has(texture.source)) throw new Error('[RockProjectionTopArray] duplicate source slice');

		images.add(imageName);
		sources.add(texture.source);

		const current = imageSize(texture.image);
		if (
			(size && (size.width !== current.width || size.height !== current.height)) ||
			texture.format !== RGBAFormat ||
			texture.type !== UnsignedByteType ||
			texture.colorSpace !== NoColorSpace ||
			texture.premultiplyAlpha
		) throw new Error(`[RockProjectionTopArray] incompatible preview pixel format/shape ${role}`);

		size = current;
		textures.push(texture);
	}

	const first = textures[0];
	const second = textures[1];
	const third = textures[2];
	if (!first || !second || !third) throw new Error('[RockProjectionTopArray] missing complete source slices');

	return [first, second, third];
}

export function packRockProjectionTopPixels(layers: readonly TopPreviewPixels[]): Uint8Array {
	const first = layers[0];
	if (layers.length !== 3 || !first) throw new Error('[RockProjectionTopArray] three preview layers required');

	const { width, height } = imageSize(first);
	const rowBytes = width * 4;
	const layerBytes = rowBytes * height;
	const data = new Uint8Array(layerBytes * 3);
	for (const [slice, layer] of layers.entries()) {
		if (
			layer.width !== width ||
			layer.height !== height ||
			!(layer.data instanceof Uint8Array || layer.data instanceof Uint8ClampedArray) ||
			layer.data.length !== layerBytes
		) throw new Error('[RockProjectionTopArray] invalid preview layer bytes/shape');

		if (!layer.flipY) data.set(layer.data, slice * layerBytes);
		else
			for (let row = 0; row < height; row++) {
				data.set(layer.data.subarray(row * rowBytes, (row + 1) * rowBytes), slice * layerBytes + (height - 1 - row) * rowBytes);
			}
	}

	return data;
}

function previewPixels(texture: Texture): TopPreviewPixels {
	const { width, height } = imageSize(texture.image);
	const pixels = (texture.image as { data?: unknown }).data;
	if (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)
		return { width, height, data: pixels, flipY: texture.flipY };

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('[RockProjectionTopArray] CPU image conversion unavailable');

	context.drawImage(texture.image as CanvasImageSource, 0, 0);

	const data = context.getImageData(0, 0, width, height).data;
	// ImageBitmap orientation was already resolved by the normal loader. WebGL
	// ignores texture.flipY for it; ordinary DOM images still need the row flip.
	const bitmap = typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap;
	return { width, height, data, flipY: !bitmap && texture.flipY };
}

export function createRockProjectionTopArray(
	config: FurnitureLayered,
	inputs: Partial<Record<LayeredRole, Texture | null>>,
	userData: Record<string, unknown>,
) {
	const source = assertRockProjectionTopInputs(config, inputs, userData);
	const size = imageSize(source[0].image);
	const texture = new DataArrayTexture(null, size.width, size.height, 3);
	texture.format = RGBAFormat;
	texture.type = UnsignedByteType;
	texture.colorSpace = NoColorSpace;
	texture.wrapS = texture.wrapT = RepeatWrapping;
	texture.minFilter = LinearMipmapLinearFilter;
	texture.magFilter = LinearFilter;
	texture.generateMipmaps = true;
	texture.flipY = false;

	const stats = {
		initializations: 0,
		warmCalls: 0,
		imageConversions: 0,
		cpuCopyBytes: 0,
		allocatedBytes: 0,
		readbacks: 0,
		readbackBytes: 0,
		elapsedMs: 0,
	};

	let prepared = false;
	let disposed = false;

	const dispose = () => {
		if (disposed) return;

		disposed = true;
		texture.dispose();
	};

	const ensure = (renderer: WebGLRenderer) => {
		if (disposed) throw new Error('[RockProjectionTopArray] resource already disposed');

		if (prepared) {
			stats.warmCalls++;
			return;
		}

		if (renderer.capabilities.maxTextures < 15) throw new Error('[RockProjectionTopArray] preview sampler capability insufficient');

		const started = performance.now();
		try {
			const data = packRockProjectionTopPixels(source.map(previewPixels));
			texture.image.data = data;
			texture.needsUpdate = true;
			stats.imageConversions = 3;
			stats.cpuCopyBytes = stats.allocatedBytes = data.byteLength;
			stats.initializations++;
			prepared = true;
			// Three owns upload/state/mipmap generation and context restoration.
			// Retained CPU pixels are re-uploadable without re-conversion/readback.
		} catch (error) {
			dispose();
			throw error;
		} finally {
			stats.elapsedMs += performance.now() - started;
		}
	};

	return { texture, ensure, dispose, stats };
}
