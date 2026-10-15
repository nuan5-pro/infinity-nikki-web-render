import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	NoColorSpace,
	RED_GREEN_RGTC2_Format,
	RGBA_BPTC_Format,
	RGBA_S3TC_DXT1_Format,
	RGBA_S3TC_DXT5_Format,
} from 'three';
import {
	createNNClothBC5Texture,
	type NNClothTextureContext,
} from '../../src/materials/nncloth/nnclothBC5Texture.js';
import {
	createNNClothNativeTexture,
	type NNClothNativeTexture,
} from '../../src/materials/nncloth/nnclothTexture.js';

function fixture(pixelFormat: NNClothNativeTexture['pixelFormat'] = 'PF_BC5'): NNClothNativeTexture {
	const data = new Uint8Array(pixelFormat === 'PF_DXT1' ? 8 : 16);
	return {
		sourcePath: '/Game/Test/NativeBlocks.NativeBlocks',
		pixelFormat,
		sRGB: false,
		nearest: false,
		addressX: 'TA_Wrap',
		addressY: 'TA_Wrap',
		width: 4,
		height: 4,
		mips: [
			{
				width: 4,
				height: 4,
				bytes: data.length,
				data,
				sha256: createHash('sha256').update(data).digest('hex'),
			},
		],
	};
}

function context(extension = true, formats = new Uint32Array([0x8dbd]), lost = false): NNClothTextureContext {
	return {
		COMPRESSED_TEXTURE_FORMATS: 0x86a3,

		isContextLost: () => lost,

		getExtension: (name: string) =>
			name === 'EXT_texture_compression_rgtc' && extension
				? { COMPRESSED_RED_GREEN_RGTC2_EXT: 0x8dbd }
				: null,

		getParameter: (parameter: number) => (parameter === 0x86a3 ? formats : undefined),
	} as unknown as NNClothTextureContext;
}

describe('native BC5 texture admission', () => {
	it('keeps the original unsigned RG blocks without a generated blue channel', () => {
		const source = fixture();
		const texture = createNNClothNativeTexture(source, 'view-wrap', context());
		expect(texture.format).toBe(RED_GREEN_RGTC2_Format);
		expect(texture.colorSpace).toBe(NoColorSpace);
		expect(texture.mipmaps[0]!.data).toBe(source.mips[0]!.data);
		expect(texture.generateMipmaps).toBe(false);
		texture.dispose();
	});

	it('requires the actual live context and its advertised unsigned format', () => {
		expect(() => createNNClothBC5Texture(fixture(), 'view-wrap')).toThrow('live rendering context');
		expect(() => createNNClothBC5Texture(fixture(), 'view-wrap', context(false))).toThrow('unavailable');
		expect(() => createNNClothBC5Texture(fixture(), 'view-wrap', context(true, new Uint32Array([0x8dbe])))).toThrow('unavailable');
		expect(() => createNNClothBC5Texture(fixture(), 'view-wrap', context(true, new Uint32Array([0x8dbd]), true))).toThrow('live rendering context');
	});

	it('refuses signed formats and color-space reinterpretation', () => {
		const signed = { ...fixture(), pixelFormat: 'PF_BC5_SNORM' } as unknown as NNClothNativeTexture;
		expect(() => createNNClothBC5Texture(signed, 'view-wrap', context())).toThrow('linear unsigned');
		expect(() => createNNClothBC5Texture({ ...fixture(), sRGB: true }, 'view-wrap', context())).toThrow('linear unsigned');
	});

	it('refuses illegal dimensions, incomplete chains and truncated blocks', () => {
		expect(() => createNNClothBC5Texture({ ...fixture(), width: 3 }, 'view-wrap', context())).toThrow('dimensions');
		expect(() => createNNClothBC5Texture({ ...fixture(), width: 4.5 }, 'view-wrap', context())).toThrow('dimensions');

		const source = fixture();
		expect(() => createNNClothBC5Texture({ ...source, mips: [source.mips[0]!, source.mips[0]!] }, 'view-wrap', context())).toThrow('incomplete');
		expect(() => createNNClothBC5Texture({ ...source, mips: [{ ...source.mips[0]!, data: new Uint8Array(15) }] }, 'view-wrap', context())).toThrow('shape mismatch');
	});

	it.each([
		['PF_BC7', RGBA_BPTC_Format],
		['PF_DXT1', RGBA_S3TC_DXT1_Format],
		['PF_DXT5', RGBA_S3TC_DXT5_Format],
	] as const)('retains the existing two-argument %s path', (format, expected) => {
		const texture = createNNClothNativeTexture(fixture(format), 'view-wrap');
		expect(texture.format).toBe(expected);
		texture.dispose();
	});
});
