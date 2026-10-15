import { describe, expect, it } from 'vitest';
import {
	BufferGeometry,
	Float32BufferAttribute,
	MeshBasicMaterial,
	OneFactor,
	ZeroFactor,
	SrcAlphaFactor,
	OneMinusSrcAlphaFactor,
} from 'three';
import {
	applyWaterFxBlend,
	assertWaterFxGeometry,
	compositeWaterFx,
	readWaterFX,
	sampleWaterFxCoverage,
	waterFxTextureKeys,
	waterFxUniforms,
	type WaterFX,
} from '../../src/materials/water/waterFx.js';

function fixture(blend: WaterFX['blend'] = 'additive'): WaterFX {
	const material = Array.from({ length: 35 }, () => [0, 0, 0, 0]);
	material[27] = [0.1, 0, 0.65, 1.05];
	material[30] = [0, 2, 0.7, 0];
	material[32] = [0, 0, 0, 1];
	material[33] = [1, 0.5, 4, 90];
	material[34] = [200, 0, 1, 0.8];
	return {
		blend,
		material,
		textures: Object.fromEntries(waterFxTextureKeys.map((key) => [key, `/source/${key}`])),
		shader:
			blend === 'additive'
				? 'cd1d929db9a76a43e10b8bfe42bc8abbf6845982'
				: '549f719395aeeeb3f7f1a79c1607c9968af25f90',
		requires: ['native-color-rgba'],
	};
}

const input = {
	baseR: 0.6,
	baseA: 0.8,
	maskR: 0.5,
	maskA: 0.4,
	dissolveR: 0.5,
	uv: [0.3, 0.5] as [number, number],
	vertexAlpha: 0.75,
	tangentViewZ: 0.6,
	depthDeltaCm: 0.25,
	cameraDistanceCm: 190,
	upCloseFade: 0,
};

describe('captured X6FX fountain program', () => {
	it('validates shader/ABI and rejects blend mismatches', () => {
		const config = fixture();
		expect(readWaterFX(config)).toBe(config);
		expect(readWaterFX({ ...config, blend: 'masked' })).toBeNull();
		expect(readWaterFX({ ...config, blend: 'translucent' })).toBeNull();
		config.material[0]![0] = NaN;
		expect(readWaterFX(config)).toBeNull();
	});
	it('uses native additive output alpha0 with ONE/ONE, not alpha twice', () => {
		const material = new MeshBasicMaterial();
		applyWaterFxBlend(material, fixture());
		expect([
			material.blendSrc,
			material.blendDst,
			material.blendSrcAlpha,
			material.blendDstAlpha,
		]).toEqual([OneFactor, OneFactor, ZeroFactor, OneMinusSrcAlphaFactor]);
		expect(material.depthWrite).toBe(false);
		expect(material.premultipliedAlpha).toBe(false);
	});
	it('keeps MI_Liquid_159 translucent, not masked or additive', () => {
		const material = new MeshBasicMaterial();
		applyWaterFxBlend(material, fixture('translucent'));
		expect([material.blendSrc, material.blendDst, material.alphaTest]).toEqual([
			SrcAlphaFactor,
			OneMinusSrcAlphaFactor,
			0,
		]);
		expect([material.blendSrcAlpha, material.blendDstAlpha]).toEqual([
			ZeroFactor,
			OneMinusSrcAlphaFactor,
		]);
	});
	it('proves additive cannot darken a background while wrong normal blending can', () => {
		expect(compositeWaterFx('additive', [0.1, 0.1, 0.1], 0.5, [0.4, 0.5, 0.6])).toEqual([
			0.45, 0.55, 0.65,
		]);
		expect(compositeWaterFx('translucent', [0.1, 0.1, 0.1], 0.5, [0.4, 0.5, 0.6])).toEqual([
			0.25, 0.3, 0.35,
		]);
	});
	it('retains all source coverage factors in shader order', () => {
		const expected = 0.92 * 0.65 * 1 * 0.25 * Math.pow(0.8, 4) * 0.75 * 0.5 * 0.8;
		expect(sampleWaterFxCoverage(fixture(), input)).toBeCloseTo(expected, 12);
		expect(sampleWaterFxCoverage(fixture(), { ...input, depthDeltaCm: -1 })).toBe(0);
		expect(sampleWaterFxCoverage(fixture(), { ...input, dissolveR: 0 })).toBeGreaterThan(0);
		// Authored AnDissolve=.7 makes even zero noise pass partially; do not
		// turn this into a guessed alphaTest or binary cutout.
	});
	it('uses R*A only when authored DeBlackBG is enabled', () => {
		const config = fixture('translucent');
		config.material[27] = [0, 1, 1, 0];

		const a = sampleWaterFxCoverage(config, input);
		const b = sampleWaterFxCoverage(config, { ...input, baseR: 0.3 });
		expect(b).toBeCloseTo(a / 2, 12);
	});
	it('rejects missing native vertex alpha and UV1 rather than inventing white', () => {
		const geometry = new BufferGeometry();
		expect(() => assertWaterFxGeometry(fixture(), geometry)).toThrow('VM COLOR RGBA');
		geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
		geometry.setAttribute('ueWaterFxColor', new Float32BufferAttribute([0.2, 0.3, 0.4, 0.5], 4));
		geometry.setAttribute('uv', new Float32BufferAttribute([0, 0], 2));
		assertWaterFxGeometry(fixture(), geometry);

		const config = fixture();
		config.material[13]![1] = 1;
		expect(() => assertWaterFxGeometry(config, geometry)).toThrow('UV1');
	});
	it('refuses an absent captured cube instead of faking reflection', () => {
		expect(() => waterFxUniforms(fixture(), {})).toThrow('NormalMap');
	});
});
