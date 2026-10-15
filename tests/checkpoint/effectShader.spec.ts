import { describe, expect, it } from 'vitest';
import { ClampToEdgeWrapping, LinearFilter, NoColorSpace, SRGBColorSpace, Texture } from 'three';
import {
	createEffectMaterial,
	readFurnitureEffect,
	type FurnitureEffect,
} from '../../src/materials/effects/effectShader.js';

function fixture(): FurnitureEffect {
	return {
		family: 'effect-base',
		version: 1,
		vertexMask: 'none',
		textureSRGB: [true, false, true, true],
		textureNearest: [false, false, false, false],
		base: {
			color: [1, 1, 1],
			baseUv: [1, 1, 0, 0],
			secondUv: [1, 1, 0, 0],
			alphaUv: [1, 1, 0, 0],
			uvBlend: [0, 0, 0],
			rotation: [0, 0, 0],
			clamp: [0, 0, 0, 0],
			baseChannel: [0, 0, 0, 1],
			alphaChannel: [0, 1, 0, 0],
			baseRefine: [1, 1, 1, 0],
			secondControl: [0, 1],
			alpha: [1, 1, 1, 1],
			baseAdd: 0,
			secondAdd: 0,
			clothAlpha: 1,
		},
	};
}

function shaderSource(material: ReturnType<typeof createEffectMaterial>) {
	const shader = {
		uniforms: {},
		vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
		fragmentShader: '#include <common>\n#include <map_fragment>\n#include <alphamap_fragment>',
	};

	material.onBeforeCompile(shader as never, {} as never);
	return shader;
}

describe('EffectBase native noise', () => {
	it('retains three samples for the existing zero-noise contract', () => {
		const material = createEffectMaterial(fixture(), new Texture(), new Texture(), new Texture());
		const shader = shaderSource(material);
		expect(shader.fragmentShader.match(/texture2D\(/g)).toHaveLength(3);
		expect(shader.fragmentShader).not.toContain('effectNoise1');
		material.dispose();
	});

	it('binds mip-zero native noise without mutating source textures', () => {
		const effect = fixture();
		effect.base!.noise = {
			uv: [
				[2, 3, 0.1, 0.2],
				[4, 5, 0, 0],
			],
			uvBlend: 0.25,
			offset: -0.5,
			strength: 0.001,
			amount: [1, 2, 0.5],
			srgb: [true, false],
			nearest: [false, false],
			wrap: [
				['TA_Clamp', 'TA_Wrap'],
				['TA_Wrap', 'TA_Wrap'],
			],
		};
		expect(readFurnitureEffect(effect)).toBe(effect);

		const source = new Texture();
		source.colorSpace = NoColorSpace;

		const material = createEffectMaterial(effect, new Texture(), new Texture(), new Texture(), source, source);
		const shader = shaderSource(material);
		const uniforms = shader.uniforms as Record<string, { value: Texture }>;
		expect(shader.fragmentShader.match(/texture2D\(/g)).toHaveLength(5);
		expect(shader.fragmentShader).toContain('(texture2D(effectNoise2, effectNuv2).r + effectNoiseOffset)) * effectNoiseStrength');
		expect(shader.fragmentShader).toContain(' + vec2(effectNoise * effectNoiseAmount.x), effectClamp.x');
		expect(shader.vertexShader).toContain('attribute vec2 effectUv1;');
		expect(uniforms.effectNoise1!.value.colorSpace).toBe(SRGBColorSpace);
		expect(uniforms.effectNoise2!.value.colorSpace).toBe(NoColorSpace);
		expect(uniforms.effectNoise1!.value.minFilter).toBe(LinearFilter);
		expect(uniforms.effectNoise1!.value.wrapS).toBe(ClampToEdgeWrapping);
		expect(uniforms.effectNoise1!.value.generateMipmaps).toBe(false);
		expect(source.colorSpace).toBe(NoColorSpace);
		material.dispose();
		expect(() => createEffectMaterial(effect, source, source, source)).toThrow('both native textures');
	});
});
