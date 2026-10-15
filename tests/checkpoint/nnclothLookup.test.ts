import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { ClampToEdgeWrapping, HalfFloatType, NoColorSpace } from 'three';
import { createNNClothLookup } from '../../src/materials/nncloth/nnclothLookup.js';

test(
	'NNCloth lookupAtlas retains half-float bits and the referenced-texture index domain',
	{ skip: !process.env.CABINET_NATIVE_TEST_ROOT },
	() => {
		const profile = JSON.parse(readFileSync(`${process.env.CABINET_NATIVE_TEST_ROOT}/nncloth-input-contract.json`, 'utf8'));
		const texture = createNNClothLookup(profile.lookup);
		assert.equal(texture.type, HalfFloatType);
		assert.equal(texture.colorSpace, NoColorSpace);
		assert.equal(texture.userData.nativeAtlasSRGBFlag, true);
		assert.equal(texture.wrapS, ClampToEdgeWrapping);
		assert.equal(texture.wrapT, ClampToEdgeWrapping);
		assert.equal(texture.generateMipmaps, false);
		assert.equal(createHash('sha256').update(new Uint8Array(texture.image.data.buffer)).digest('hex'), profile.lookup.mips[0].sha256);
		assert.throws(() => createNNClothLookup({ ...profile.lookup, kind: 'Texture2D' }), /lookupAtlas/);
		assert.throws(() => createNNClothLookup({ ...profile.lookup, indexDomain: 'named-parameter-defaults' }), /lookupAtlas/);
		texture.dispose();
	},
);
