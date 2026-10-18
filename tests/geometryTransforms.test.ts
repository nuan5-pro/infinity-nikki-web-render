import { expect, it } from 'vitest';
import { BoxGeometry, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { applyGeometryTransform, processGeometryForItem } from '../src/furniture/geometry.js';
import type { FurnitureModelConfig } from '../src/furniture/types.js';

it.each([false, true])('composed position/normal/tangent transforms preserve winding and custom attributes (indexed=%s)', async (indexed) => {
	const box = new BoxGeometry(3, 2, 1);
	box.computeTangents();
	const source = indexed ? box : box.toNonIndexed();
	const local = new Matrix4().makeRotationY(.3).multiply(new Matrix4().makeScale(-2, 3, 4));
	const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), .7);
	const config: FurnitureModelConfig = {
		id: 1, componentCount: 1, customData: [0], colorings: {}, root_offset: { x: 13, y: -21, z: 7 },
		meshes: [{ sourceIndex: 0, slots: ['m'], models: { full: { path: 'model.glb', bytes: 1 } },
			rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
			scale: { x: 2, y: -.5, z: 1.3 }, trans: { x: 100, y: -20, z: 40 } }],
	};
	const mesh = config.meshes[0]!;
	const expected = source.clone();
	applyGeometryTransform(expected, local);
	applyGeometryTransform(expected, new Matrix4().compose(
		new Vector3(mesh.trans.x / 100, mesh.trans.z / 100, -mesh.trans.y / 100),
		new Quaternion(rotation.x, rotation.z, rotation.y, rotation.w),
		new Vector3(mesh.scale.x, mesh.scale.z, mesh.scale.y),
	));
	expected.translate(config.root_offset.y / 100, config.root_offset.z / 100, config.root_offset.x / 100);
	expected.scale(100, 100, 100);
	applyGeometryTransform(expected, new Matrix4().makeScale(-1, 1, 1));
	expected.rotateY(Math.PI / 2);
	expected.rotateX(Math.PI / 2);
	expected.computeBoundingBox();
	const material = new MeshStandardMaterial();
	const result = await processGeometryForItem(1, config, { model: 'full', material: 'full' }, async () => ({
		meshEntries: [{ geometry: source, localMatrix: local, material, baseName: null }],
		materialRegistry: new Map(), dispose() {},
	}));
	expect(result).toBeDefined();
	for (const name of ['position', 'normal', 'tangent', 'uv']) {
		const actual = result!.geometry.getAttribute(name).array;
		const reference = expected.getAttribute(name).array;
		expect(actual.length).toBe(reference.length);
		for (let i = 0; i < actual.length; i++) expect(Math.abs(actual[i]! - reference[i]!)).toBeLessThan(name === 'position' ? .0002 : .000001);
	}
	expect(result!.geometry.index?.array).toEqual(expected.index?.array);
	expect(result!.geometry.getAttribute('nuanSourceMesh').array.every(value => value === 0)).toBe(true);
	for (const material of result!.plainMaterials) material.dispose();
	result!.geometry.dispose();
	expected.dispose();
	source.dispose();
	material.dispose();
});
