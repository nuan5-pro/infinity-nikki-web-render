import {
	CompressedArrayTexture,
	LinearFilter,
	LinearMipmapLinearFilter,
	NoColorSpace,
	RepeatWrapping,
	RGBA_BPTC_Format,
	RGBA_S3TC_DXT1_Format,
	SRGBColorSpace,
} from 'three';
import type { WebGLRenderer } from 'three';
import { readNNClothMipBytes, type NNClothMipPayload } from './nnclothBinary.js';

export interface NNClothNativeArray {
	Native: true
	SourcePath: string
	Type: 'Texture2DArray'
	SRGB: boolean
	Filter: 'TF_Default'
	AddressX: 'TA_Wrap'
	AddressY: 'TA_Wrap'
	Width: number
	Height: number
	Depth: number
	MipCount: number
	PixelFormat: 'PF_BC7' | 'PF_DXT1'
	mips: (NNClothMipPayload & { width: number; height: number; depth: number })[]
}

/** Upload the original array, not a selected PNG slice or rebuilt mip chain. */
export function createNNClothNativeArray(source: NNClothNativeArray, parameter: 'Fabric_NArray' | 'Matcap_TArray') {
	const normal = parameter === 'Fabric_NArray';
	if (
		source.Native !== true ||
		source.Type !== 'Texture2DArray' ||
		!source.SourcePath.startsWith('/Game/') ||
		source.SRGB !== !normal ||
		source.PixelFormat !== (normal ? 'PF_BC7' : 'PF_DXT1') ||
		source.Width !== (normal ? 512 : 128) ||
		source.Height !== source.Width ||
		source.Depth !== (normal ? 9 : 48) ||
		source.Filter !== 'TF_Default' ||
		source.AddressX !== 'TA_Wrap' ||
		source.AddressY !== 'TA_Wrap' ||
		source.MipCount !== (normal ? 10 : 8) ||
		source.mips.length !== source.MipCount
	) throw new Error(`[NNCloth] invalid original ${parameter} resource`);

	const mipmaps = source.mips.map((mip, level) => {
		const size = Math.max(1, source.Width >> level);
		const data = readNNClothMipBytes(mip);
		const expected = Math.ceil(size / 4) ** 2 * source.Depth * (normal ? 16 : 8);
		if (
			mip.width !== size ||
			mip.height !== size ||
			mip.depth !== source.Depth ||
			data.length !== expected ||
			!/^[a-f0-9]{64}$/.test(mip.sha256 ?? '')
		) throw new Error(`[NNCloth] invalid original ${parameter} mip level ${level}`);

		return { width: size, height: size, depth: source.Depth, data };
	});
	const texture = new CompressedArrayTexture(
		mipmaps,
		source.Width,
		source.Height,
		source.Depth,
		normal ? RGBA_BPTC_Format : RGBA_S3TC_DXT1_Format,
	);
	texture.name = source.SourcePath;
	texture.colorSpace = normal ? NoColorSpace : SRGBColorSpace;
	texture.wrapS = RepeatWrapping;
	texture.wrapT = RepeatWrapping;
	texture.magFilter = LinearFilter;
	texture.minFilter = LinearMipmapLinearFilter;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}

export function assertNNClothArrayGPU(renderer: WebGLRenderer) {
	if (
		!renderer.extensions.has('EXT_texture_compression_bptc') ||
		!renderer.extensions.has('WEBGL_compressed_texture_s3tc_srgb')
	) throw new Error('[NNCloth] original BC7/BC1-sRGB array upload is unsupported');
}
