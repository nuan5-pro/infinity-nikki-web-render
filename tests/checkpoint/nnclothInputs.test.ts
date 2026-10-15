import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FloatType, NearestFilter } from 'three';
import {
	createNNClothMPT,
	nnclothFabricIndex,
} from '../../src/materials/nncloth/nnclothInputs.js';

test(
	'native HDR MPT preserves every IEEE float word and source selector',
	{ skip: !process.env.CABINET_NATIVE_TEST_ROOT },
	() => {
		const profile = JSON.parse(readFileSync(`${process.env.CABINET_NATIVE_TEST_ROOT}/nncloth-input-contract.json`, 'utf8'));
		const texture = createNNClothMPT(profile.mpt);
		const data = texture.image.data as Float32Array;
		assert.equal(createHash('sha256').update(new Uint8Array(data.buffer)).digest('hex'), profile.mpt.sha256);
		assert.equal(Math.max(...data), 1200);
		assert.equal(texture.type, FloatType);
		assert.equal(texture.minFilter, NearestFilter);
		assert.equal(texture.generateMipmaps, false);
		assert.equal(nnclothFabricIndex([0.9, 0.9], [2, 3]), 5);
		assert.equal(nnclothFabricIndex([0.5, 0], [2, 3]), 1);
		assert.throws(() => nnclothFabricIndex([-1, 0], [2, 3]), /unsigned/);
		texture.dispose();
	},
);
