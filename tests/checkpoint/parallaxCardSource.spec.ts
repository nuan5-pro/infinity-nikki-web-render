import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	parallaxCardNativeCore,
	parallaxCardSampleColor,
	validateParallaxCardRuntime,
	type ParallaxCardColors,
	type ParallaxCardRuntime,
	type ParallaxCardSamples,
} from '../../src/materials/effects/parallaxCardSource.js';

const path = process.env.PARALLAX_CARD_PROFILE_EVIDENCE;
const actual = path
	? (JSON.parse(readFileSync(path, 'utf8')) as {
		colors: ParallaxCardColors
		scalars: Record<string, number>
	})
	: null;

describe('ParallaxCard native source ABI (not full-object visual acceptance)', () => {
	const runtime: ParallaxCardRuntime = {
		gameTime: 23.4,
		swapLightFactor: 1,
		materialTextureMipBias: 0,
		preExposure: 1,
		outputClamp: 65504,
		nativeCullingSign: 1,
		nativePrimitiveDeterminantSign: 1,
		nativeFrontFaceParity: 1,
	};

	const sample: ParallaxCardSamples = {
		bg: [0.3, 0.4, 0.5],
		bgEmissive: [0.1, 0.2, 0.3],
		character: [0.4, 0.5, 0.6, 0.7],
		characterEmissive: [0.3, 0.2, 0.1],
		noiseR: 0.4,
	};

	it('requires all explicit view/clock/facing fields; rejects guessed zero signs', () => {
		validateParallaxCardRuntime(runtime);
		expect(() =>
			validateParallaxCardRuntime({
				...runtime,
				gameTime: undefined,
			} as unknown as ParallaxCardRuntime),
		).toThrow('explicit native');
		expect(() =>
			validateParallaxCardRuntime({
				...runtime,
				nativeFrontFaceParity: 0,
			} as unknown as ParallaxCardRuntime),
		).toThrow('explicit native');
	});

	it('retains native signed ray, raw interpolated basis, live clock and R swizzle', () => {
		expect(parallaxCardNativeCore).toContain('cardDepthBG/signedNdotV');
		expect(parallaxCardNativeCore).toContain('cardDepth/signedNdotV');
		expect(parallaxCardNativeCore).toContain('charUV+cardGameTime*cardNoiseSpeed');
		expect(parallaxCardNativeCore).toContain('cardO,charUV+cardGameTime*cardNoiseSpeed,cardMipBias).r');
		expect(parallaxCardNativeCore).not.toContain('abs(signedNdotV)');
		expect(parallaxCardNativeCore).not.toContain('normalize(nativeN)');
		expect(parallaxCardNativeCore).not.toContain('discard');
		expect(parallaxCardNativeCore).toContain('return vec4(color,1.0)');
	});

	it('reproduces the two current target fragments from actual replay sample registers', () => {
		const f = (word: number) => new Float32Array(new Uint32Array([word]).buffer)[0]!;

		const colors: ParallaxCardColors = {
			'Emissive Base Color': [1, 1, 1, 0],
			'Emissive Base Color Night': [0.453125, 0.453125, 0.453125, 0],
			'Emissive BG Color': [0.5, 0.39295101165771484, 0.25587400794029236, 0],
			'Emissive BG Color Night': [1, 0.7859020233154297, 0.5117480158805847, 0],
			'Emissive Character Color': [3, 2.809299945831299, 2.296875, 0],
			'Emissive Character Color Night': [
				1.600000023841858, 0.9566259980201721, 0.06666699796915054, 0,
			],
			CharacterColor: [1, 0.9219629764556885, 0.8489570021629333, 0],
			SelectionColor: [0, 0, 0, 0],
		};

		const captured: ParallaxCardRuntime = {
			...runtime,
			gameTime: 1013.95294189453125,
			swapLightFactor: 1,
			preExposure: 0.5541632771492004,
			materialTextureMipBias: -0.8838358521461487,
			outputClamp: 32256,
		};

		const card262 = parallaxCardSampleColor(
			colors,
			{
				bg: [1031217152, 1039327232, 1049550848].map(f) as [number, number, number],
				bgEmissive: [1014571008, 1023492096, 1021599744].map(f) as [number, number, number],
				character: [1032142848, 1040392192, 1050173440, 1065353216].map(f) as [
					number,
					number,
					number,
					number,
				],
				characterEmissive: [0, 0, 0],
				noiseR: 1,
			},
			[f(1056473987), f(1059766997)],
			1,
			captured,
		);
		const card273 = parallaxCardSampleColor(
			{ ...colors, CharacterColor: [0.7604169845581055, 0.70107501745224, 0.6455619931221008, 0] },
			{
				bg: [1050435584, 1053024256, 1057308672].map(f) as [number, number, number],
				bgEmissive: [0, 0, 0],
				character: [1050435584, 1053024256, 1057308672, 1065353216].map(f) as [
					number,
					number,
					number,
					number,
				],
				characterEmissive: [1037770752, 1034092544, 1028308992].map(f) as [number, number, number],
				noiseR: 1,
			},
			[f(1053344752), f(1047929944)],
			1,
			captured,
		);
		for (const [actual, expected] of [
			[card262, [0.036055788397789, 0.06542395055294037, 0.14001262187957764, 1]],
			[card273, [0.2639635503292084, 0.2354992777109146, 0.22688370943069458, 1]],
		])
			actual!.forEach((value, i) => expect(value).toBeCloseTo(expected![i]!, 6));
	});

	it.skipIf(!actual)(
		'uses actual HDR source parameters; character alpha changes RGB, never coverage',
		() => {
			const profile = actual!;
			expect(profile.scalars.Depth).toBe(0.15);
			expect(profile.scalars['Y Noise Speed']).toBe(0.1);
			expect(profile.colors['Emissive BG Color'][1]).toBe(5);

			const inside = parallaxCardSampleColor(profile.colors, sample, [0.4, 0.4], profile.scalars['Noise Intensity']!, runtime);
			const noCharacter = parallaxCardSampleColor(profile.colors, { ...sample, character: [0.4, 0.5, 0.6, 0] }, [0.4, 0.4], 1, runtime);
			expect(inside[3]).toBe(1);
			expect(noCharacter[3]).toBe(1);
			expect(inside.slice(0, 3)).not.toEqual(noCharacter.slice(0, 3));
			expect(noCharacter[1]).toBeCloseTo(0.4 + 0.2 * 5);
		},
	);

	it.skipIf(!actual)(
		'native [0,1) character window excludes negative and >=1 tiles; independent BG survives',
		() => {
			const colors = actual!.colors;
			const negative = parallaxCardSampleColor(colors, sample, [-0.01, 0.4], 1, runtime);
			const endpoint = parallaxCardSampleColor(colors, sample, [1, 0.4], 1, runtime);
			const background = parallaxCardSampleColor(colors, { ...sample, character: [0, 0, 0, 0] }, [0.4, 0.4], 1, runtime);
			expect(negative).toEqual(background);
			expect(endpoint).toEqual(background);
			expect(parallaxCardSampleColor(colors, sample, [0.4, 0.4], 1, { ...runtime, swapLightFactor: 0 })).not.toEqual(parallaxCardSampleColor(colors, sample, [0.4, 0.4], 1, runtime));
		},
	);
});
