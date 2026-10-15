import {
	ClampToEdgeWrapping,
	CompressedTexture,
	LinearFilter,
	LinearMipmapLinearFilter,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RED_GREEN_RGTC2_Format,
	RepeatWrapping,
} from 'three';
import { readNNClothMipBytes } from './nnclothBinary.js';
import type { NNClothNativeTexture } from './nnclothTexture.js';

export type NNClothTextureContext = WebGLRenderingContext | WebGL2RenderingContext;

/** PF_BC5 maps to BC5_UNORM in the native D3D RHI. Preserve its two channels
 * as unsigned RGTC2 blocks; the material program owns normal reconstruction. */
export function createNNClothBC5Texture(source: NNClothNativeTexture, sampler: 'view-wrap' | 'texture-asset', gl?: NNClothTextureContext) {
	if (source.pixelFormat !== 'PF_BC5' || source.sRGB !== false) throw new Error('[NNCloth] linear unsigned native BC5 required');
	if (!gl || gl.isContextLost()) throw new Error('[NNCloth] BC5 requires a live rendering context');

	const extension = gl.getExtension('EXT_texture_compression_rgtc') as {
		COMPRESSED_RED_GREEN_RGTC2_EXT: number;
	} | null;
	const formats: unknown = gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
	if (
		extension?.COMPRESSED_RED_GREEN_RGTC2_EXT !== 0x8dbd ||
		!(formats instanceof Uint32Array) ||
		!formats.includes(0x8dbd)
	) throw new Error('[NNCloth] unsigned RGTC2 is unavailable on this rendering context');
	if (
		!source.sourcePath.startsWith('/Game/') ||
		!Number.isInteger(source.width) ||
		!Number.isInteger(source.height) ||
		source.width < 4 ||
		source.height < 4 ||
		source.width % 4 !== 0 ||
		source.height % 4 !== 0 ||
		!source.mips.length
	) throw new Error('[NNCloth] invalid native BC5 dimensions');

	const levels = 1 + Math.floor(Math.log2(Math.max(source.width, source.height)));
	if (source.mips.length !== 1 && source.mips.length !== levels) throw new Error('[NNCloth] incomplete native BC5 mip chain');

	const mips = source.mips.map((mip, level) => {
		const width = Math.max(1, source.width >> level);
		const height = Math.max(1, source.height >> level);
		const data = readNNClothMipBytes(mip);
		const bytes = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
		if (
			mip.width !== width ||
			mip.height !== height ||
			data.length !== bytes ||
			mip.bytes !== bytes
		) throw new Error('[NNCloth] native BC5 mip identity/shape mismatch');

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
			throw new Error('[NNCloth] unsupported native BC5 address mode');
		}
	};

	const texture = new CompressedTexture(mips, source.width, source.height, RED_GREEN_RGTC2_Format);
	texture.name = source.sourcePath;
	texture.colorSpace = NoColorSpace;
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
