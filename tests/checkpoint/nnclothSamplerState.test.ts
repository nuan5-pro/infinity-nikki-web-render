import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ClampToEdgeWrapping, DataArrayTexture, RepeatWrapping } from 'three';
import { canShareNNClothNormalSampler } from '../../src/materials/nncloth/nnclothSamplerState.js';

test('two native fabric-normal roles share only identical resolved storage and sampler state', () => {
	const near = new DataArrayTexture(new Uint8Array(2 * 2 * 9 * 4), 2, 2, 9);
	near.wrapS = RepeatWrapping;
	near.wrapT = RepeatWrapping;

	const far = near.clone();
	assert.equal(canShareNNClothNormalSampler(near, far), true);
	far.wrapS = ClampToEdgeWrapping;
	assert.equal(canShareNNClothNormalSampler(near, far), false);
	far.wrapS = near.wrapS;
	far.anisotropy = 2;
	assert.equal(canShareNNClothNormalSampler(near, far), false);
	far.anisotropy = near.anisotropy;
	far.offset.x = 0.25;
	assert.equal(canShareNNClothNormalSampler(near, far), false);
	far.offset.copy(near.offset);

	const unrelated = new DataArrayTexture(new Uint8Array(2 * 2 * 9 * 4), 2, 2, 9);
	assert.equal(canShareNNClothNormalSampler(near, unrelated), false);
	near.dispose();
	far.dispose();
	unrelated.dispose();
});
