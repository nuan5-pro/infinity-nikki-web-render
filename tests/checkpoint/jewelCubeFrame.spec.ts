import { describe, expect, it } from 'vitest';
import { DataTexture, ShaderLib, type WebGLRenderer } from 'three';
import { createJewelMaterial, type FurnitureJewel } from '../../src/materials/jewel/jewelShader.js';
import { nativeWorldFrameGLSL } from '../../src/materials/nativeWorldFrame.js';

describe('jewel panorama final world frame', () => {
	it('reflects native Y after view inversion without reapplying source geometry rotation', () => {
		const config: FurnitureJewel = {
			family: 'jewel',
			requiredUv: [0],
			alphaMode: 'constant',
			blend: 'opaque',
			alphaCutoff: 0.3333,
			scalars: {},
			colors: {},
			textures: {},
		};

		const material = createJewelMaterial(config, {});

		const shader = {
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
			uniforms: {},
		} as Parameters<typeof material.onBeforeCompile>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);

		expect(shader.fragmentShader).toContain(nativeWorldFrameGLSL);
		expect(shader.fragmentShader).toContain('transpose(mat3(viewMatrix))*normalize(viewDirection)');
		expect(shader.fragmentShader).toContain('normalize(furnitureNativeWorld(worldDirection))');
		expect(shader.fragmentShader).not.toContain('vec3(-worldDirection.y,worldDirection.x,worldDirection.z)');
		expect(shader.fragmentShader).toContain('atan(-nativeDirection.x,-nativeDirection.z)');
		expect(shader.fragmentShader).toContain('1.0-acos(clamp(nativeDirection.y,-1.0,1.0))');
		material.dispose();
	});

	it('keeps each source panorama sampler isolated and its HDR scale uniform intact', () => {
		const source = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);

		const config: FurnitureJewel = {
			family: 'jewel',
			requiredUv: [0],
			alphaMode: 'constant',
			blend: 'opaque',
			alphaCutoff: 0.3333,
			scalars: {},
			colors: {},
			textures: {
				O: {
					parameter: 'Ref_HDR',
					sRGB: false,
					rgbScale: 8,
					addressX: 'TA_Wrap',
					addressY: 'TA_Wrap',
					mipmaps: true,
					nearest: false,
					cube: true,
				},
			},
		};

		const material = createJewelMaterial(config, { O: source });

		const shader = {
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
			uniforms: {},
		} as Parameters<typeof material.onBeforeCompile>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);

		expect(shader.uniforms.jewelO!.value).not.toBe(source);
		expect(shader.uniforms.jewelO!.value.source).toBe(source.source);
		expect(shader.uniforms.jewelScaleO!.value).toBe(8);
		expect(shader.uniforms.jewelO!.value.flipY).toBe(false);
		material.dispose();
		source.dispose();
	});
});
