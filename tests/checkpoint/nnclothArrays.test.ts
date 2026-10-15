import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { createNNClothNativeArray } from '../../src/materials/nncloth/nnclothArrays.js';
import {
	canShareNNClothNormalSampler,
	nnclothArraySamplerEvidence,
} from '../../src/materials/nncloth/nnclothSamplerState.js';

test(
	'original NNCloth arrays retain every source mip and layer',
	{ skip: !process.env.CABINET_NATIVE_TEST_ROOT },
	() => {
		const sources = JSON.parse(readFileSync(`${process.env.CABINET_NATIVE_TEST_ROOT}/native-nncloth-arrays.json`, 'utf8'));
		for (const parameter of ['Fabric_NArray', 'Matcap_TArray'] as const) {
			const source = sources[parameter];
			const texture = createNNClothNativeArray(source, parameter);
			assert.equal(texture.image.depth, parameter === 'Fabric_NArray' ? 9 : 48);
			assert.equal(texture.mipmaps.length, parameter === 'Fabric_NArray' ? 10 : 8);
			texture.mipmaps.forEach((mip, index) => {
				assert.equal(createHash('sha256').update(mip.data).digest('hex'), source.mips[index].sha256);
			});

			const clone = texture.clone();
			assert.equal(canShareNNClothNormalSampler(texture, clone), true);
			assert.deepEqual(nnclothArraySamplerEvidence(texture), nnclothArraySamplerEvidence(clone));
			assert.throws(() => createNNClothNativeArray({ ...source, mips: source.mips.slice(0, 1) }, parameter), /original/);
			texture.dispose();
			clone.dispose();
		}
	},
);
