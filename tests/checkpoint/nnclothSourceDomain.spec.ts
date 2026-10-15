import { describe, expect, it } from 'vitest';
import {
	validateNNClothSourceSelectors,
	readNNClothSourceDomain,
} from '../../src/materials/nncloth/nnclothSourceDomain.js';

describe('native source array selector domain', () => {
	it('binds each material path and descriptor with an independent record', () => {
		const identity = 'cf21b27749125766ff38ef43cb326c7ca5551650cf373be9946d69a394e7b0bc';
		const domain = readNNClothSourceDomain(identity)!;
		expect(domain).toEqual({
			identity,
			resourceDescriptorSHA256: 'd44382397c3b2450b4dd16600150e3501db1c48838be28e44418c29458e0d448',
			sourcePath: '/Game/Assets/Buildin/Parts/Jewelry/PABJ0004/Material/M_PABJ0004_02.M_PABJ0004_02',
		});
		expect(readNNClothSourceDomain(identity)).not.toBe(domain);
	});

	it('preserves authored nonintegral normal selector and actual two-layer domain', () => {
		const mpt = new Float32Array(252);
		mpt[0] = 1.002;
		mpt[4 * 9 * 4] = 47;

		const original = mpt.slice();
		validateNNClothSourceSelectors(mpt, 2, 48);
		expect(mpt).toEqual(original);
	});

	it('rejects invalid layers, nonfinite values, and borrowed Cabinet dimensions', () => {
		for (const [offset, value] of [
			[0, 1.5],
			[0, -1],
			[4 * 9 * 4, 47.5],
			[12, NaN],
		] as const) {
			const mpt = new Float32Array(252);
			mpt[offset] = value;
			expect(() => validateNNClothSourceSelectors(mpt, 2, 48)).toThrow();
		}

		expect(() => validateNNClothSourceSelectors(new Float32Array(252), 9, 48)).toThrow();
		expect(readNNClothSourceDomain('__proto__')).toBeNull();
		expect(readNNClothSourceDomain('M_PABJ0004_02')).toBeNull();
	});
});
