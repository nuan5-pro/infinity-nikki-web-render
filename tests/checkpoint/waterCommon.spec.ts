import { describe, expect, it } from 'vitest';
import {
	readWaterCommon,
	waterCommonCausticsEmission,
	waterCommonCausticsUV,
	waterCommonShader,
	waterCommonUniforms,
	waterCommonWaveUV,
	waterNatureColorScaleBehindWater,
	waterNatureCausticsShader,
	readWaterCaustics,
	type WaterCommon,
} from '../../src/materials/water/waterCommon.js';

const common: WaterCommon = {
	baseWave01: [-0.45, -0.5, 100, 50],
	baseWave02: [0.5, 0.5, 100, 50],
	detailWave01: [0.5, -0.01, 600, 600],
	detailWave02: [-0.5, -0.5, 600, 600],
	waveSpeed: [0.005, 0.01],
	distanceFade: [1723.5403, 1 / 1181.6653, 8995.371, 1 / 10586.287],
	baseIntensity: [0.5, 0.2],
	detailIntensity: [0.5, 0.5],
	normalFlatten: [0, 0, 0.2],
	heightFade: [1549.5503, 1 / 1669.0197, 0, 0],
	horizon: [0, 0.07, 1],
	finalFlatten: 0,
	normalIntensity: 0.75,
	causticsProject: [0.5, 0.5, 1 / 130],
	causticsAtlas: [4, 4, 0.5, 1 / 500],
	causticsLight: [0.3, 0.1, 0.2, 1],
	causticsDark: 0.1,
	selectionColor: [0, 0, 0, 0],
};

describe('captured CommonTrans sampling core', () => {
	it('retains finite source fields without appearance clamps', () => {
		expect(readWaterCommon(common)).toBe(common);
		expect(readWaterCommon({ ...common, normalIntensity: 2 })).not.toBeNull();
		expect(readWaterCommon({ ...common, baseWave01: [1, 2] })).toBeNull();
		expect(readWaterCommon({ ...common, causticsDark: NaN })).toBeNull();
		expect(waterCommonUniforms(common).waterCommonNormalIntensity).toEqual({ value: 0.75 });
	});

	it('samples in source world centimeters rather than mesh UV0', () => {
		const wave = waterCommonWaveUV([1000, -2000], common.baseWave01, 0.005, 2);
		expect(wave[0]).toBeCloseTo(0.0955, 12);
		expect(wave[1]).toBeCloseTo(-0.105, 12);

		const uv = waterCommonCausticsUV(common, [0, 0, 0], 130, 0);
		expect(uv).toEqual([0.125, 0.125]);
		// Native atlas X advances linearly across all 16 cells and wraps by sampler;
		// Y advances across rows. Do not add another modulus to the source program.
		expect(waterCommonCausticsUV(common, [0, 0, 0], 0, 1)).toEqual([2, 0.5]);
		expect(waterCommonCausticsUV(common, [0, 0, 0], 0, -1)).toEqual([2, 0.5]);
	});

	it('applies source fade/scene threshold/edge to linear caustics emission only', () => {
		expect(waterCommonCausticsEmission(common, [1, 1, 1], [0, 0, 0], 0, 1)).toEqual([
			0.03, 0.03, 0.03,
		]);
		expect(waterCommonCausticsEmission(common, [1, 1, 1], [0.2, 0, 0], 250, 1)).toEqual([
			0.15, 0.15, 0.15,
		]);
		expect(waterCommonCausticsEmission(common, [1, 1, 1], [1, 1, 1], 500, 1)).toEqual([0, 0, 0]);
		expect(waterCommonCausticsEmission(common, [1, 1, 1], [1, 1, 1], 0, 0)).toEqual([0, 0, 0]);
	});

	it('has four RG normal samples and a distinct linearized atlas consumer', () => {
		expect(waterCommonShader.match(/texture2D\(waterCommonBaseNormal/g)).toHaveLength(2);
		expect(waterCommonShader.match(/texture2D\(waterCommonDetailNormal/g)).toHaveLength(2);
		expect(waterCommonShader.match(/texture2D\(waterCommonCausticsTex/g)).toHaveLength(1);
		expect(waterCommonShader).toContain('waterCommonRNM(d2, d1)');
		expect(waterCommonShader).not.toContain('mix(n, vec3(0.0, 0.0, 1.0), waterCommonNormalIntensity)');
		expect(waterCommonShader).toContain('mix(n, vec3(0.0, 0.0, 1.0), waterCommonFinalFlatten)');
		expect(waterCommonShader).not.toMatch(/waterColor|WaterBaseColor|coverage|alpha|pow\(caustic/);
	});

	it('keeps Nature behind-water transport separate from Common emission', () => {
		const nature = {
			causticsProject: [0, 0, 1 / 451] as [number, number, number],
			causticsAtlas: [4, 4, 1, 1 / 200] as [number, number, number, number],
			brightness: 6,
		};

		expect(readWaterCaustics(nature)).toBe(nature);
		expect(readWaterCaustics({ ...nature, brightness: Infinity })).toBeNull();
		expect(waterNatureColorScaleBehindWater(nature, [1, 0.5, 0.25], 0, 0)).toEqual([1, 1, 1]);
		expect(waterNatureColorScaleBehindWater(nature, [1, 0.5, 0.25], 100, 50)).toEqual([
			4, 2.5, 1.75,
		]);
		expect(waterNatureColorScaleBehindWater(nature, [1, 0.5, 0.25], 200, 50)).toEqual([1, 1, 1]);
		expect(waterNatureColorScaleBehindWater(nature, [1, 0.5, 0.25], 100, 25)).toEqual([
			2.5, 1.75, 1.375,
		]);
		expect(waterNatureCausticsShader).toContain('waterCausticsSourceUV');
		expect(waterNatureCausticsShader).not.toMatch(/SelectionColor|CausticsDark|edge/);
	});
});
