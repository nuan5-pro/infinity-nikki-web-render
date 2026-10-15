import { describe, expect, it } from 'vitest';
import {
	commonSourceOptics,
	commonSourcePBR,
	type CommonSourceOpticsInput,
} from '../../src/materials/water/waterCommonLighting.js';

const input: CommonSourceOpticsInput = {
	color: [1.375, 6, 4.612500190734863],
	scene: [0.06683349609375, 0.0364990234375, 0.0184783935546875],
	absorption: [1.1165369749069214, 0.7407407164573669, 0.969049870967865],
	axialDepthCm: 12.159912109375,
	transmittance: 0.9900000095367432,
	sourceCoverage: 0.9399999976158142,
	vertexB: 1,
};

describe('isolated Common native BaseColor lighting consumer', () => {
	it('keeps the authored deep-water optical color instead of fitting blue', () => {
		const state = commonSourceOptics(input);
		// Actual archived pixel461/229, replayed from original DWORD instructions;
		// finite axial depth is not the infinitely-deep 1-transmittance² limit.
		const originalF32 = [0.027374625205993652, 0.11945629119873047, 0.09182929992675781];
		// Analytic doubles do not round the two MULs/subtractive HDR mix as the
		// original F32 replay does. Bound this cross-precision comparison by the
		// input RGB scale, while keeping the analytic value assertion strict.
		const crossPrecisionBound = 2 * 2 ** -23 * Math.max(...input.color);
		for (let channel = 0; channel < 3; channel++) {
			expect(Math.abs(state.baseColor[channel]! - originalF32[channel]!)).toBeLessThan(crossPrecisionBound);
		}

		expect(state.baseColor[1]).toBeCloseTo(0.11945685783811744, 12);
		expect(state.alpha).toBeCloseTo(0.94, 5);
		expect(state.baseColor[1]).toBeGreaterThan(state.baseColor[2]);
	});

	it('uses source vertex B only in alpha, with no white fallback', () => {
		const zero = commonSourceOptics({ ...input, vertexB: 0 });
		expect(zero.alpha).toBe(0);
		expect(zero.baseColor).toEqual(commonSourceOptics(input).baseColor);
	});

	it('feeds the evaluated optical RGB into both DefaultLit albedos', () => {
		const state = commonSourceOptics(input);
		expect(commonSourcePBR(state.baseColor, 0, 0.0204)).toEqual({
			diffuse: state.baseColor,
			specular: [0.0204, 0.0204, 0.0204],
		});
		expect(commonSourcePBR(state.baseColor, 1, 0.0204)).toEqual({
			diffuse: [0, 0, 0],
			specular: state.baseColor,
		});

		const partial = commonSourcePBR(state.baseColor, 0.4, 0.0204);
		for (let channel = 0; channel < 3; channel++) {
			expect(partial.diffuse[channel]).toBeCloseTo(state.baseColor[channel]! * 0.6);
			expect(partial.specular[channel]).toBeCloseTo(0.0204 * 0.6 + state.baseColor[channel]! * 0.4);
		}
	});

	it('shows the precise unlit-background adaptation difference under fixed irradiance', () => {
		const state = commonSourceOptics(input);
		const sigma = input.absorption[1];
		const background = input.scene[1];
		const transmission = Math.exp(-input.axialDepthCm * sigma);
		const loss =
			1 -
			Math.max(...input.scene.map((value, i) => value * Math.exp(-input.axialDepthCm * input.absorption[i]!)));
		const transported = transmission * Math.min(1, Math.max(0, loss * input.transmittance)) ** 2 * background;
		for (const light of [0, 1, 2]) {
			const adapted = state.alpha * (light * (state.baseColor[1] - transported) + transported);
			const source = state.alpha * light * state.baseColor[1];
			expect(source - adapted).toBeCloseTo(state.alpha * (light - 1) * transported, 12);
		}
	});
});
