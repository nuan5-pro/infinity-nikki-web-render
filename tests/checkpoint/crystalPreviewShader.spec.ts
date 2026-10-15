import { MeshBasicMaterial, ShaderLib, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import {
	createCrystalPreviewMaterial,
	readFurnitureCrystalPreview,
	type FurnitureCrystalPreview,
} from '../../src/materials/glass/crystalPreviewShader.js';

function fixture(): FurnitureCrystalPreview {
	const names = {
		D: 'Base_Tex',
		N: 'NormalMap',
		O: 'Global_Mask',
		T: 'Emissive_Tex_Add',
		C: 'Glint_Texture',
		B: 'Fresnel_RangeSetting',
		S: 'Base_Attribute_Tex',
		D1: 'Flow_Texture_1',
		O1: 'Flow_Texture_2',
		M: 'Fresnel_Noise',
	};

	const p: FurnitureCrystalPreview = {
		version: 1,
		family: 'crystal-preview',
		requiredUv: [0, 2],
		dayPhase: 1,
		parameters: Array.from({ length: 105 }, () => [0, 0, 0, 0]),
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

	p.parameters[20]![0] = p.parameters[26]![0] = p.parameters[54]![0] = 1;
	p.parameters[98] = p.parameters[100] = [1, 1, 1, 1];
	return p;
}

describe('CrystalPreview static colour core', () => {
	it('binds base instead of the glint mask and retains emission, two flows and Fresnel', () => {
		const p = fixture();
		const textures = Object.fromEntries(Object.keys(p.textures).map((role) => [role, new Texture()]));
		const material = createCrystalPreviewMaterial(p, textures);
		expect(material).toBeInstanceOf(MeshBasicMaterial);

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
		};

		material.onBeforeCompile(shader as never, {} as never);
		expect(shader.uniforms).toHaveProperty('crystalD1');
		expect(shader.uniforms).toHaveProperty('crystalO1');
		expect(shader.fragmentShader).toContain('texture2D(crystalD,');
		expect(shader.fragmentShader).toContain('texture2D(crystalC,glintUV)');
		expect(shader.fragmentShader).toContain('vec2 baseAttribute=texture2D(crystalS,');
		expect(shader.fragmentShader).not.toContain('vec2 attribute=');
		expect(shader.fragmentShader).toContain('mix(crystalP[51].rgb,crystalP[52].rgb,gradient)');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);
		material.dispose();
	});

	it('rejects active VAT/dissolve/cube instead of inventing missing runtime inputs', () => {
		const p = fixture();
		expect(readFurnitureCrystalPreview(p)).toBe(p);
		for (const index of [6, 38, 62]) {
			p.parameters[index]![0] = 1;
			expect(readFurnitureCrystalPreview(p)).toBeNull();
			p.parameters[index]![0] = 0;
		}

		expect(() => createCrystalPreviewMaterial(p, {})).toThrow('missing D');
	});
});
