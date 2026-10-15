import {
	ClampToEdgeWrapping,
	CompressedTexture,
	LinearFilter,
	LinearMipmapLinearFilter,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	RGBA_BPTC_Format,
	RGBA_S3TC_DXT1_Format,
	RGBA_S3TC_DXT5_Format,
	SRGBColorSpace,
} from 'three';
import { readNNClothMipBytes, type NNClothMipPayload } from './nnclothBinary.js';
import { createNNClothBC5Texture, type NNClothTextureContext } from './nnclothBC5Texture.js';

export interface NNClothNativeTexture {
	sourcePath: string;
	pixelFormat: 'PF_BC7' | 'PF_DXT1' | 'PF_DXT5' | 'PF_BC5';
	sRGB: boolean;
	nearest: boolean;
	addressX: string;
	addressY: string;
	width: number;
	height: number;
	mips: (NNClothMipPayload & { width: number; height: number; bytes: number })[];
}

export function createNNClothNativeTexture(source: NNClothNativeTexture, sampler: 'view-wrap' | 'texture-asset', gl?: NNClothTextureContext) {
	if (source.pixelFormat === 'PF_BC5') return createNNClothBC5Texture(source, sampler, gl);

	const formats = {
		PF_BC7: RGBA_BPTC_Format,
		PF_DXT1: RGBA_S3TC_DXT1_Format,
		PF_DXT5: RGBA_S3TC_DXT5_Format,
	};

	const format = formats[source.pixelFormat];
	if (
		!format ||
		!source.sourcePath.startsWith('/Game/') ||
		source.width < 1 ||
		source.height < 1 ||
		!source.mips.length
	) throw new Error('[NNCloth] invalid original compressed 2D input');

	const mips = source.mips.map((mip, level) => {
		const width = Math.max(1, source.width >> level);
		const height = Math.max(1, source.height >> level);
		const data = readNNClothMipBytes(mip);
		const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * (source.pixelFormat === 'PF_DXT1' ? 8 : 16);
		if (
			mip.width !== width ||
			mip.height !== height ||
			data.length !== expected ||
			mip.bytes !== expected
		) throw new Error('[NNCloth] compressed mip identity/shape mismatch');

		return { width, height, data };
	});

	const wrap = (value: string) => {
		switch (value) {
		case 'TA_Wrap':
			return RepeatWrapping;
		case 'TA_Clamp':
			return ClampToEdgeWrapping;
		case 'TA_Mirror':
			return MirroredRepeatWrapping;
		default:
			throw new Error('[NNCloth] unsupported native address mode');
		}
	};

	const texture = new CompressedTexture(mips, source.width, source.height, format);
	texture.name = source.sourcePath;
	texture.colorSpace = source.sRGB ? SRGBColorSpace : NoColorSpace;
	texture.wrapS = sampler === 'view-wrap' ? RepeatWrapping : wrap(source.addressX);
	texture.wrapT = sampler === 'view-wrap' ? RepeatWrapping : wrap(source.addressY);

	const nearest = sampler === 'texture-asset' && source.nearest;
	texture.magFilter = nearest ? NearestFilter : LinearFilter;
	texture.minFilter = nearest
		? NearestFilter
		: mips.length > 1
			? LinearMipmapLinearFilter
			: LinearFilter;
	texture.flipY = false;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}
