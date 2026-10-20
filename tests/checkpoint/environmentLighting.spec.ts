import { describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial, ShaderLib, type WebGLRenderer } from 'three';
import {
	applyEnvironmentLighting,
	setEnvironmentDiffuseWeight,
	setEnvironmentReflection,
} from '../../src/runtime/environmentLighting.js';

describe('environment lighting weights', () => {
	it('returns before the diffuse lookup at zero weight without changing specular sampling', () => {
		const material = applyEnvironmentLighting(new MeshStandardMaterial());
		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		try {
			material.onBeforeCompile(shader as never, {} as WebGLRenderer);
			const fragment = shader.fragmentShader;
			const irradiance = fragment.slice(fragment.indexOf('vec3 getIBLIrradiance'), fragment.indexOf('vec3 getIBLRadiance'));
			expect(irradiance.indexOf('if ( editorEnvironmentDiffuseWeight == 0.0 ) return vec3( 0.0 );')).toBeGreaterThan(0);
			expect(irradiance.indexOf('return vec3( 0.0 );')).toBeLessThan(irradiance.indexOf('textureCubeUV('));
			expect(irradiance).toContain('return PI * envMapColor.rgb * envMapIntensity * editorEnvironmentDiffuseWeight;');
			expect(fragment).toContain('textureCubeUV( envMap, envMapRotation * reflectVec, roughness )');
			expect(fragment).toContain('return envMapColor.rgb * envMapIntensity * editorEnvironmentSpecularTint;');
		} finally {
			material.dispose();
		}
	});

	it.each([false, true])('updates shared draw uniforms without rebuilding the shader (SLW=%s)', (water) => {
		const renderer = {} as WebGLRenderer;
		const material = new MeshStandardMaterial();
		if (water) material.userData.water = { family: 'single-layer-water' };
		const sourceCompile = vi.fn();
		material.onBeforeCompile = sourceCompile;
		material.customProgramCacheKey = () => 'source';
		applyEnvironmentLighting(material);
		const compile = material.onBeforeCompile;
		const key = material.customProgramCacheKey();
		const shader = {
			uniforms: {} as Record<string, { value: unknown }>,
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		try {
			setEnvironmentDiffuseWeight(renderer, 0);
			material.onBeforeCompile(shader as never, renderer);
			expect(shader.uniforms.editorEnvironmentDiffuseWeight!.value).toBe(0);
			setEnvironmentDiffuseWeight(renderer, 0.6);
			setEnvironmentReflection(renderer, [1, 2, 3], [4, 5, 6]);
			expect(shader.uniforms.editorEnvironmentDiffuseWeight!.value).toBe(0.6);
			expect(shader.uniforms.editorEnvironmentSpecularTint!.value).toMatchObject(
				water ? { r: 4, g: 5, b: 6 } : { r: 1, g: 2, b: 3 },
			);
			expect(applyEnvironmentLighting(material)).toBe(material);
			expect(material.onBeforeCompile).toBe(compile);
			expect(material.customProgramCacheKey()).toBe(key);
			expect(key).toContain('source_environment_lighting_');
			expect(sourceCompile).toHaveBeenCalledOnce();
		} finally {
			material.dispose();
		}
	});
});
