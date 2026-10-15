import { DirectionalLight, PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import {
	jewelryMaskedDistanceBlend,
	jewelryMaskedEditorLight,
	type JewelryMaskedDistanceInput,
} from '../../src/materials/jewel/jewelryMaskedRuntime.js';

const sourceInput = (): JewelryMaskedDistanceInput => ({
	cameraTile: [0, 0, 0],
	cameraOffsetCM: [0, 0, 200],
	objectBoundsTile: [0, 0, 0],
	objectBoundsOffsetCM: [0, 0, 0],
	viewportPixels: [1600, 800],
	clipToView00: 2,
	globalAttributeFactor: 1,
});

describe('exact Masked runtime input boundary', () => {
	it('follows PS206–220 including LWC high/low cancellation and bounds centre', () => {
		const input = sourceInput();
		const f = Math.fround;
		const expected = f(f(200 - f(f(f(2 / 2) * f(0.6)) * 75)) / 300);
		expect(jewelryMaskedDistanceBlend(input)).toBe(expected);
		expect(
			jewelryMaskedDistanceBlend({
				...input,
				cameraTile: [1, 0, 0],
				cameraOffsetCM: [-2097152, 0, 200],
			}),
		).toBe(expected);
		expect(jewelryMaskedDistanceBlend({ ...input, objectBoundsOffsetCM: [0, 0, 200] })).toBe(0);
		expect(jewelryMaskedDistanceBlend({ ...input, cameraOffsetCM: [0, 0, 10000] })).toBe(1);
	});

	it('rejects missing/nonphysical projection/viewport and unproved factors', () => {
		const input = sourceInput();
		for (const changed of [
			{ clipToView00: 0 },
			{ clipToView00: -1 },
			{ globalAttributeFactor: 2 },
			{ viewportPixels: [800.5, 400] as const },
			{ viewportPixels: [800, 0] as const },
			{ cameraOffsetCM: [Infinity, 0, 0] as const },
		]) {
			expect(() => jewelryMaskedDistanceBlend({ ...input, ...changed })).toThrow();
		}
	});

	it('uses actual non-white HDR light and target in the actual camera frame', () => {
		const scene = new Scene();
		const camera = new PerspectiveCamera();
		const light = new DirectionalLight(0xffffff, 3);
		light.color.setRGB(0.2, 0.4, 0.8);
		light.position.set(2, 0, 0);
		scene.add(camera, light, light.target);
		scene.updateMatrixWorld(true);
		camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

		const input = jewelryMaskedEditorLight(light, camera);
		expect(input.lightDirectionView).toEqual([1, 0, 0]);
		expect(input.lightLinearColorIntensity).toEqual([0.2 * 3, 0.4 * 3, 0.8 * 3]);
		light.position.set(0, 0, 0);
		light.updateMatrixWorld(true);
		expect(() => jewelryMaskedEditorLight(light, camera)).toThrow();
	});
});
