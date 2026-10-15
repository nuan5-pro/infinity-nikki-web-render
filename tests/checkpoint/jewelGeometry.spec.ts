import { describe, expect, it } from 'vitest';
import {
	BufferGeometry,
	Float32BufferAttribute,
	Matrix4,
	MeshBasicMaterial,
	Uint32BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
	JEWEL_HEIGHT_ATTRIBUTE,
	mergeJewelGeometryProofs,
	restoreJewelGeometryProof,
} from '../../src/materials/jewel/jewelGeometry.js';

const jewel = {
	opal: { parallax: true, heightGradient: true, geometry: 'native-opal-primitive-v1' as const },
};

function source() {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
	geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
	geometry.setAttribute(JEWEL_HEIGHT_ATTRIBUTE, new Float32BufferAttribute([7, 15, 29], 1));
	geometry.setAttribute('_jewel_proof_index', new Uint32BufferAttribute([1, 1, 1], 1));
	geometry.setIndex([0, 1, 2]);

	const proof = {
		contract: jewel.opal.geometry,
		verifiedVertexCount: 3,
		sourceNativeIndex: '_UE_VERTEX_INDEX',
		positionMatched: true,
		uv0Matched: true,
		basisMatched: true,
		primitiveLocalHeightMatched: true,
		mismatches: 0,
		heightSpace: 'native-position-z-cm-source-bind-pose',
	};

	const material = new MeshBasicMaterial();
	material.userData.ueJewelPrimitiveProofs = { 1: proof };
	return { geometry, material, proof };
}

describe('Opal native geometry transport', () => {
	it('preserves native centimetre heights while baking source transforms', () => {
		const { geometry, material, proof } = source();
		restoreJewelGeometryProof(geometry, material, jewel);
		geometry.applyMatrix4(new Matrix4().makeScale(-200, 300, 400).setPosition(100, 200, 300));
		expect(Array.from(geometry.getAttribute(JEWEL_HEIGHT_ATTRIBUTE).array)).toEqual([7, 15, 29]);
		expect(geometry.userData.ueJewelPrimitiveProof).toBe(proof);
		expect(geometry.hasAttribute('_jewel_proof_index')).toBe(false);
	});

	it.each([
		'mixed-id',
		'float-id',
		'wrong-count',
		'missing-height',
		'missing-tangent',
		'nonfinite-height',
	])('rejects incomplete source transport: %s', (kind) => {
		const { geometry, material, proof } = source();
		switch (kind) {
		case 'mixed-id':
			geometry.getAttribute('_jewel_proof_index').setX(1, 2);
			break;
		case 'float-id':
			geometry.setAttribute('_jewel_proof_index', new Float32BufferAttribute([1, 1, 1], 1));
			break;
		case 'wrong-count':
			proof.verifiedVertexCount = 6;
			break;
		case 'missing-height':
			geometry.deleteAttribute(JEWEL_HEIGHT_ATTRIBUTE);
			break;
		case 'missing-tangent':
			geometry.deleteAttribute('tangent');
			break;
		case 'nonfinite-height':
			geometry.getAttribute(JEWEL_HEIGHT_ATTRIBUTE).setX(1, NaN);
			break;
		}

		expect(() => restoreJewelGeometryProof(geometry, material, jewel)).toThrow();
		expect(geometry.userData.ueJewelPrimitiveProof).toBeUndefined();
	});

	it('keeps proof confined to its merged draw rather than granting it to padded neighbours', () => {
		const { geometry, material, proof } = source();
		restoreJewelGeometryProof(geometry, material, jewel);

		const ordinary = geometry.clone();
		ordinary.userData = {};
		ordinary.getAttribute(JEWEL_HEIGHT_ATTRIBUTE).array.fill(0);

		const merged = mergeGeometries([ordinary, geometry], true)!;
		mergeJewelGeometryProofs(merged, [ordinary, geometry]);
		expect(merged.userData.ueJewelPrimitiveProof.drawRanges).toEqual([
			{ start: 3, count: 3, materialIndex: 1, vertexStart: 3, vertexCount: 3, proof },
		]);
		merged.getIndex()!.setX(3, 0);
		expect(() => mergeJewelGeometryProofs(merged, [ordinary, geometry])).toThrow('crosses source vertex interval');
	});
});
