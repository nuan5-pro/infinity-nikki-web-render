import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNNClothSourceArray } from '../../src/materials/nncloth/nnclothSourceArray.js';
import type { NNClothNativeArray } from '../../src/materials/nncloth/nnclothArrays.js';

function source(depth = 2): NNClothNativeArray {
	return {
		Native: true,
		SourcePath: '/Game/Test/NativeArray.NativeArray',
		Type: 'Texture2DArray',
		SRGB: false,
		Filter: 'TF_Default',
		AddressX: 'TA_Wrap',
		AddressY: 'TA_Wrap',
		Width: 4,
		Height: 4,
		Depth: depth,
		PixelFormat: 'PF_BC7',
		MipCount: 3,
		mips: [4, 2, 1].map((size) => {
			const data = new Uint8Array(depth * 16);
			return {
				width: size,
				height: size,
				depth,
				data,
				sha256: createHash('sha256').update(data).digest('hex'),
			};
		}),
	};
}

function context(maxSize = 4096, maxLayers = 256, supported = true): WebGL2RenderingContext {
	return {
		COMPRESSED_TEXTURE_FORMATS: 0x86a3,
		MAX_TEXTURE_SIZE: 0x0d33,
		MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,

		isContextLost: () => false,

		texStorage3D: () => undefined,

		getExtension: () => (supported ? { COMPRESSED_RGBA_BPTC_UNORM_EXT: 0x8e8c } : null),

		getParameter: (value: number) => value === 0x86a3 ? new Uint32Array([0x8e8c]) : value === 0x0d33 ? maxSize : maxLayers,
	} as unknown as WebGL2RenderingContext;
}

describe('native source array storage', () => {
	it('retains supplied layers and blocks without applying a nine-layer constant', () => {
		const input = source();
		const texture = createNNClothSourceArray(input, 'Fabric_NArray', context());
		expect(texture.image.depth).toBe(2);
		expect(texture.mipmaps[0]!.data).toBe(input.mips[0]!.data);
		texture.dispose();
	});

	it('rejects per-mip layer count or bytes-per-layer drift', () => {
		const input = source();
		expect(() => createNNClothSourceArray({ ...input, mips: input.mips.map((mip, i) => (i ? mip : { ...mip, depth: 9 })) }, 'Fabric_NArray', context()),
		).toThrow('layers/blocks');
		expect(() =>
			createNNClothSourceArray(
				{
					...input,
					mips: input.mips.map((mip, i) => (i ? mip : { ...mip, data: new Uint8Array(16) })),
				},
				'Fabric_NArray',
				context(),
			),
		).toThrow('layers/blocks');
		expect(() => createNNClothSourceArray({ ...input, mips: input.mips.slice(1) }, 'Fabric_NArray', context())).toThrow('incomplete');
	});

	it('rejects dimensions outside the actual context capabilities', () => {
		expect(() => createNNClothSourceArray(source(), 'Fabric_NArray', context(2))).toThrow('dimensions');
		expect(() => createNNClothSourceArray(source(), 'Fabric_NArray', context(4096, 1))).toThrow('dimensions');
		expect(() => createNNClothSourceArray(source(), 'Fabric_NArray', context(4096, 256, false))).toThrow('unavailable');
	});

	it('rejects transfer or block-format reinterpretation', () => {
		expect(() => createNNClothSourceArray({ ...source(), SRGB: true }, 'Fabric_NArray', context())).toThrow('format or sampler');
		expect(() => createNNClothSourceArray({ ...source(), PixelFormat: 'PF_DXT1' }, 'Fabric_NArray', context())).toThrow('format or sampler');
	});
});
