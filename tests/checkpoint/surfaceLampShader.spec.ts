import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, type WebGLRenderer } from 'three';
import {
	evaluateSurfaceLampEmission,
	readFurnitureSurfaceLamp,
	readFurnitureSurfaceLampPreview,
	surfaceLampMembership,
	surfaceLampPreviewMembership,
	type SurfaceLampStates,
	type SurfaceLampEnvironment,
} from '../../src/materials/surface/surfaceLampShader.js';
import {
	applySurfaceShader,
	readFurnitureSurface,
	type FurnitureSurface,
} from '../../src/materials/surface/surfaceShader.js';

const sourceDefaults: SurfaceLampStates = [-1, -1, -1, -1, -1, -1];

function environmentFixture(): SurfaceLampEnvironment {
	const indices = [52, 53, 54, 55, 56, 64];

	const names = [
		'UrbanLightState_0',
		'UrbanLightState_1001',
		'UrbanLightState_1002',
		'UrbanLightState_1003',
		'UrbanLightState_1004',
		'UrbanLightState_1005',
	];

	return {
		slots: indices.map((index, i) => ({ index, name: names[i]!, value: -1 })),
	};
}

function surfaceFixture(): FurnitureSurface {
	return {
		family: 'opaque-standard',
		color: [1, 1, 1],
		roughness: [0, 1],
		metalness: [0, 1],
		ao: [0, 1],
		uvScale: 1,
		uvOffset: [0, 0],
		normalUvScale: 1,
		tintUvBlend: 0,
		tintMaskBias: 0,
		textureSRGB: [true, false, false, false],
		emissiveCore: [3, 2, 1],
		emissiveOuter: [0, 0, 0],
		emissiveParams: [1, 0.5, 1],
		lamp: { useDESLamp: 0.3, lightID: 0, environment: environmentFixture() },
	};
}

describe('captured ordinary DESLamp consumer', () => {
	it('keeps fractional source weights and needs an explicit environment', () => {
		const lamp = { useDESLamp: 0.3, lightID: 0 };
		expect(readFurnitureSurfaceLamp(lamp)).toBe(lamp);
		expect(readFurnitureSurfaceLamp({ ...lamp, useDESLamp: true })).toBeNull();
		expect(evaluateSurfaceLampEmission([3, 2, 1], lamp, null)).toBeNull();
		expect(evaluateSurfaceLampEmission([3, 2, 1], lamp, sourceDefaults)).toEqual([2.1, 1.4, 0.7]);
		expect(lamp.useDESLamp).toBe(0.3);
	});

	it('uses every real slot and truncates only material LightID', () => {
		const lamp = { useDESLamp: 0.2, lightID: -0.9 };
		for (let i = 0; i < 6; i++) {
			const states = [...sourceDefaults] as [number, number, number, number, number, number];
			states[i] = 0;
			expect(surfaceLampMembership(lamp, states)).toBe(1);
			states[i] = 0.9;
			expect(surfaceLampMembership(lamp, states)).toBe(0);
		}

		expect(surfaceLampMembership(lamp, [-1, -1, -1, -1, -1, NaN])).toBeNull();
	});

	it('eliminates exactly dead input without inventing membership or erasing RGB', () => {
		expect(evaluateSurfaceLampEmission([0, 0, 0], { useDESLamp: 1, lightID: 0 }, null)).toEqual([
			0, 0, 0,
		]);
		expect(evaluateSurfaceLampEmission([1e-12, 0, 0], { useDESLamp: 1, lightID: 0 }, null)).toBeNull();
		expect(evaluateSurfaceLampEmission([3, 2, 1], { useDESLamp: 0, lightID: 0 }, null)).toEqual([
			3, 2, 1,
		]);
		expect(evaluateSurfaceLampEmission([3, 2, 1], { useDESLamp: 1.5, lightID: 0 }, sourceDefaults)).toEqual([-1.5, -1, -0.5]);
	});

	it('validates lamp slots and excludes HBC materials', () => {
		const surface = surfaceFixture();
		expect(readFurnitureSurface(surface)).toBe(surface);
		expect(surfaceLampPreviewMembership(surface.lamp!)).toBe(0);
		expect(readFurnitureSurfaceLampPreview({ useDESLamp: 0.3, lightID: 0 })).toBeNull();

		const guessed = surfaceFixture();
		guessed.lamp!.environment!.slots[0]!.value = 0;
		expect(readFurnitureSurface(guessed)).toBeNull();

		const truncated = surfaceFixture();
		truncated.lamp!.environment!.slots.pop();
		expect(readFurnitureSurface(truncated)).toBeNull();

		const hbc = surfaceFixture();
		hbc.family = 'opaque-hbc';
		expect(readFurnitureSurface(hbc)).toBeNull();
		expect(() => applySurfaceShader(new MeshStandardMaterial(), hbc, null, null)).toThrow();
	});

	it('injects native consumer before ORM/base/contrast with original weight and distinct program key', () => {
		const surface = surfaceFixture();
		const sourceBefore = JSON.stringify(surface);
		const material = new MeshStandardMaterial();
		applySurfaceShader(material, surface, null, null);

		const shader = {
			uniforms: {},
			vertexShader: '#include <common>\n#include <begin_vertex>',
			fragmentShader: '#include <common>\n#include <map_fragment>\n#include <emissivemap_fragment>',
		} as Parameters<MeshStandardMaterial['onBeforeCompile']>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.uniforms.homeUseDESLamp!.value).toBe(0.3);
		expect(shader.uniforms.homeLampMembership!.value).toBe(0);

		const mix = shader.fragmentShader.indexOf('vec3 sourceEmission = mix(');
		const lamp = shader.fragmentShader.indexOf('sourceEmission = furnitureDESLamp(');
		const orm = shader.fragmentShader.indexOf('sourceEmission *= furnitureOrm.a * furnitureSurfaceBase;');
		const contrast = shader.fragmentShader.indexOf('sourceEmission = (sourceEmission - 0.5) * homeEmissiveParams.y + 0.5;');
		expect(mix).toBeGreaterThan(-1);
		expect(lamp).toBeGreaterThan(mix);
		expect(orm).toBeGreaterThan(lamp);
		expect(contrast).toBeGreaterThan(orm);
		expect(shader.fragmentShader).not.toContain('totalEmissiveRadiance *=');
		expect(JSON.stringify(surface)).toBe(sourceBefore);

		const withoutLamp = surfaceFixture();
		delete withoutLamp.lamp;

		const other = new MeshStandardMaterial();
		applySurfaceShader(other, withoutLamp, null, null);
		expect(material.customProgramCacheKey()).not.toBe(other.customProgramCacheKey());
		material.dispose();
		other.dispose();
	});
});
