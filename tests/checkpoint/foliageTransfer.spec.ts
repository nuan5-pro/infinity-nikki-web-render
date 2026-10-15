import { describe, expect, it } from 'vitest';
import { NoColorSpace, ShaderLib, SRGBColorSpace, Texture } from 'three';
import {
	createFoliageMaterial,
	readFurnitureFoliage,
	type FurnitureFoliage,
} from '../../src/materials/foliage/foliageShader.js';

function config(maskSRGB: boolean): FurnitureFoliage {
	return {
		family: 'foliage-3tex-array-v02-1',
		version: 1,
		mode: 'static-core-preview',
		sourceAlpha: true,
		textureSRGB: [true, false, maskSRGB, false, false],
		color: [1, 1, 1],
		colorBack: [1, 1, 1],
		gradient: [1, 1, 1],
		separateTint: 0,
		roughnessFront: [0.2, 0.8],
		roughnessBack: [0.3, 0.9],
		specular: [0.1, 1, 1.7, 0.8],
		ao: [0.4, 1],
		metallic: 0,
		uvScale: 1,
		normalFlatness: 0,
		cutoff: 0.3333,
		emissive: [0, 0, 0],
		emissiveBaseColor: 0,
	};
}

describe('native foliage role transfer', () => {
	for (const srgb of [false, true]) {
		it(`preserves the independently sampled mask transfer (${srgb}) without changing shared textures`, () => {
			const diffuse = new Texture();
			const normal = new Texture();
			const mask = new Texture();
			const material = createFoliageMaterial(config(srgb), diffuse, normal, mask);
			expect(material.map!.colorSpace).toBe(SRGBColorSpace);
			expect(material.normalMap!.colorSpace).toBe(NoColorSpace);
			expect(material.aoMap!.colorSpace).toBe(srgb ? SRGBColorSpace : NoColorSpace);
			expect(mask.colorSpace).toBe(NoColorSpace);
			expect(material.aoMap).not.toBe(mask);
			expect(material.userData.foliage.roughnessFront).toEqual([0.2, 0.8]);
			material.dispose();
			diffuse.dispose();
			normal.dispose();
			mask.dispose();
		});
	}

	it('rejects malformed transfer flags', () => {
		expect(readFurnitureFoliage({ ...config(true), textureSRGB: [true, false] })).toBeNull();
		expect(readFurnitureFoliage({ ...config(true), textureSRGB: [true, false, 1, false, false] })).toBeNull();
	});

	it('keeps native normal RG until after its sRGB sample, then converts handedness once', () => {
		const source = new Texture();
		const p = config(false);
		p.textureSRGB![1] = true;

		const material = createFoliageMaterial(p, source, source, source, null, null, {
			normalEncoding: 'native-rg',
		});

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		material.onBeforeCompile(shader as never, undefined as never);
		expect(material.normalMap!.colorSpace).toBe(SRGBColorSpace);
		expect(shader.fragmentShader).toContain('foliageNormalRG.y = -foliageNormalRG.y;');
		expect(shader.fragmentShader.indexOf('texture2D(normalMap, vFoliageUv)')).toBeLessThan(
			shader.fragmentShader.indexOf('foliageNormalRG.y = -foliageNormalRG.y;'),
		);
		material.dispose();
		source.dispose();
	});
});
