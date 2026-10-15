import { describe, expect, it } from 'vitest';
import { ShaderLib, Texture } from 'three';
import slw from './fixtures/waterSLWFountain.json';
import {
	createWaterMaterial,
	type FurnitureWater,
} from '../../src/materials/water/waterShader.js';

export function legacyWaterConfig(): FurnitureWater {
	return {
		core: 'slw',
		family: 'single-layer-water',
		approximation: 'program regression fixture',
		absorption: [0.0027, 0.0022, 0.0019],
		scattering: [0.00002, 0.00004, 0.00004],
		proxyDepth: 20,
		transmittance: 1,
		baseAlpha: 1,
		alphaBlend: 0,
		alphaPower: 1,
		alphaFresnel: [0, 1],
		tint: [1, 1, 1],
		emissive: [0, 0, 0],
		textureSRGB: [false, false, false, false],
		textureMipmaps: [false, true, true, false],
		color: [0.056901, 0.122878, 0.130208],
		baseBrightness: 1,
		basePower: 1,
		opacity: [0.04, 0.04],
		coverage: 0.016,
		metalness: 0,
		roughness: 0.04,
		f0: 0.0204,
		normalStrength: 0,
		uv: [1, 1, 0, 0],
		normalUv: [1, 1, 0, 0],
		flow: [0, 0],
		normalFlow: [0, 0],
		ripple: [0, 0],
	};
}

describe('legacy water program isolation', () => {
	it('keeps source wave families isolated and all preview variants capture-free', () => {
		const texture = new Texture();

		const variants: FurnitureWater[] = [
			...(
				[
					'default',
					'slw',
					'nature-pool',
					'slw-base-wave',
					'common-trans',
					'x6fx',
					'glint',
					'small-prop',
					'special-trans',
					'flowing-liquid',
				] as const
			).map((core) => ({ ...legacyWaterConfig(), core })),
			{ ...legacyWaterConfig(), slw: slw as FurnitureWater['slw'] },
			{
				...legacyWaterConfig(),
				slw: slw as FurnitureWater['slw'],
				opticalDepth: { edgeScale: 33, edgePower: 1.7, waterTrans: 0.3 },
				caustics: {
					causticsProject: [0, 0, 1 / 180],
					causticsAtlas: [4, 4, 0.5, 1 / 70],
					brightness: 15,
				},
			},
		];

		for (const config of variants) {
			const material = createWaterMaterial(config, texture, texture, undefined, texture, texture, texture);

			const shader = {
				uniforms: {},
				vertexShader: ShaderLib.standard.vertexShader,
				fragmentShader: ShaderLib.standard.fragmentShader,
			};

			material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], undefined as never);
			expect(shader.vertexShader + shader.fragmentShader).not.toContain('waterSLWStatic');
			expect(shader.fragmentShader).not.toMatch(/waterHasScene|waterSceneDepth|waterSceneColor|waterOpticalPath/);
			expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
			expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
			expect(material.transparent).toBe(true);
			expect(material.depthWrite).toBe(false);
			material.dispose();
		}

		texture.dispose();
	});
});
