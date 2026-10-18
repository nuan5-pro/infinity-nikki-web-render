import { describe, expect, it } from 'vitest';
import {
	BufferAttribute,
	BufferGeometry,
	Float32BufferAttribute,
	IntType,
	MeshPhysicalMaterial,
	MeshStandardMaterial,
} from 'three';
import {
	decodePreparedGeometry,
	encodePreparedGeometry,
	preparedGeometryInput,
	restorePreparedGeometry,
} from '../../src/furniture/prepared.js';
import type { GeometryPreparationSnapshot } from '../../src/furniture/geometry.js';
import type { FurnitureModelConfig } from '../../src/furniture/types.js';
import { geometryTransfers, packGeometryBuffers, processGeometryBuffers, restoreGeometryBuffers } from '../../src/furniture/geometryBuffers.js';

function fixture() {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));

	const integer = new BufferAttribute(new Uint32Array([0xffffffff, 42, 7]), 1);
	integer.gpuType = IntType;
	geometry.setAttribute('sourceID', integer);
	geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
	geometry.addGroup(0, 3, 0);
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	geometry.userData = { proof: { frame: [1, 0, 0, 1], exact: true } };

	const material = new MeshStandardMaterial();
	material.name = 'source';
	material.normalScale.set(1, -1);
	material.userData = { geometryProof: { declared: true } };

	const catalog = { materials: { m: { name: 'source' } } };

	const snapshot: GeometryPreparationSnapshot = {
		geometry,
		sourceMaterials: [material],
		meshBaseNames: [null],
		slotMeshIndices: [0],
		meshMaterialCounts: [1],
	};

	return { geometry, material, catalog, snapshot };
}

describe('offline prepared geometry', () => {
	it('round-trips exact typed streams, integer GPU semantics, groups, bounds and proofs', () => {
		const { geometry, catalog, snapshot } = fixture();
		const bytes = encodePreparedGeometry(snapshot, 'input', ['m'], catalog);
		const decoded = decodePreparedGeometry(bytes, 'input').geometry;
		expect(decoded.getAttribute('sourceID').array).toBeInstanceOf(Uint32Array);
		expect(decoded.getAttribute('sourceID').gpuType).toBe(IntType);
		expect(decoded.getAttribute('sourceID').array).toEqual(geometry.getAttribute('sourceID').array);
		expect(decoded.index?.array).toBeInstanceOf(Uint16Array);

		const before = new Uint8Array(bytes).slice();
		decoded.index!.setX(0, 2);
		expect(new Uint8Array(bytes)).toEqual(before);
		expect(decoded.getAttribute('position').array.buffer).toBe(bytes);
		expect(decoded.groups).toEqual(geometry.groups);
		expect(decoded.drawRange).toEqual(geometry.drawRange);
		expect(decoded.boundingBox).toEqual(geometry.boundingBox);
		expect(decoded.boundingSphere).toEqual(geometry.boundingSphere);
		expect(decoded.userData).toEqual(geometry.userData);
	});

	it('rebuilds fresh material bindings without losing geometry-owned source metadata', async () => {
		const { catalog, snapshot } = fixture();
		const bytes = encodePreparedGeometry(snapshot, 'input', ['m'], catalog);
		const template = new MeshStandardMaterial();
		template.name = 'source';

		const restored = await restorePreparedGeometry(bytes, 'input', async () => ({
			material: template,
			materialRegistry: new Map(),

			dispose() {},
		}));
		expect(restored.plainMaterials[0]).not.toBe(template);
		expect((restored.plainMaterials[0] as MeshStandardMaterial).normalScale.toArray()).toEqual([
			1, -1,
		]);
		expect(restored.plainMaterials[0]?.userData.geometryProof).toEqual({ declared: true });
		expect(template.userData.geometryProof).toBeUndefined();
		restored.geometry.dispose();
		restored.plainMaterials.forEach((material) => material.dispose());
	});

	it('keeps the encoded cache intact when runtime arrays move to a BVH worker', async () => {
		const { catalog, snapshot } = fixture();
		snapshot.geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, .99, 0, 0, .99, 0, 0, .99], 3));
		const bytes = encodePreparedGeometry(snapshot, 'input', ['m'], catalog);
		const before = new Uint8Array(bytes).slice();
		const template = new MeshStandardMaterial();
		template.name = 'source';
		const getMaterial = async () => ({ material: template, materialRegistry: new Map(), dispose() {} });
		const restored = await restorePreparedGeometry(bytes, 'input', getMaterial);
		const input = { geometries: [packGeometryBuffers(restored.geometry)], matrices: [null], boundsTree: true };
		const moved = structuredClone(input, { transfer: geometryTransfers(input.geometries) });
		const output = processGeometryBuffers(moved);
		restoreGeometryBuffers(restored.geometry, output[0]!);
		expect(new Uint8Array(bytes)).toEqual(before);
		expect(restored.geometry.getAttribute('normal').array).toEqual(snapshot.geometry.getAttribute('normal').array);
		expect(restored.geometry.boundsTree).toBeDefined();
		const second = await restorePreparedGeometry(bytes, 'input', getMaterial);
		expect(second.geometry.getAttribute('position').array).toEqual(restored.geometry.getAttribute('position').array);
		for (const data of [restored, second]) {
			data.geometry.dispose();
			data.plainMaterials.forEach(material => material.dispose());
		}
		template.dispose();
	});

	it('reuses equal plain sources while retaining every prepared slot and its dye mapping', async () => {
		const { catalog, snapshot } = fixture();
		const template = new MeshStandardMaterial();
		template.name = 'source';
		template.userData.render = {};

		const first = template.clone();
		const changed = template.clone();
		changed.normalScale.y = -1;
		snapshot.sourceMaterials = [first, first.clone(), changed];
		snapshot.meshBaseNames = [null, null, null];
		snapshot.slotMeshIndices = [0, 1, 2];
		snapshot.meshMaterialCounts = [1, 1, 1];
		snapshot.geometry.setIndex([0, 1, 2, 0, 1, 2, 0, 1, 2]);
		snapshot.geometry.clearGroups();
		for (let slot = 0; slot < 3; slot++) snapshot.geometry.addGroup(slot * 3, 3, slot);

		const bytes = encodePreparedGeometry(snapshot, 'input', ['m', 'm', 'm'], catalog);
		const restored = await restorePreparedGeometry(bytes, 'input', async () => ({
			material: template,
			materialRegistry: new Map(),

			dispose() {},
		}));
		expect(restored.plainMaterials).toHaveLength(3);
		expect(restored.plainMaterials[0]).toBe(restored.plainMaterials[1]);
		expect(restored.plainMaterials[0]).not.toBe(restored.plainMaterials[2]);
		expect(restored.slotMeshIndices).toEqual([0, 1, 2]);
		expect(restored.geometry.groups).toEqual(snapshot.geometry.groups);
		restored.geometry.dispose();
		new Set(restored.plainMaterials).forEach((material) => material.dispose());
	});

	it('rejects stale inputs and malformed byte ranges', () => {
		const { catalog, snapshot } = fixture();
		const bytes = encodePreparedGeometry(snapshot, 'input', ['m'], catalog);
		expect(() => decodePreparedGeometry(bytes, 'other')).toThrow('Stale');
		expect(() => decodePreparedGeometry(bytes.slice(0, bytes.byteLength - 1), 'input')).toThrow('range');
	});

	it('retains the geometry-qualified clearcoat normal convention', async () => {
		const { catalog, snapshot } = fixture();
		const physical = new MeshPhysicalMaterial();
		physical.name = 'source';
		physical.clearcoatNormalScale.set(2, -3);
		snapshot.sourceMaterials = [physical];

		const bytes = encodePreparedGeometry(snapshot, 'input', ['m'], catalog);
		const template = new MeshPhysicalMaterial();
		template.name = 'source';

		const data = await restorePreparedGeometry(bytes, 'input', async () => ({
			material: template,
			materialRegistry: new Map(),

			dispose() {},
		}));
		expect((data.plainMaterials[0] as MeshPhysicalMaterial).clearcoatNormalScale.toArray()).toEqual([2, -3]);
		data.geometry.dispose();
		data.plainMaterials.forEach((material) => material.dispose());
	});

	it('keys fixed assembly/material inputs independently of the derived artifact pointer', async () => {
		const { catalog } = fixture();
		const config: FurnitureModelConfig = { id: 1, meshes: [], root_offset: { x: 0, y: 0, z: 0 } };
		const selection = { model: 'full', material: 'full' } as const;
		const expected = await preparedGeometryInput(config, selection, catalog);
		config.prepared = { 'full:full': { path: 'models-full/example.bin', bytes: 1 } };
		expect(await preparedGeometryInput(config, selection, catalog)).toBe(expected);
		config.root_offset.x = 1;
		expect(await preparedGeometryInput(config, selection, catalog)).not.toBe(expected);
	});
});
