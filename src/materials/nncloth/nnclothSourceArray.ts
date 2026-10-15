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
import { readNNClothMipBytes } from './nnclothBinary.js';
import type { NNClothNativeArray } from './nnclothArrays.js';

/** Structural native storage validation. Source-program admission and proof of
 * the shader's array selectors remain responsibilities of the calling profile. */
export function createNNClothSourceArray(
	source: NNClothNativeArray,
	parameter: 'Fabric_NArray' | 'Matcap_TArray',
	gl: WebGL2RenderingContext,
) {
	const normal = parameter === 'Fabric_NArray';
	if (
		source.Native !== true ||
		source.Type !== 'Texture2DArray' ||
		!source.SourcePath.startsWith('/Game/') ||
		source.SRGB !== !normal ||
		source.PixelFormat !== (normal ? 'PF_BC7' : 'PF_DXT1') ||
		source.Filter !== 'TF_Default' ||
		source.AddressX !== 'TA_Wrap' ||
		source.AddressY !== 'TA_Wrap'
	) throw new Error('[NNCloth] unsupported native array format or sampler domain');
	if (!gl || gl.isContextLost() || typeof gl.texStorage3D !== 'function') throw new Error('[NNCloth] original arrays require a live WebGL2 context');

	const extension = gl.getExtension(normal ? 'EXT_texture_compression_bptc' : 'WEBGL_compressed_texture_s3tc_srgb') as Record<string, number> | null;
	const expected = normal ? 0x8e8c : 0x8c4d;
	const format = extension?.[normal ? 'COMPRESSED_RGBA_BPTC_UNORM_EXT' : 'COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT'];
	const formats: unknown = gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
	if (format !== expected || !(formats instanceof Uint32Array) || !formats.includes(expected)) throw new Error('[NNCloth] native array compression unavailable on this context');

	const maxSize: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
	const maxLayers: unknown = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
	if (
		typeof maxSize !== 'number' ||
		typeof maxLayers !== 'number' ||
		![source.Width, source.Height, source.Depth].every(Number.isSafeInteger) ||
		source.Width < 4 ||
		source.Height < 4 ||
		source.Width % 4 !== 0 ||
		source.Height % 4 !== 0 ||
		source.Depth < 1 ||
		source.Width > maxSize ||
		source.Height > maxSize ||
		source.Depth > maxLayers
	) throw new Error('[NNCloth] native array dimensions exceed the typed device domain');

	const levels = 1 + Math.floor(Math.log2(Math.max(source.Width, source.Height)));
	if (source.MipCount !== levels || source.mips.length !== levels) throw new Error('[NNCloth] native array mip chain incomplete');

	const mipmaps = source.mips.map((mip, level) => {
		const width = Math.max(1, source.Width >> level);
		const height = Math.max(1, source.Height >> level);
		const data = readNNClothMipBytes(mip);
		const bytes = Math.ceil(width / 4) * Math.ceil(height / 4) * source.Depth * (normal ? 16 : 8);
		if (
			mip.width !== width ||
			mip.height !== height ||
			mip.depth !== source.Depth ||
			data.length !== bytes
		) throw new Error('[NNCloth] original array mip layers/blocks mismatch');

		return { width, height, depth: source.Depth, data };
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
