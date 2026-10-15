import type { CompressedArrayTexture, DataArrayTexture, Texture } from 'three';

type ArrayTexture = DataArrayTexture | CompressedArrayTexture;

function arrayTarget(texture: ArrayTexture) {
	return (
		('isDataArrayTexture' in texture && texture.isDataArrayTexture) ||
		('isCompressedArrayTexture' in texture && texture.isCompressedArrayTexture)
	);
}

/** Native t17 uses two sampler roles. Share a WebGL uniform only when the
 * resolved renderer states and original storage really are identical. */
export function canShareNNClothNormalSampler(near: ArrayTexture, far: ArrayTexture) {
	if (
		!arrayTarget(near) ||
		!arrayTarget(far) ||
		near.constructor !== far.constructor ||
		near.source !== far.source ||
		near.mipmaps.length !== far.mipmaps.length ||
		near.mipmaps.some((mip, index) => mip !== far.mipmaps[index])
	) return false;

	return (
		near.wrapS === far.wrapS &&
		near.wrapT === far.wrapT &&
		near.wrapR === far.wrapR &&
		near.minFilter === far.minFilter &&
		near.magFilter === far.magFilter &&
		near.anisotropy === far.anisotropy &&
		near.format === far.format &&
		near.type === far.type &&
		near.internalFormat === far.internalFormat &&
		Reflect.get(near, 'compareFunction') === Reflect.get(far, 'compareFunction') &&
		near.colorSpace === far.colorSpace &&
		near.generateMipmaps === far.generateMipmaps &&
		near.flipY === far.flipY &&
		near.premultiplyAlpha === far.premultiplyAlpha &&
		near.unpackAlignment === far.unpackAlignment &&
		near.offset.equals(far.offset) &&
		near.repeat.equals(far.repeat) &&
		near.center.equals(far.center) &&
		near.rotation === far.rotation &&
		near.matrixAutoUpdate === far.matrixAutoUpdate &&
		(near.matrixAutoUpdate || near.matrix.equals(far.matrix))
	);
}

export function canShareNNCloth2DSampler(a: Texture, b: Texture) {
	if (
		a.constructor !== b.constructor ||
		a.source !== b.source ||
		a.mipmaps.length !== b.mipmaps.length ||
		a.mipmaps.some((mip, index) => mip !== b.mipmaps[index])
	) return false;

	return (
		a.wrapS === b.wrapS &&
		a.wrapT === b.wrapT &&
		a.minFilter === b.minFilter &&
		a.magFilter === b.magFilter &&
		a.anisotropy === b.anisotropy &&
		a.format === b.format &&
		a.type === b.type &&
		a.internalFormat === b.internalFormat &&
		Reflect.get(a, 'compareFunction') === Reflect.get(b, 'compareFunction') &&
		a.colorSpace === b.colorSpace &&
		a.generateMipmaps === b.generateMipmaps &&
		a.flipY === b.flipY &&
		a.premultiplyAlpha === b.premultiplyAlpha &&
		a.unpackAlignment === b.unpackAlignment &&
		a.offset.equals(b.offset) &&
		a.repeat.equals(b.repeat) &&
		a.center.equals(b.center) &&
		a.rotation === b.rotation &&
		a.matrixAutoUpdate === b.matrixAutoUpdate &&
		(a.matrixAutoUpdate || a.matrix.equals(b.matrix))
	);
}

export function nnclothArraySamplerEvidence(texture: ArrayTexture) {
	return {
		image: texture.source.uuid,
		target: 'TEXTURE_2D_ARRAY',
		width: texture.image.width,
		height: texture.image.height,
		depth: texture.image.depth,
		levels: Array.from(
			texture.mipmaps as { width: number; height: number; data: ArrayBufferView }[],
			(mip) => ({ width: mip.width, height: mip.height, bytes: mip.data.byteLength }),
		),
		filter: { min: texture.minFilter, mag: texture.magFilter },
		wrap: [texture.wrapS, texture.wrapT, texture.wrapR],
		aniso: texture.anisotropy,
		compare: Reflect.get(texture, 'compareFunction') ?? 'not-a-depth-texture',
		colorSpace: texture.colorSpace,
		format: texture.format,
		type: texture.type,
		flipY: texture.flipY,
		generateMipmaps: texture.generateMipmaps,
		uvTransform: {
			offset: texture.offset.toArray(),
			repeat: texture.repeat.toArray(),
			center: texture.center.toArray(),
			rotation: texture.rotation,
			matrixAutoUpdate: texture.matrixAutoUpdate,
			matrix: texture.matrix.toArray(),
		},
	};
}
