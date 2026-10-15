import { describe, expect, it } from 'vitest';
import {
	createJewelMaterial,
	readFurnitureJewel,
	type FurnitureJewel,
} from '../../src/materials/jewel/jewelShader.js';
import {
	jewelryMaskedColorCore,
	jewelryMaskedFragmentDeclarations,
} from '../../src/materials/jewel/jewelryMaskedShader.js';

const legacy = (): FurnitureJewel => ({
	family: 'jewelry-matcap',
	blend: 'masked',
	alphaMode: 'jewelry-r-a',
	alphaCutoff: 0.333,
	scalars: {},
	colors: {},
	textures: {},
	requiredUv: [],
});

describe('exact optional Masked dispatch', () => {
	it('leaves absent-opt-in consumer and native3 cache key unchanged', () => {
		const input = legacy();
		expect(readFurnitureJewel(input)).toBe(input);

		const material = createJewelMaterial(input, {});
		expect(material.customProgramCacheKey()).toMatch(/^jewel-native-3:/);
		expect(material.customProgramCacheKey()).not.toContain('jewel-masked-source');
		expect(material.userData.jewelryMaskedSource).toBeUndefined();
		material.dispose();
	});

	it('fences every declared invalid opt-in, including falsy values, without legacy fallback', () => {
		for (const maskedSource of [null, undefined, false, 0, '', {}, { pixelShader: 'wrong' }]) {
			const input = { ...legacy(), maskedSource };
			expect(readFurnitureJewel(input)).toBeNull();
			// Deliberate adversarial API input; do not hide malformed proof with any.
			expect(() => createJewelMaterial(input as unknown as FurnitureJewel, {})).toThrow('refusing legacy fallback');
		}
	});

	it('keeps source PS bitangent reconstruction after interpolation and reflection composite unnormalized', () => {
		expect(jewelryMaskedColorCore).toContain('cross(vMaskedNormal,vMaskedTangent)*vMaskedHandedness');
		expect(jewelryMaskedColorCore).not.toContain('vMaskedBitangent');
		expect(jewelryMaskedColorCore).not.toContain('normalize(reflectionNormal)');
		expect(jewelryMaskedColorCore).toContain('jewelN1,reflectUV,-1.0');
	});

	it('uses original samplerCube and separates t9 POM height from detail RGB in the opt-in only', () => {
		expect(jewelryMaskedColorCore).not.toContain('jewelCube(');
		expect(jewelryMaskedColorCore).toContain('textureCube(maskedCubeC,maskedViewToSourceWorldDirection*');
		expect(jewelryMaskedColorCore).toContain('textureCube(maskedCubeS,maskedViewToSourceWorldDirection*mix(reflected,refracted');
		expect(jewelryMaskedFragmentDeclarations).toContain('textureGrad(maskedHeightTexture,uv+offset,dx,dy)');
		expect(jewelryMaskedFragmentDeclarations).not.toContain('textureGrad(jewelD1,');
		expect(jewelryMaskedColorCore).toContain('texture2D(jewelD1,detailUV)');
	});
});
