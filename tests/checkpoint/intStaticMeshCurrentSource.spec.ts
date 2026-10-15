import { describe, expect, it } from 'vitest';
import {
	intStaticMeshCurrentGlintEdge,
	intStaticMeshCurrentGlintShape,
	intStaticMeshCurrentPatternAttributes,
	intStaticMeshCurrentSurface,
} from '../../src/materials/surface/intStaticMeshCurrentSource.js';

describe('current native IntStatic equations', () => {
	it('Pattern_M blue remaps metal only and preserves authored gloss green', () => {
		const opaque = intStaticMeshCurrentPatternAttributes([0.1, 0.2], [0.3, 0.8, 0.9], 1, 1);
		expect(opaque[0]).toBeCloseTo(0.9);
		expect(opaque[1]).toBeCloseTo(0.8);

		const result = intStaticMeshCurrentPatternAttributes([0.1, 0.2], [0.3, 0.8, 0.9], 0.5, 0.25);
		expect(result[0]).toBeCloseTo(0.225);
		expect(result[1]).toBeCloseTo(0.35);
	});
	it('retains fourth-power current glint lobe and fourth-power edge', () => {
		for (const width of [0.1, 0.4, 1, 2])
			for (const phase of [0, 0.2, 0.5, 0.8, 1]) {
				const denominator = phase * (phase * width - phase) + 1;
				let reference = width / (denominator * denominator * 3.142);
				reference *= reference;
				reference *= reference;
				expect(intStaticMeshCurrentGlintShape(phase, width)).toBeCloseTo(reference, 10);
			}

		expect(intStaticMeshCurrentGlintEdge(0.5, 1)).toBe(0.0625);
		expect(intStaticMeshCurrentGlintEdge(-1, 1)).toBe(1);
	});
	it('rejects the base14 ABI when given an extended program instead of silently standardizing', () => {
		expect(() =>
			intStaticMeshCurrentSurface({
				uniforms: Array.from({ length: 34 }, () => [0, 0, 0, 0]),
				attribute: [0, 0, 0, 0],
				emissive: [0, 0, 0, 0],
				albedo: [0, 0, 0],
				matcap: [0, 0, 0],
				cube: [0, 0, 0],
				normal: [0, 0, 1],
				view: [0, 0, 1],
				primaryDirection: [0, 0, 1],
				primaryColor: [1, 1, 1],
				ready: 0,
				limitedDirection: [0, 0, 1],
				sunColor: [1, 1, 1],
				preExposure: 1,
			}),
		).toThrow('12/14-row base ABI');
	});
	it('uses the captured coating12 Tint and R-metal/G-gloss rows without a Matcap dependency', () => {
		for (const tint of [0.369792, 0.640625]) {
			const uniforms: [number, number, number, number][] = [
				[1, 1, 1, 1],
				[1, 1, 1, 1],
				[0, 0, 0, 0],
				[5, 0, 0, 1],
				[1, 1, 1, 3],
				[1, 0, 0, 1],
				[0, 0, 0, 0.2],
				[0, 0.3, 0, 1],
				[0, 0, 0, 0],
				[tint, tint, tint, 1],
				[0, 0.88, 0, 0.5],
				[1, 0.8, 5, 1],
			];

			const result = intStaticMeshCurrentSurface({
				uniforms,
				attribute: [0.7, 0.25, 1, 0.5],
				emissive: [0, 0, 0, 0],
				albedo: [0.2, 0.5, 0.9],
				matcap: [999, 999, 999],
				cube: [4, 5, 6],
				normal: [0, 0, 1],
				view: [0, 0, 1],
				primaryDirection: [0, 0, 1],
				primaryColor: [1, 1, 1],
				ready: 0,
				limitedDirection: [0, 0, 1],
				sunColor: [1, 1, 1],
				preExposure: 1,
			});
			expect(result.baseColor).toEqual([0.2 * tint, 0.5 * tint, 0.9 * tint]);
			expect(result.emission).toEqual([0, 0, 0]);
			expect(result.metalness).toBeCloseTo(0.7);
			expect(result.roughness).toBeCloseTo(0.78);
			expect(result.specular).toBe(0.5);
			expect(result.ao).toBe(1);
		}
	});
});
