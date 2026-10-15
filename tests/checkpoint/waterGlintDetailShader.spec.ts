import { describe, expect, it } from 'vitest';
import { ShaderLib, Texture } from 'three';
import {
	applyWaterGlintDetail,
	readFurnitureWaterGlintDetail,
	type FurnitureWaterGlintDetail,
} from '../../src/materials/water/waterGlintDetailShader.js';
import {
	createWaterMaterial,
	type FurnitureWater,
} from '../../src/materials/water/waterShader.js';

function fixture(): FurnitureWaterGlintDetail {
	return {
		version: 1,
		family: 'water-glint-detail',
		flowUv: [1, 1, 0, 0],
		detailUv: [5, 1.5, 0.5, 0.5],
		flowIntensity: 1,
		detailFlow: 3,
		detailNormal: 0.15,
		normal: 1,
		textures: {
			O: { parameter: 'DetailTexWaveNormal(Linear)', sRGB: false, mipmaps: true, bc5ZeroB: true },
			T: { parameter: 'FlowMap', sRGB: false, mipmaps: true },
		},
	};
}

describe('GlintFlow inexpensive detail augmentation', () => {
	it('retains the real water core, phase-zero flow and raw BC5 detail RNM in one pass', () => {
		const water: FurnitureWater = {
			core: 'glint',
			family: 'translucent-water',
			approximation: 'test',
			absorption: [1, 0.02, 0.04],
			scattering: [0, 0, 0],
			proxyDepth: 20,
			transmittance: 0.6,
			baseAlpha: 1,
			alphaBlend: 0,
			alphaPower: 1,
			alphaFresnel: [0, 1],
			tint: [1, 1, 1],
			emissive: [0, 0, 0],
			textureSRGB: [true, false, false, false],
			textureMipmaps: [true, true, true, true],
			color: [0.17, 1.5, 0.79],
			baseBrightness: 1,
			basePower: 1,
			opacity: [0.7, 1],
			coverage: 0.7,
			metalness: 0,
			roughness: 0.2,
			f0: 0.04,
			normalStrength: 1,
			uv: [1, 1, 0, 0],
			normalUv: [1, 1, 0, 0],
			flow: [0, 0],
			normalFlow: [0, 0],
			ripple: [0, 0],
		};

		const texture = new Texture();
		const material = createWaterMaterial(water, texture, texture);
		applyWaterGlintDetail(material, fixture(), { O: texture, T: texture });

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		material.onBeforeCompile(shader as never, undefined as never);
		expect(shader.fragmentShader).toContain('texture2D( map, wgdBaseUV )');
		expect(shader.fragmentShader).toContain('wgdDetailN.z=0.0');
		expect(shader.fragmentShader).toContain('mapN=normalize(wgdT*dot(wgdT,wgdU)-wgdU*wgdT.z)');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);
		material.dispose();
		texture.dispose();
	});

	it('rejects missing real resources', () => {
		const p = fixture();
		delete p.textures.T;
		expect(readFurnitureWaterGlintDetail(p)).toBeNull();
	});
});
