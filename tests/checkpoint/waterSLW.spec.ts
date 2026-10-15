import { describe, expect, it } from 'vitest';
import native from './fixtures/waterSLWFountain.json';
import {
	readWaterSLW,
	waterSLWDetailUV,
	waterSLWDirectionalSample,
	waterSLWProceduralHeight,
	waterSLWShader,
	waterSLWUniforms,
	type WaterSLW,
} from '../../src/materials/water/waterSLW.js';

const source = native as WaterSLW;

describe('captured wavy SLW sampling core', () => {
	it('preserves the complete native finite parameter transport', () => {
		expect(readWaterSLW(source)).toBe(source);
		expect(source.detailIntensity[0]).toBe(11);
		expect(source.directionalShape[0][0]).toBe(-5);
		expect(source.waveSpeed[1]).toBe(2);
		expect(readWaterSLW({ ...source, iterations: 65 })).toBeNull();
		expect(readWaterSLW({ ...source, iterations: 1.5 })).toBeNull();
		expect(
			readWaterSLW({
				...source,
				directional: [
					[1, 2],
					[3, 4],
				],
			}),
		).toBeNull();
		expect(readWaterSLW({ ...source, finalFlatten: NaN })).toBeNull();

		const uniforms = waterSLWUniforms(source);
		expect(uniforms.waterSLWDirectional0).toEqual({ value: source.directional[0] });
		expect(uniforms.waterSLWDetailIntensity).toEqual({ value: [11, 1] });
		expect(uniforms).not.toHaveProperty('waterSLWDirectional');
	});

	it('runs the source height accumulation instead of a cosine proxy', () => {
		const one = {
			procedural: [0.4, 0.0008, 0.336456, 0.5] as WaterSLW['procedural'],
			iterations: 1,
		};

		expect(waterSLWProceduralHeight(one, [0, 0], 0)).toBeCloseTo(Math.exp(-1) * 0.5, 12);
		expect(waterSLWProceduralHeight(one, [0, Math.PI / 2], 0)).toBeCloseTo(0.5, 12);
		expect(waterSLWProceduralHeight(source, [0.2, -0.3], 1)).not.toBe(waterSLWProceduralHeight(source, [0.2, -0.3], 2));
	});

	it('uses native directional slopes, gravity-frequency phase and signed height', () => {
		const value = waterSLWDirectionalSample([1, 0, 0.1, 2], [-5, 0.25], [Math.PI / 0.2, 0], 0, 1);
		const length = Math.hypot(-0.5, 0, 1);
		expect(value.normal[0]).toBeCloseTo(-0.5 / length, 12);
		expect(value.normal[2]).toBeCloseTo(1 / length, 12);
		expect(value.displacement[0]).toBeCloseTo(-2.5, 12);
		expect(value.displacement[2]).toBeCloseTo(0, 12);
	});

	it('advects only the first detail sample by native derived displacement', () => {
		const [first, second] = waterSLWDetailUV(source, [1000, -2000], [100, -200, 0], 2);
		expect(first[0]).toBeCloseTo(1 + (4 + 0.1) * 0.002, 12);
		expect(first[1]).toBeCloseTo(-2 + (4 - 0.2) * -0.01, 12);
		expect(second[0]).toBeCloseTo(1.2 + 4 * 0.01, 12);
		expect(second[1]).toBeCloseTo(-2.4 + 4 * 0.01, 12);
	});

	it('consumes four real RG samples, ordered RNM and authored flatten only', () => {
		expect(waterSLWShader.match(/texture2D\(waterSLWBaseNormal/g)).toHaveLength(2);
		expect(waterSLWShader.match(/texture2D\(waterSLWDetailNormal/g)).toHaveLength(2);
		expect(waterSLWShader).toContain('waterSLWRNM(d2, d1)');
		expect(waterSLWShader).toContain('displacement.xy * waterSLWVelocity.y');
		expect(waterSLWShader).toContain('dot(sourceTBN[0], procedural)');
		expect(waterSLWShader).not.toMatch(/normalIntensity|FlowIntensity|baseColor|coverage|alpha|WaterBaseColor/);
	});
});
