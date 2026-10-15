import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, ShaderLib, Texture } from 'three';
import { applyTriplanarHbcShader } from '../../src/materials/surface/triplanarHbcShader.js';
import type { FurnitureSurface } from '../../src/materials/surface/surfaceShader.js';

const surface: FurnitureSurface = {
	family: 'triplanar-hbc',
	color: [1, 1, 1],
	roughness: [0, 1],
	metalness: [0, 1],
	ao: [0, 1],
	uvScale: 0.5,
	uvOffset: [0, 0],
	normalUvScale: 1,
	tintUvBlend: 1,
	tintMaskBias: 0,
	triplanar: {
		blend: 10,
		flattenZ: 0,
		axisTint: [
			[1, 1, 1],
			[1, 1, 1],
			[1, 1, 1],
		],
		heightColor: [0, 100, 0, 1],
	},
};

describe('triplanar native-space shader wiring', () => {
	it('uses final world centimetres and the shared scale-free native basis', () => {
		const material = new MeshStandardMaterial({ map: new Texture(), normalMap: new Texture() });
		applyTriplanarHbcShader(material, surface, new Texture(), new Texture());

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		};

		material.onBeforeCompile(shader, {} as never);

		expect(shader.vertexShader).toContain('furnitureUnscaledBasis(instanceMatrix)*triNormal');
		expect(shader.vertexShader).toContain('furnitureNativeWorld(triPosition.xyz)');
		expect(shader.vertexShader).toContain('return vec3(value.x, -value.y, value.z)');
		expect(shader.fragmentShader).toContain('-vTriWorld*(0.01*triScale)');
		expect(shader.fragmentShader).toContain('(vTriWorld.z-triHeight.x)');
		expect(shader.fragmentShader).not.toContain('vTriWorld.z*100.0');
		expect(shader.fragmentShader).not.toContain('xy.y = -xy.y');
		expect(shader.fragmentShader).toContain('furnitureNativeWorld(triWorldN)');
		expect(material.customProgramCacheKey()).toBe('source_triplanar_hbc_native_cm_v2');
		material.map?.dispose();
		material.normalMap?.dispose();
		material.aoMap?.dispose();
		material.dispose();
	});
});
