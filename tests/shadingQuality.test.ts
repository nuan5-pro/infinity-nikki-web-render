import { describe, expect, it, vi } from 'vitest';
import { MeshPhysicalMaterial, MeshStandardMaterial, ShaderLib, Texture, type WebGLRenderer } from 'three';
import { applyShadingQuality } from '../src/runtime/shadingQuality.js';
import { applyEnvironmentLighting } from '../src/runtime/environmentLighting.js';

function compile(material: MeshStandardMaterial) {
	const shader = {
		uniforms: {} as Record<string, { value: unknown }>,
		vertexShader: ShaderLib.standard.vertexShader,
		fragmentShader: ShaderLib.standard.fragmentShader,
	};
	material.onBeforeCompile(shader as never, {} as WebGLRenderer);
	return shader;
}

describe('shared shading quality', () => {
	it('leaves original shader callbacks and keys untouched', () => {
		const material = new MeshStandardMaterial();
		material.userData.surface = {};
		const before = material.onBeforeCompile, key = material.customProgramCacheKey();
		applyShadingQuality(material, 'original', 'surface');
		expect(material.onBeforeCompile).toBe(before);
		expect(material.customProgramCacheKey()).toBe(key);
	});

	it.each(['physical', 'transparent'])('preserves the %s material path', (kind) => {
		const material = kind === 'physical' ? new MeshPhysicalMaterial() : new MeshStandardMaterial();
		if (kind === 'transparent') material.transparent = true;
		const before = material.onBeforeCompile, key = material.customProgramCacheKey();
		applyShadingQuality(material, 'economy', 'standard');
		expect(material.onBeforeCompile).toBe(before);
		expect(material.customProgramCacheKey()).toBe(key);
	});

	it.each(['surface', 'layered', 'foliage'] as const)('preserves %s geometry inputs and coverage', (family) => {
		const map = new Texture(), normalMap = new Texture();
		const material = new MeshStandardMaterial({ map, normalMap, alphaTest: 0.5 });
		material.userData[family] = {};
		const original = vi.fn();
		material.onBeforeCompile = original;
		applyEnvironmentLighting(material);
		applyShadingQuality(material, 'performance', family);
		const shader = compile(material);
		expect(original).toHaveBeenCalledOnce();
		expect(shader.vertexShader).toBe(ShaderLib.standard.vertexShader);
		expect(material.normalMap).toBe(normalMap);
		expect(material.map).toBe(map);
		expect(material.alphaTest).toBe(0.5);
		expect(shader.fragmentShader).toContain('#include <alphatest_fragment>');
		expect(shader.fragmentShader.includes('#undef USE_NORMALMAP_TANGENTSPACE')).toBe(family === 'foliage');
		expect(shader.fragmentShader).toContain('editorEnvironmentSpecularTint');
	});

	it('keeps metallic reflections and coloured highlights in economy', () => {
		const material = applyShadingQuality(new MeshStandardMaterial(), 'economy', 'standard');
		const shader = compile(material);
		expect(shader.fragmentShader).toContain('#include <bsdfs>');
		expect(shader.fragmentShader).toContain('material.specularColorBlended');
		expect(shader.fragmentShader).toContain('if (material.metalness > 0.01) radiance += getIBLRadiance');
		expect(shader.fragmentShader).toContain('geometryNormal, 0.8)');
		expect(shader.fragmentShader).toContain('#undef USE_NORMALMAP_TANGENTSPACE');
		expect(shader.fragmentShader).toContain('#define EDITOR_SUPER_PERFORMANCE');
		expect(shader.vertexShader).toBe(ShaderLib.standard.vertexShader);
	});

	it('uses distinct program keys and refuses to stack conflicting profiles', () => {
		const first = applyShadingQuality(new MeshStandardMaterial(), 'performance', 'standard');
		const second = applyShadingQuality(new MeshStandardMaterial(), 'economy', 'standard');
		const before = first.onBeforeCompile;
		applyShadingQuality(first, 'performance', 'standard');
		expect(first.onBeforeCompile).toBe(before);
		expect(first.customProgramCacheKey()).not.toBe(second.customProgramCacheKey());
		expect(() => applyShadingQuality(first, 'economy', 'standard')).toThrow('Recreate');
	});

	it('enables removal of foliage surface details only in economy foliage', () => {
		for (const family of ['foliage', 'surface', 'layered'] as const) {
			for (const quality of ['original', 'performance', 'economy'] as const) {
				const material = new MeshStandardMaterial();
				material.userData[family] = {};
				applyShadingQuality(material, quality, family);
				expect(compile(material).fragmentShader.includes('#define EDITOR_SIMPLE_FOLIAGE'))
					.toBe(family === 'foliage' && quality === 'economy');
				expect(compile(material).fragmentShader.includes('#define EDITOR_SIMPLE_LAYERS'))
					.toBe(family === 'layered' && quality === 'economy');
			}
		}
	});

	it('uses the explicitly selected family rather than asset metadata', () => {
		const material = new MeshStandardMaterial();
		material.userData.foliage = {};
		applyShadingQuality(material, 'performance', 'standard');
		expect(compile(material).fragmentShader).not.toContain('#undef USE_NORMALMAP_TANGENTSPACE');
	});
});
