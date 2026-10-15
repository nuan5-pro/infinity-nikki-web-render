import { BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
	restoreABSFXCurrentGeometry,
	transformABSFXCurrentGeometry,
} from '../../src/materials/effects/absFxCurrentGeometry.js';

describe('actual ABSFX packed VF and primitive carriers', () => {
	it('keeps native UV1 padding distinct from UV2 pair-clamp and transforms current pivot/radius', () => {
		const g = new BufferGeometry();
		g.setAttribute('position', new Float32BufferAttribute([1, 2, 3], 3));
		g.setAttribute('_abs_fx_native_normal', new Float32BufferAttribute([0.5, 0.25, 0.75], 3));
		g.setAttribute('_abs_fx_native_uv1', new Float32BufferAttribute([0, 1], 2));
		g.setAttribute('_abs_fx_native_uv2', new Float32BufferAttribute([0.7, 0.6], 2));
		g.setAttribute('_abs_fx_native_bounds', new Float32BufferAttribute([1, 2, 3, 4], 4));
		g.setAttribute('_abs_fx_native_pivot', new Float32BufferAttribute([0, 0, 0], 3));
		restoreABSFXCurrentGeometry(g);
		transformABSFXCurrentGeometry(g, new Matrix4().makeScale(-2, 3, 4).setPosition(5, 6, 7));
		expect(Array.from(g.getAttribute('absFxUV1').array)).toEqual([0, 1]);
		expect(g.getAttribute('absFxUV2').getX(0)).toBeCloseTo(0.7);
		expect(Array.from(g.getAttribute('absFxDissolvePivot').array)).toEqual([5, 6, 7]);
		expect(g.getAttribute('absFxPrimitiveBounds').getW(0)).toBe(16);
		expect(Array.from(g.getAttribute('absFxNativeNormal').array)).toEqual([-0.5, 0.25, 0.75]);
	});
});
