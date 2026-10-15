import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, ShaderLib, type WebGLRenderer } from 'three';
import { applyHomeObjectLightDefault } from '../../src/furniture/lightDefault.js';
import {
	applySurfaceShader,
	type FurnitureSurface,
} from '../../src/materials/surface/surfaceShader.js';
import type { FurnitureModelConfig } from '../../src/furniture/types.js';

const surface: FurnitureSurface = {
	family: 'home-opaque-pattern',
	color: [1, 1, 1],
	roughness: [0, 1],
	metalness: [0, 1],
	ao: [0, 1],
	uvScale: 1,
	uvOffset: [0, 0],
	normalUvScale: 1,
	tintUvBlend: 1,
	tintMaskBias: 0,
	textureSRGB: [true, false, false, true],
	vertexEmissive: 'source-blue',
	emissiveCore: [20, 14.777777, 10.208332],
	emissiveParams: [1, 1, 1],
};

const config = {
	lightPreview: 'home-object-light-off',
	meshes: [{ slots: ['m-light', 'm-body'] }],
} as FurnitureModelConfig;

function material(profile = surface) {
	const result = new MeshStandardMaterial();
	result.userData = { surface: profile };
	applySurfaceShader(result, profile, null, null);
	return result;
}

function compile(material: MeshStandardMaterial) {
	const shader = {
		uniforms: {},
		vertexShader: ShaderLib.standard.vertexShader,
		fragmentShader: ShaderLib.standard.fragmentShader,
	} as Parameters<typeof material.onBeforeCompile>[0];

	material.onBeforeCompile(shader, {} as WebGLRenderer);
	return shader;
}

describe('Home light native default state', () => {
	it('keeps proved slot 0 off without affecting other slots, non-lamps or source material values', () => {
		const before = JSON.stringify(surface);
		const lamp = material();
		const body = material();
		const source = material();
		applyHomeObjectLightDefault(config, [lamp, body], ['m-light:source', 'm-body:source'], [0, 0]);

		const callback = lamp.onBeforeCompile;
		applyHomeObjectLightDefault(config, [lamp, body], ['m-light:source', 'm-body:source'], [0, 0]);
		expect(lamp.onBeforeCompile).toBe(callback);
		applyHomeObjectLightDefault({ ...config, lightPreview: undefined }, [source], ['m-light:source'], [0]);
		expect(compile(lamp).uniforms.homeEmissiveCore!.value.toArray()).toEqual([0, 0, 0]);
		expect(compile(body).uniforms.homeEmissiveCore!.value.toArray()).toEqual(surface.emissiveCore);
		expect(compile(source).uniforms.homeEmissiveCore!.value.toArray()).toEqual(surface.emissiveCore);
		expect(lamp.color.toArray()).toEqual(source.color.toArray());
		expect(lamp.roughness).toBe(source.roughness);
		expect(JSON.stringify(surface)).toBe(before);
	});

	it('is idempotent and preserves an authored disabled HomeEmissiveToggle', () => {
		const authoredOff = { ...surface, emissiveParams: [1, 0, 1] as [number, number, number] };
		const lamp = material(authoredOff);
		applyHomeObjectLightDefault(config, [lamp], ['m-light:source'], [0]);

		const callback = lamp.onBeforeCompile;
		applyHomeObjectLightDefault(config, [lamp], ['m-light:source'], [0]);
		expect(lamp.onBeforeCompile).toBe(callback);

		const shader = compile(lamp);
		expect(shader.uniforms.homeEmissiveParams!.value.toArray()).toEqual([1, 0, 1]);
		expect(shader.uniforms.homeEmissiveCore!.value.toArray()).toEqual(surface.emissiveCore);
		expect(shader.fragmentShader).not.toContain('furnitureLightEnabled');
		expect(shader.fragmentShader).not.toContain('furnitureLightLuminance');
		expect(authoredOff.emissiveParams).toEqual([1, 0, 1]);
	});
});
