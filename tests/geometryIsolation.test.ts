import { expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Matrix4, MeshStandardMaterial } from 'three';
import { processGeometryForItem, type GeometryData } from '../src/furniture/geometry.js';
import type { FurnitureModelConfig, ModelAssetProfile } from '../src/furniture/types.js';
import {
	assertRockProjectionRawCarriers,
	ROCK_PROJECTION_RAW_NORMAL,
	ROCK_PROJECTION_RAW_TANGENT,
	rockProjectionCarrierSHA256,
} from '../src/materials/layered/rockProjectionRawBasis.js';

function sourceGeometry() {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
	geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
	geometry.setAttribute(ROCK_PROJECTION_RAW_NORMAL, new Float32BufferAttribute([0, .8, 0, 0, .8, 0, 0, .8, 0], 3));
	geometry.setAttribute(ROCK_PROJECTION_RAW_TANGENT, new Float32BufferAttribute([.4, 0, 0, -1, .4, 0, 0, -1, .4, 0, 0, -1], 4));
	geometry.setIndex([0, 1, 2]);
	geometry.userData.ueProjectionRawBasisProof = {
		contract: 'rock-projection-vm-raw-basis-1',
		coordinateTransform: 'CUE Gltf.SwapYZ(position*0.01f)',
		sourceNativeIndex: '_UE_VERTEX_INDEX',
		decode: 'archive-snorm8-vs-cross-cross-no-normalize',
		resourceHash: 'F995C1A9D8EF92BF8D321F8D4CB583345F07EF76',
		vsHash: 'e9875171a52e64fc0f751ea40bd4596ef2edf947',
		rawSHA256: 'a'.repeat(64),
		vertices: 3,
		bakeParity: 1,
		normalSHA256: rockProjectionCarrierSHA256(geometry.getAttribute(ROCK_PROJECTION_RAW_NORMAL)),
		tangentSHA256: rockProjectionCarrierSHA256(geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT)),
	};
	return geometry;
}

it.each(['full', 'lite'] as const)('reuses cached source geometry across repeated material switches starting at %s', async (first) => {
	const source = sourceGeometry();
	const metadata = structuredClone(source.userData);
	const normal = source.getAttribute(ROCK_PROJECTION_RAW_NORMAL).array.slice();
	const config: FurnitureModelConfig = {
		id: 1, componentCount: 1, customData: [0], colorings: {},
		root_offset: { x: 30, y: 20, z: 10 },
		meshes: [{
			sourceIndex: 0, slots: ['m'], models: { full: { path: 'shared.glb', bytes: 1 } },
			rotation: { x: 0, y: 0, z: 0, w: 1 },
			scale: { x: 2, y: 3, z: 4 }, trans: { x: 100, y: 200, z: 300 },
		}],
	};
	const results: GeometryData[] = [];
	const other = first === 'full' ? 'lite' : 'full';

	try {
		for (const quality of [first, other, first, other] as ModelAssetProfile[]) {
			const result = await processGeometryForItem(1, config, { model: 'full', material: quality }, async () => {
				const material = new MeshStandardMaterial({ roughness: quality === 'full' ? .5 : 1 });
				return {
					meshEntries: [{ geometry: source, localMatrix: new Matrix4().makeRotationZ(.4), material, baseName: null }],
					materialRegistry: new Map(),
					dispose: () => material.dispose(),
				};
			});
			expect(result).toBeDefined();
			results.push(result!);
			expect(() => assertRockProjectionRawCarriers(result!.geometry)).not.toThrow();
		}

		expect(source.userData).toEqual(metadata);
		expect(source.getAttribute(ROCK_PROJECTION_RAW_NORMAL).array).toEqual(normal);
		expect(() => assertRockProjectionRawCarriers(source)).not.toThrow();
		for (const result of results) {
			expect(result.geometry.userData).not.toBe(source.userData);
			expect(result.geometry.getAttribute(ROCK_PROJECTION_RAW_NORMAL).array).toEqual(results[0]!.geometry.getAttribute(ROCK_PROJECTION_RAW_NORMAL).array);
			expect(result.geometry.getAttribute('position').array).toEqual(results[0]!.geometry.getAttribute('position').array);
		}
	} finally {
		for (const result of results) {
			result.geometry.dispose();
			for (const material of new Set(result.plainMaterials)) material.dispose();
		}
		source.dispose();
	}
});
