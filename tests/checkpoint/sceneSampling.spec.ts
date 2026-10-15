import { describe, expect, it } from 'vitest';
import {
	sceneDetailNormal,
	sceneDetailUV,
	sceneEdgeRGB,
} from '../../src/materials/sceneSampling.js';

describe('native Scene detail and edge consumers', () => {
	it('uses actual UV0/UV1 selection and GB tiling', () => {
		expect(sceneDetailUV([0.2, 0.3], [0.5, 0.8], [1, 40, 40, 0.7])).toEqual([20, 32]);
	});
	it('keeps RNM numerator before the ORM alpha lerp', () => {
		expect(sceneDetailNormal([0.5, 0.5], [0.5, 0.5], 1, 1, 1)).toEqual([0, 0, 2]);
		expect(sceneDetailNormal([0.5, 0.5], [0.5, 0.5], 1, 1, 0.5)).toEqual([0, 0, 1.5]);
		expect(sceneDetailNormal([0.5, 0.5], [0.5, 0.5], 1, 1, 0)).toEqual([0, 0, 1]);
	});
	it('separates edge base RGB from its authored emission alpha', () => {
		const edge = {
			color: [2, 4, 8, 0] as [number, number, number, number],
			range: 3,
			useCoatingMask: 0,
		};

		expect(sceneEdgeRGB(edge, 0.5, 0)).toEqual([0.25, 0.5, 1]);
		expect(sceneEdgeRGB(edge, 1, 1)).toEqual([0, 0, 0]);
		expect(sceneEdgeRGB({ ...edge, useCoatingMask: 1 }, 0.5, 0.2)).toEqual([
			0.04999999999999999, 0.09999999999999998, 0.19999999999999996,
		]);
	});
});
