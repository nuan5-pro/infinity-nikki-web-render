import { describe, expect, it } from 'vitest';
import {
	readNNClothResource,
	readNNClothMipBytes,
} from '../../src/materials/nncloth/nnclothBinary.js';

describe('NNCloth original typed binary transport', () => {
	it('preserves addressed typed byte views', () => {
		const data = new Uint8Array([91, 0, 127, 255, 92]).subarray(1, 4);
		expect(readNNClothMipBytes({ sha256: 'a'.repeat(64), data })).toBe(data);
		expect(Array.from(data)).toEqual([0, 127, 255]);
		expect(() => readNNClothMipBytes({ data: [] as unknown as Uint8Array })).toThrow(/typed/);
	});

	it('uses verified resource ranges, never a synthetic GLTF parser', async () => {
		const data = new Uint8Array([0, 127, 255]);

		const resources = {
			read: async () => data,

			texture: async () => {
				throw new Error('unused');
			},
		};

		const reference = { resource: `r-${'a'.repeat(16)}`, byteOffset: 4, byteLength: 3 };
		expect(Array.from(await readNNClothResource(resources, reference))).toEqual([0, 127, 255]);
		await expect(readNNClothResource(resources, { ...reference, byteLength: 4 })).rejects.toThrow(/length changed/);
		await expect(readNNClothResource(resources, { ...reference, byteOffset: -1 })).rejects.toThrow(/reference/);
	});
});
