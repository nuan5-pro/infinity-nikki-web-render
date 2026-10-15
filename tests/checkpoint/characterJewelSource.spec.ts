import { Camera, Color, DirectionalLight } from 'three';
import { describe, expect, it } from 'vitest';
import {
	characterJewelColorCore,
	characterJewelFill,
	characterJewelGlint,
	characterJewelHighlights,
	characterJewelLight,
	characterJewelNormal,
	characterJewelRefractionDirection,
	characterJewelTextureCoordinates,
	characterJewelSurface,
	type CharacterJewelColorParameters,
	type CharacterJewelGlintInput,
	type CharacterJewelLighting,
	type CharacterJewelSamples,
} from '../../src/materials/jewel/characterJewelSource.js';
import { jewelryMaskedEditorLight } from '../../src/materials/jewel/jewelryMaskedRuntime.js';

const lighting: CharacterJewelLighting = {
	primaryDirection: [0, 0, 1],
	primaryColor: [0.2, 0.4, 0.6],
	ready: 0,
	dirLightVectorLimited: [1, 0, 0],
	resolvedSunColor: [0.8, 0.3, 0.1],
	fillIntensity: 2,
	fillSkyColor: [0.6, 0.4, 0.2],
	fillGroundColor: [0.1, 0.2, 0.3],
};

const frame = { tangent: [1, 0, 0], bitangent: [0, 1, 0], normal: [0, 0, 1] } as const;

describe('current CharacterJewel source equations', () => {
	it.each([-1, -0.00001, 0, 0.00001])('Ready=%s selects the real primary light', (ready) => {
		expect(characterJewelLight({ ...lighting, ready })).toEqual({
			direction: lighting.primaryDirection,
			color: lighting.primaryColor,
		});
	});

	it('positive Ready above the source epsilon selects MPC direction and colour together', () => {
		expect(characterJewelLight({ ...lighting, ready: 0.000011 })).toEqual({
			direction: lighting.dirLightVectorLimited,
			color: lighting.resolvedSunColor,
		});
	});

	it('passes actual editor primary light conversion without a guessed RGB or name lookup', () => {
		const light = new DirectionalLight(new Color(0.2, 0.4, 0.6), 3);
		light.position.set(0, 0, 2);
		light.target.position.set(0, 0, 0);

		const input = jewelryMaskedEditorLight(light, new Camera());
		const actual = characterJewelLight({
			...lighting,
			primaryDirection: input.lightDirectionView,
			primaryColor: input.lightLinearColorIntensity,
		});
		expect(actual.direction).toEqual([0, 0, 1]);
		expect(actual.color[0]).toBeCloseTo(0.6);
		expect(actual.color[1]).toBeCloseTo(1.2);
		expect(actual.color[2]).toBeCloseTo(1.8);
	});

	it('does not accept omitted MPC fields as zero defaults', () => {
		expect(() => characterJewelLight({ ...lighting, ready: undefined } as unknown as CharacterJewelLighting)).toThrow('explicit finite');
	});

	it('retains UV1 and the source non-divided tangent ray for normal/bump samples', () => {
		const uv = characterJewelTextureCoordinates(
			[
				[0.2, 0.4],
				[0.6, 0.8],
				[1, 2],
				[3, 4],
			],
			[1, 0, 0, 0],
			2,
			3,
			-0.1,
			0.6,
			2,
			frame,
			[0.6, 0.8, 0],
		);
		expect(uv.diffuse).toEqual([0.4, 0.8]);
		expect(uv.twoUColor).toEqual([0.6, 0.8]);
		expect(uv.normal[0]).toBeCloseTo(0.6, 12);
		expect(uv.refractionNormal[0]).toBeCloseTo(0.564, 12);
		expect(uv.refractionNormal[1]).toBeCloseTo(1.152, 12);
		expect(uv.bump[0]).toBeCloseTo(0.21, 12);
		expect(uv.bump[1]).toBeCloseTo(0.36, 12);
	});

	it('uses the second raw RG normal for refraction rather than the flattened surface normal', () => {
		const direction = characterJewelRefractionDirection([0.75, 0.5], frame, [0, 0, 1], 1);
		const z = 1 + Math.sqrt(0.75);
		expect(direction[0]).toBeCloseTo(-0.5 / Math.hypot(0.5, z), 12);
		expect(direction[2]).toBeCloseTo(-z / Math.hypot(0.5, z), 12);
	});

	it('preserves source flatness extrapolation rather than clamping values above one', () => {
		const n = characterJewelNormal([0.75, 0.5], 3, frame, 1, 0, false, [0, 0, 0, 1]);
		const z = Math.sqrt(0.75) + (1 - Math.sqrt(0.75)) * 3;
		expect(n[0]).toBeCloseTo(-1 / Math.hypot(1, z), 12);
		expect(n[2]).toBeCloseTo(z / Math.hypot(1, z), 12);
	});

	it('applies two-sided sign before and after the frame, including FixTwoSide', () => {
		const original = characterJewelNormal([0.75, 0.5], 0, frame, 1, 0, false, [0, 0, 0, 1]);
		const unfixed = characterJewelNormal([0.75, 0.5], 0, frame, -1, 0, true, [0, 0, 0, 1]);
		unfixed.forEach((value, i) => expect(value).toBeCloseTo(original[i]!, 12));

		const fixed = characterJewelNormal([0.75, 0.5], 0, frame, -1, 1, true, [0, 0, 0, 1]);
		fixed.forEach((value, i) => expect(value).toBeCloseTo(-original[i]!, 12));
	});

	it('retains strip +.01 normalization and the unmodified sphere half-vector', () => {
		const rgb = characterJewelHighlights([0, 0, 1], [0, 0, 1], lighting, [2, 5, 4, 3], [30, 1, 2, 3]);
		const strip = Math.pow(1 - 1.01 / Math.hypot(0.01, 0.01, 1.01), 2);
		expect(rgb[0]).toBeCloseTo(1 + strip * 5, 12);
		expect(rgb[1]).toBeCloseTo(2 + strip * 4, 12);
		expect(rgb[2]).toBeCloseTo(3 + strip * 3, 12);
		expect(characterJewelHighlights([0, 0, 1], [0, 0, 1], { ...lighting, ready: 1 }, [2, 0, 0, 0], [30, 1, 1, 1])[0]).toBeCloseTo(Math.pow(Math.SQRT1_2, 30), 12);
	});

	it('uses source-Z hemisphere smoothstep and actual selected-light length', () => {
		const scale = Math.hypot(0.2, 0.4, 0.6);
		expect(characterJewelFill(-0.5, lighting)[0]).toBeCloseTo(0.1 * 2 * scale, 12);
		expect(characterJewelFill(0.5, lighting)[0]).toBeCloseTo(0.6 * 2 * scale, 12);
		expect(characterJewelFill(0, lighting)[0]).toBeCloseTo(0.35 * 2 * scale, 12);
	});

	const glint: CharacterJewelGlintInput = {
		localPositionCM: [-20, 31, 7],
		maskGreen: 1,
		normalDotView: 0.8,
		distanceBlend: 0,
		vertexFactor: 0.5,
		gameTime: 0,
		aaMethod: 0,
		globalAttributeFactor: 1,
		swapLightFactor: 1,
		maskScale: 1,
		attributes: [1, 0.05, 0.7],
		distanceScale: [1, 0.5, 2, 0.8],
		intensityAndDLSS: [3, 8, 1, 1],
		aaRates: [1, 1],
		color: [5, 5, 5],
		diffuse: [0.2, 0.4, 0.6],
	};

	it('preserves primitive cell hashing, signed position and non-frozen clock', () => {
		const first = characterJewelGlint(glint);
		expect(first.every(Number.isFinite)).toBe(true);
		expect(first[0]).toBeGreaterThan(0);
		expect(characterJewelGlint({ ...glint, gameTime: 0.5 })).not.toEqual(first);
		expect(characterJewelGlint({ ...glint, localPositionCM: [20, 31, 7] })).not.toEqual(first);
		expect(first[1]).toBeCloseTo(first[0] * 2, 6);
		expect(first[2]).toBeCloseTo(first[0] * 3, 6);
	});

	it('maps the source AA branch multipliers without treating zero colour alpha as glint off', () => {
		const baseline = characterJewelGlint(glint)[0];
		expect(characterJewelGlint({ ...glint, aaMethod: 5 })[0]).toBeCloseTo(baseline * 4.5, 6);
		expect(characterJewelGlint({ ...glint, aaMethod: 9 })[0]).toBeLessThanOrEqual(1);
		expect(characterJewelGlint({ ...glint, aaMethod: 10 })[0]).toBeLessThanOrEqual(15);
		expect(characterJewelGlint({ ...glint, maskGreen: 0 })).toEqual([0, 0, 0]);
	});

	const p: CharacterJewelColorParameters = {
		twoUBias: 0,
		specFollowDiffuse: 0,
		hueRadians: 0,
		hdrDesaturation: 0,
		refractionContrast: 1,
		refractionTint: [1, 1, 1],
		diffuseTint: [2, 2, 2],
		refractionAmount: 0,
		reflectionExponent: 5,
		reflectionScale: 0.96,
		reflectionBase: 0.04,
		reflectionTint: [0, 0, 0],
		reflectionFollowDiffuse: 0,
		useRGBBump: 0,
		bumpTint: [0, 0, 0],
		bumpFollowDiffuse: 0,
	};

	const samples: CharacterJewelSamples = {
		diffuse: [0.2, 0.4, 0.6, 0.5],
		twoUColor: [1, 1, 1],
		refraction: [0.5, 0.25, 0.125],
		reflection: [0.7, 0.8, 0.9],
		bump: [0.2, 0.3, 0.4],
	};

	it('starts at refracted diffuse, with diffuse-alpha blending toward tinted diffuse', () => {
		expect(characterJewelColorCore(samples, p, 1, [0, 0, 0], [0, 0, 0])).toEqual([0.1, 0.1, 0.075]);

		const rgb = characterJewelColorCore(samples, { ...p, refractionAmount: 1 }, 1, [0, 0, 0], [0, 0, 0]);
		expect(rgb[0]).toBeCloseTo(0.25, 12);
		expect(rgb[1]).toBeCloseTo(0.45, 12);
		expect(rgb[2]).toBeCloseTo(0.6375, 12);
	});

	it('preserves R-only versus RGB bump and explicit nonzero glint', () => {
		const parameters = { ...p, refractionTint: [0, 0, 0] as const, bumpTint: [1, 2, 3] as const };
		expect(characterJewelColorCore(samples, parameters, 1, [0, 0, 0], [1, 2, 3])).toEqual([
			1.2, 2.4, 3.6,
		]);

		const rgb = characterJewelColorCore(samples, { ...parameters, useRGBBump: 1 }, 1, [0, 0, 0], [0, 0, 0]);
		expect(rgb[0]).toBeCloseTo(0.2, 12);
		expect(rgb[1]).toBeCloseTo(0.6, 12);
		expect(rgb[2]).toBeCloseTo(1.2, 12);
	});

	it('preserves VFX post-DIY base attenuation without merging it with ordinary Jewel', () => {
		const uniforms = Array.from({ length: 39 }, () => [0, 0, 0, 0] as [number, number, number, number]);
		uniforms[24] = [1, 0.25, 0, 0];
		uniforms[25] = [0.5, 1, 1, 0.4];
		uniforms[26] = [1, 2, 0, 0];
		uniforms[30] = [2, 0, 0.1, 0];
		uniforms[32] = [0, 1.02, -0.01, 0];
		uniforms[33] = [-0.01, 0, 0, 0];
		uniforms[38] = [0, 0, 0, 0.8];

		const input = {
			uniforms,
			colorCore: [0.2, 0.4, 0.6] as const,
			twoUColor: [1, 1, 1] as const,
			normalDotView: 1,
			normalDotLight: 1,
			bumpAlpha: 0.5,
			maskRed: 0.5,
			dissolveNoise: 0.5,
			spatialDissolve: 0,
			edgeMask: 1,
			sourceNormalZ: 0.5,
			lighting: { ...lighting, fillIntensity: 0 },
			globalFactor: 1,
			inversePreExposure: 1,
			preExposure: 1,
			vfxBaseAttenuation: false,
		};

		const surface = characterJewelSurface(input);
		const vfx = characterJewelSurface({ ...input, vfxBaseAttenuation: true });
		surface.baseColor.forEach((c, i) => expect(vfx.baseColor[i]).toBeCloseTo(c * 0.75, 12));
		surface.emission.forEach((c, i) => expect(vfx.emission[i]).toBeCloseTo(c * 0.75, 12));
		expect(surface.specular).toBeCloseTo(0.4, 12);
		expect(surface.roughness).toBeCloseTo(0.4, 12);
		expect(characterJewelSurface({ ...input, globalFactor: 0 }).specular).toBe(1);
		expect(characterJewelSurface({ ...input, preExposure: 4, inversePreExposure: 0.25 }).emission[0]).toBeCloseTo(surface.emission[0] * 0.25, 12);
	});
});
