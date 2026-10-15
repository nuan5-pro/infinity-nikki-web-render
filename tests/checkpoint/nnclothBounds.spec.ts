import { describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import {
	transformNNClothBounds,
	type NNClothSourceBounds,
} from '../../src/materials/nncloth/nnclothBounds.js';

const bounds: NNClothSourceBounds = {
	origin: [-0.016105652, 0, 184.13611],
	extent: [155.76172, 119.16805, 184.137],
	radius: 264.61903919620113,
	source: 'UStaticMesh.ExtendedBounds-native-cm',
};

describe('native ExtendedBounds transform', () => {
	it('uses the source component origin/radius and handles reflected unit conversion', () => {
		const matrix = new Matrix4().makeScale(-0.01, 0.01, 0.01).setPosition(2, 3, 4);
		const result = transformNNClothBounds(bounds, matrix);
		expect(result.origin.toArray()).toEqual([2.00016105652, 3, 5.8413611]);
		expect(result.radius).toBeCloseTo(bounds.radius * 0.01, 12);
	});

	it('reproduces the copied row-component maximum and box-extent clamp, not max column scale', () => {
		const matrix = new Matrix4()
			.makeRotationZ(Math.PI / 4)
			.multiply(new Matrix4().makeScale(-3, 1, 2));
		const result = transformNNClothBounds(bounds, matrix);
		expect(result.radius).toBeCloseTo(Math.sqrt(5) * bounds.radius, 10);
		expect(result.radius).not.toBeCloseTo(3 * bounds.radius, 5);

		const thin = { ...bounds, extent: [0.1, 0.2, 0.3] as [number, number, number] };
		const clamped = transformNNClothBounds(thin, matrix);
		expect(clamped.radius).toBeCloseTo(clamped.extent.length(), 12);
	});
});
