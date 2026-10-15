import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Matrix4, MeshStandardMaterial } from 'three';
import sourceConfigs from './fixtures/waterSLWStatic.json';
import { processGeometryForItem } from '../../src/furniture/geometry.js';
import type { MeshAssetData } from '../../src/furniture/assets.js';
import type { FurnitureModelConfig } from '../../src/furniture/types.js';
import type { FurnitureWater } from '../../src/materials/water/waterShader.js';
import type { WaterSLWStatic } from '../../src/materials/water/waterSLWStatic.js';

function sourceGeometry() {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
	geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
	geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
	geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
	geometry.setIndex([0, 1, 2]);
	return geometry;
}

function sourceMaterial() {
	const material = new MeshStandardMaterial();

	const water: FurnitureWater = {
		core: 'slw-static',
		family: 'single-layer-water',
		absorption: [0.017, 0.013, 0.014],
		scattering: [0.00013, 0.0002, 0.00019],
		proxyDepth: 20,
		transmittance: 1,
		baseAlpha: 1,
		alphaBlend: 0,
		alphaPower: 1,
		alphaFresnel: [0, 1],
		tint: [1, 1, 1],
		emissive: [0, 0, 0],
		textureSRGB: [false, false, false, false],
		textureMipmaps: [false, false, true, false],
		color: [0.115245, 0.151042, 0.115245],
		baseBrightness: 1,
		basePower: 1,
		opacity: [0.2, 0.2],
		coverage: 0.2,
		metalness: 0,
		roughness: 0.05,
		f0: 0.08,
		normalStrength: 0,
		uv: [1, 1, 0, 0],
		normalUv: [1, 1, 0, 0],
		flow: [0, 0],
		normalFlow: [0, 0],
		ripple: [0, 0],
		slwStatic: sourceConfigs[1]!.config as WaterSLWStatic,
		opticalDepth: { edgeScale: 33.231506, edgePower: 0.5, waterTrans: 0.3 },
		caustics: {
			causticsProject: [0, 0, 1 / 180],
			causticsAtlas: [4, 4, 0.5, 1 / 200],
			brightness: 10,
		},
	};

	material.userData.water = water;
	return material;
}

const config: FurnitureModelConfig = {
	id: 1,
	name: 'source guard fixture',
	cat: 'test',
	root_offset: { x: 0, y: 0, z: 0 },
	meshes: [
		{
			models: { full: { path: 'models-full/test-aaaaaaaaaaaaaaaa.glb', bytes: 1 } },
			slots: [],
			trans: { x: 0, y: 0, z: 0 },
			rotation: { x: 0, y: 0, z: 0, w: 1 },
			scale: { x: 1, y: 1, z: 1 },
		},
	],
};

function asset(entries: MeshAssetData['meshEntries']): MeshAssetData {
	return { meshEntries: entries, materialRegistry: new Map(),

		dispose: () => {} };
}

describe('static SLW normal Full importer provenance', () => {
	it('refuses original missing normal/tangent before fallback generation or padding', async () => {
		for (const name of ['normal', 'tangent']) {
			const geometry = sourceGeometry();
			geometry.deleteAttribute(name);

			const data = asset([
				{ geometry, material: sourceMaterial(), localMatrix: new Matrix4(), baseName: null },
			]);
			await expect(processGeometryForItem(1, config, { model: 'full', material: 'full' }, async () => data)).rejects.toThrow(`source ${name}`);
		}
	});
	it('refuses invalid source handedness before any transform', async () => {
		const geometry = sourceGeometry();
		geometry.getAttribute('tangent').setW(0, 0);

		const data = asset([
			{ geometry, material: sourceMaterial(), localMatrix: new Matrix4(), baseName: null },
		]);
		await expect(processGeometryForItem(1, config, { model: 'full', material: 'full' }, async () => data)).rejects.toThrow('signed source tangent');
	});
	it('refuses merge intersection that would discard an already-proven static tangent stream', async () => {
		const ordinary = sourceGeometry();
		ordinary.deleteAttribute('tangent');

		const data = asset([
			{
				geometry: sourceGeometry(),
				material: sourceMaterial(),
				localMatrix: new Matrix4(),
				baseName: null,
			},
			{
				geometry: ordinary,
				material: new MeshStandardMaterial(),
				localMatrix: new Matrix4(),
				baseName: null,
			},
		]);
		await expect(processGeometryForItem(1, config, { model: 'full', material: 'full' }, async () => data)).rejects.toThrow('discard the captured SLW source tangent');
	});
});
