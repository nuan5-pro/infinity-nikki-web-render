import { MeshBasicMaterial, ShaderLib, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import {
	createInkPreviewMaterial,
	readFurnitureInkPreview,
	type FurnitureInkPreview,
} from '../../src/materials/effects/inkPreviewShader.js';

function fixture(): FurnitureInkPreview {
	const names = {
		D: 'BaseColor_Tex',
		N: 'NormalMap',
		O: 'Global_Mask',
		T: 'Pattern_Tex',
		C: 'NoiseTex_Layer_Wave',
		B: 'Rim_RangeSetting',
		D1: 'Rim_Noise_1',
		O1: 'Rim_Noise_2',
	};

	return {
		version: 1,
		family: 'ink-preview',
		requiredUv: [0],
		parameters: Array.from({ length: 55 }, () => [0, 0, 0, 0]),
		textures: Object.fromEntries(
			Object.entries(names).map(([role, parameter]) => [
				role,
				{
					parameter,
					sRGB: role === 'D' || role === 'T',
					rgbScale: 1,
					mipmaps: true,
					nearest: false,
					addressX: 'TA_Wrap',
					addressY: 'TA_Wrap',
				},
			]),
		),
	};
}

describe('InkPreview source core', () => {
	it('keeps eight source inputs and native unlit colour before production tone mapping', () => {
		const p = fixture();
		const textures = Object.fromEntries(Object.keys(p.textures).map((role) => [role, new Texture()]));
		const material = createInkPreviewMaterial(p, textures);
		expect(material).toBeInstanceOf(MeshBasicMaterial);

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
		};

		material.onBeforeCompile(shader as never, {} as never);
		expect(shader.uniforms).toHaveProperty('inkD1');
		expect(shader.uniforms).toHaveProperty('inkO1');
		expect(shader.fragmentShader).toContain('rim2+rim1*(1.0-rim2)');
		expect(shader.fragmentShader).toContain('inkP[13].rgb,inkP[14].rgb');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(shader.fragmentShader).not.toContain('toneMappingExposure=');
		expect(material.transparent).toBe(false);
		material.dispose();
	});

	it('rejects active unimplemented layer noise or missing actual texture', () => {
		const p = fixture();
		expect(readFurnitureInkPreview(p)).toBe(p);
		p.parameters[19]![0] = 1;
		expect(readFurnitureInkPreview(p)).toBeNull();
		p.parameters[19]![0] = 0;
		expect(() => createInkPreviewMaterial(p, {})).toThrow('missing D');
	});
});
