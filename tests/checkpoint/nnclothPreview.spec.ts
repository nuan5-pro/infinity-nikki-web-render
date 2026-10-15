import { MeshStandardMaterial, Texture, CubeTexture, SRGBColorSpace, NoColorSpace } from 'three';
import { describe, expect, it } from 'vitest';
import {
	createNNClothPreviewMaterial,
	readNNClothPreview,
	type NNClothPreview,
} from '../../src/materials/nncloth/nnclothPreview.js';

function fixture(): NNClothPreview {
	return {
		family: 'nncloth-simple-1',
		version: 1,
		sourcePath: '/Game/Actual/Material.Material',
		color: [1, 1, 1],
		patternColor: [3.5, 1, 1],
		patternUV: [0, 0, 1],
		patternTiling: [1, 1, 0, 0],
		patternBlend: 1,
		roughness: 0.65,
		alphaCutoff: 0.333,
		masked: true,
		approximation: 'Static editor PBR with authored alpha-bearing decorative layer',
	};
}

describe('NNCloth lightweight layered preview', () => {
	it('retains authored HDR tint, UV2 and a distinct strict-native contract', () => {
		expect(readNNClothPreview(fixture())).toEqual(fixture());
		expect(readNNClothPreview({ ...fixture(), patternUV: [0, 0, 2] })).toBeNull();
		expect(readNNClothPreview({ ...fixture(), patternTiling: [1, 1, 0, NaN] })).toBeNull();

		const sparse = new Array(3);
		sparse[0] = 1;
		expect(readNNClothPreview({ ...fixture(), color: sparse })).toBeNull();

		const source = new MeshStandardMaterial();
		source.userData.nncloth = {};
		expect(() => createNNClothPreviewMaterial(fixture(), {}, source)).toThrow('conflict');
	});

	it('owns only three clones and disposes them without disposing source textures', () => {
		const slots = { D: new Texture(), N: new Texture(), D1: new Texture() };
		let sourceDisposed = 0;
		Object.values(slots).forEach((texture) => texture.addEventListener('dispose', () => sourceDisposed++));

		const material = createNNClothPreviewMaterial(fixture(), slots, new MeshStandardMaterial());
		expect(material.map).not.toBe(slots.D);
		expect(material.map?.colorSpace).toBe(SRGBColorSpace);
		expect(material.normalMap?.colorSpace).toBe(NoColorSpace);
		expect(material.roughness).toBe(0.65);
		expect(material.alphaTest).toBe(0.333);
		expect(material.transparent).toBe(false);
		expect(material.depthWrite).toBe(true);
		expect(material.customProgramCacheKey()).toMatch(/^nncloth-simple-2:/);

		let cloneDisposed = 0;
		material.map?.addEventListener('dispose', () => cloneDisposed++);
		material.normalMap?.addEventListener('dispose', () => cloneDisposed++);
		material.dispose();
		expect(cloneDisposed).toBe(2);
		expect(sourceDisposed).toBe(0);
	});

	it('rejects absent decorative layers and non-2D resources', () => {
		const source = new MeshStandardMaterial();
		expect(() => createNNClothPreviewMaterial(fixture(), { D: new Texture(), N: new Texture() }, source)).toThrow('D1');
		expect(() => createNNClothPreviewMaterial(fixture(), { D: new Texture(), N: new CubeTexture(), D1: new Texture() }, source)).toThrow('N');
	});

	it('shares programs across uniform values but not emitted UV expressions', () => {
		const slots = { D: new Texture(), N: new Texture(), D1: new Texture() };
		const source = new MeshStandardMaterial();
		const a = createNNClothPreviewMaterial(fixture(), slots, source);
		const b = createNNClothPreviewMaterial(
			{
				...fixture(),
				patternColor: [1, 2, 3],
				patternTiling: [2, 2, 0, 0],
				patternBlend: 0.5,
				roughness: 0.2,
			},
			slots,
			source,
		);
		const c = createNNClothPreviewMaterial({ ...fixture(), patternUV: [1, 0, 0] }, slots, source);
		expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
		expect(a.customProgramCacheKey()).not.toBe(c.customProgramCacheKey());
		for (const material of [a, b, c]) material.dispose();

		Object.values(slots).forEach((texture) => texture.dispose());
	});
});
