import { Texture } from 'three';
import { describe, expect, it } from 'vitest';
import {
	createJewelMaterial,
	readFurnitureJewel,
	type FurnitureJewel,
} from '../../src/materials/jewel/jewelShader.js';
import {
	jewelrySimpleColorCore,
	jewelrySimpleRoles,
} from '../../src/materials/jewel/jewelrySimplePreview.js';

function fixture(): FurnitureJewel {
	const textures: FurnitureJewel['textures'] = {};
	for (const role of jewelrySimpleRoles)
		textures[role] = {
			parameter: role,
			sRGB: role === 'D',
			rgbScale: 1,
			addressX: 'TA_Wrap',
			addressY: 'TA_Wrap',
			mipmaps: true,
			nearest: false,
			cube: false,
		};

	return {
		preview: 'jewelry-simple-1',
		family: 'jewelry-matcap',
		blend: 'masked',
		alphaMode: 'jewelry-r-a',
		alphaCutoff: 0.333,
		scalars: {},
		colors: { Jewel_D_Tint: [3.5, 1, 1, 1] },
		textures,
		requiredUv: [0],
		approximation: 'Lightweight texture/matcap preview; not native shader parity',
	};
}

describe('explicit lightweight Jewelry preview', () => {
	it('uses five texture roles, masked depth and original HDR tint without native carrier', () => {
		const input = fixture();
		const textures: Record<string, Texture> = {};
		for (const role of jewelrySimpleRoles) textures[role] = new Texture();

		input.textures.C = { ...input.textures.D!, cube: true };

		const material = createJewelMaterial(input, textures);
		expect(material.customProgramCacheKey()).toMatch(/^jewelry-simple-1:/);
		expect(material.transparent).toBe(false);
		expect(material.depthWrite).toBe(true);
		expect(material.alphaTest).toBe(0.333);
		expect(input.colors.Jewel_D_Tint![0]).toBe(3.5);
		expect(jewelrySimpleColorCore).not.toMatch(/jewelCube|jewelD1|jewelN1|time|hash|parallax/);
		expect(jewelrySimpleColorCore).not.toContain('clamp(colour,0.0,1.0)');
		material.dispose();
	});

	it('rejects missing roles, cube matcap and mixed strict-source opt-ins', () => {
		const missing = fixture();
		delete missing.textures.O;
		expect(readFurnitureJewel(missing)).toBeNull();
		expect(() => createJewelMaterial(missing, {})).toThrow('invalid declared lightweight');

		const cube = fixture();
		cube.textures.O!.cube = true;
		expect(readFurnitureJewel(cube)).toBeNull();
		expect(readFurnitureJewel({ ...fixture(), maskedSource: undefined })).toBeNull();
	});

	it('keeps default consumer separate and keys normal transport variations', () => {
		const input = fixture();
		delete input.preview;

		const textures: Record<string, Texture> = {};
		for (const role of jewelrySimpleRoles) textures[role] = new Texture();

		const legacy = createJewelMaterial(input, textures);
		expect(legacy.customProgramCacheKey()).toMatch(/^jewel-native-3:/);

		const simple = fixture();
		simple.textures.N!.bc5ZeroB = true;

		const material = createJewelMaterial(simple, textures);
		expect(material.customProgramCacheKey()).toContain('N');
		legacy.dispose();
		material.dispose();
	});
});
