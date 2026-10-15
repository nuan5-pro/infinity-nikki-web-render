import { ShaderLib, Texture, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import {
	createGlassMaterial,
	readFurnitureGlass,
	type FurnitureGlass,
} from '../../src/materials/glass/glassShader.js';

function source(colorMode: FurnitureGlass['colorMode']): FurnitureGlass {
	return {
		family: 'glass-lowcost',
		colorMode,
		color: [1, 1, 1],
		opacity: -0.52588,
		roughnessScale: 1,
		roughnessOpacity: 0,
		reflectionOpacity: 1,
		fresnelPower: 5,
		baseBlend: 0.3608,
		aoIntensity: 0,
		emissive: [0.028686, 0.018193, 0.041667],
		roughnessFresnelIntensity: 0,
		roughnessDarken: 0,
		brightness: 1,
		opacityRange: [0, 0],
		opacityFresnel: [0, 0],
		roughnessRange: [0, 0],
		dirtColor: [0, 0, 0],
		dirtIntensity: 0,
	};
}

describe('source-bound static stained window consumer', () => {
	it('preserves signed source opacity but uses declared filter density and depth state', () => {
		const input = source('stained-window-preview');
		expect(readFurnitureGlass(input)).toBe(input);

		const material = createGlassMaterial(input, new Texture(), null);
		expect(input.opacity).toBe(-0.52588);
		expect(material.opacity).toBe(0.3608);
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);
		expect(material.depthTest).toBe(true);
		material.dispose();
	});

	it('uses two-sided Fresnel and only one final alpha equation independent of PNG alpha', () => {
		const material = createGlassMaterial(source('stained-window-preview'), new Texture(), null);

		const shader: Parameters<typeof material.onBeforeCompile>[0] = {
			uniforms: {},
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
		};

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader).toContain('pow(max(1.0 - abs(glassDot), 0.0), glassFresnelPower)');

		const equation = 'diffuseColor.a = clamp(glassBaseBlend + (1.0 - glassBaseBlend) * glassFresnel, 0.0, 1.0);';
		expect(shader.fragmentShader.split(equation)).toHaveLength(2);
		expect(shader.fragmentShader).not.toContain('glassOpacity + glassRoughness');
		material.dispose();
	});

	it('does not change absent-opt-in glass and refuses unsupported density/family', () => {
		const old = createGlassMaterial(source('scene'), new Texture(), null);
		expect(old.opacity).toBe(0);
		expect(old.customProgramCacheKey()).toContain('_scene_');
		for (const baseBlend of [0, -1, 2, Number.NaN]) {
			expect(readFurnitureGlass({ ...source('stained-window-preview'), baseBlend })).toBeNull();
		}

		expect(readFurnitureGlass({ ...source('stained-window-preview'), family: 'glass-lowcost-pattern' })).toBeNull();
		old.dispose();
	});
});
