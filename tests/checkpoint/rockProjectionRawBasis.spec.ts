import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import {
	assertRockProjectionRawCarriers,
	ROCK_PROJECTION_RAW_NORMAL,
	ROCK_PROJECTION_RAW_TANGENT,
	rockProjectionCarrierSHA256,
	transformRockProjectionRawBasis,
} from '../../src/materials/layered/rockProjectionRawBasis.js';

function fixture() {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
	geometry.setAttribute(ROCK_PROJECTION_RAW_NORMAL, new Float32BufferAttribute([0, 0.8, 0], 3));
	geometry.setAttribute(ROCK_PROJECTION_RAW_TANGENT, new Float32BufferAttribute([0.4, 0, 0, -1], 4));
	geometry.userData.ueProjectionRawBasisProof = {
		contract: 'rock-projection-vm-raw-basis-1',
		coordinateTransform: 'CUE Gltf.SwapYZ(position*0.01f)',
		sourceNativeIndex: '_UE_VERTEX_INDEX',
		decode: 'archive-snorm8-vs-cross-cross-no-normalize',
		resourceHash: 'F995C1A9D8EF92BF8D321F8D4CB583345F07EF76',
		vsHash: 'e9875171a52e64fc0f751ea40bd4596ef2edf947',
		rawSHA256: 'a'.repeat(64),
		vertices: 1,
		bakeParity: 1,
		normalSHA256: rockProjectionCarrierSHA256(geometry.getAttribute(ROCK_PROJECTION_RAW_NORMAL)),
		tangentSHA256: rockProjectionCarrierSHA256(geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT)),
	};
	return geometry;
}

describe('original projection raw basis bake', () => {
	it('leaves unrelated geometry unchanged', () => {
		expect(() => transformRockProjectionRawBasis(new BufferGeometry(), new Matrix4())).not.toThrow();
	});
	it('removes nonuniform axis scale without normalizing original N/T', () => {
		const geometry = fixture();
		transformRockProjectionRawBasis(geometry, new Matrix4().makeScale(2, 3, 4));
		expect(geometry.getAttribute(ROCK_PROJECTION_RAW_NORMAL).getY(0)).toBeCloseTo(0.8);
		expect(geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT).getX(0)).toBeCloseTo(0.4);
		expect(geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT).getW(0)).toBe(-1);
	});
	it('derives mirror parity from the actual affine matrix, once per bake', () => {
		const geometry = fixture();
		transformRockProjectionRawBasis(geometry, new Matrix4().makeScale(-2, 3, 4));
		expect(geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT).getX(0)).toBeCloseTo(-0.4);
		expect(geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT).getW(0)).toBe(1);
		expect(geometry.userData.ueProjectionRawBasisProof.previewTransport.bakeParity).toBe(-1);
		expect(geometry.userData.ueProjectionRawBasisProof.bakeParity).toBe(1);
		transformRockProjectionRawBasis(geometry, new Matrix4().makeScale(-1, 1, 1));
		expect(geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT).getW(0)).toBe(-1);
		expect(geometry.userData.ueProjectionRawBasisProof.previewTransport.bakeParity).toBe(1);
	});
	it('reads verified decoded transport independently of immutable source order and rejects changed bytes', () => {
		const geometry = fixture();
		const source = geometry.userData.ueProjectionRawBasisProof;
		source.transport = {
			contract: 'rock-projection-lossless-oriented-native-id-tuples-1',
			vertices: 1,
			nativeIDs: [0],
			sourceTuplesMatched: true,
			orientedTrianglesMatched: true,
			simplification: 'weld-reorder-only',
			normalSHA256: source.normalSHA256,
			tangentSHA256: source.tangentSHA256,
		};

		const original = JSON.stringify(source.transport);
		transformRockProjectionRawBasis(geometry, new Matrix4().makeScale(-1, 1, 1));
		expect(JSON.stringify(geometry.userData.ueProjectionRawBasisProof.transport)).toBe(original);
		expect(() => assertRockProjectionRawCarriers(geometry)).not.toThrow();
		geometry.getAttribute(ROCK_PROJECTION_RAW_NORMAL).setY(0, 0.7);
		expect(() => assertRockProjectionRawCarriers(geometry)).toThrow(/bytes/);
	});
	it('refuses a decoded native ID outside the proven source table', () => {
		const geometry = fixture();
		const source = geometry.userData.ueProjectionRawBasisProof;
		source.transport = {
			contract: 'rock-projection-lossless-oriented-native-id-tuples-1',
			vertices: 1,
			nativeIDs: [1],
			sourceTuplesMatched: true,
			orientedTrianglesMatched: true,
			simplification: 'weld-reorder-only',
			normalSHA256: source.normalSHA256,
			tangentSHA256: source.tangentSHA256,
		};
		expect(() => assertRockProjectionRawCarriers(geometry)).toThrow(/native-ID/);
	});
	it('transports the complete existing root mirror/Y/X frame, keeping the original proof immutable', () => {
		const geometry = fixture();
		const original = { ...geometry.userData.ueProjectionRawBasisProof };
		transformRockProjectionRawBasis(geometry, new Matrix4().makeScale(-1, 1, 1));
		transformRockProjectionRawBasis(geometry, new Matrix4().makeRotationY(Math.PI / 2));
		transformRockProjectionRawBasis(geometry, new Matrix4().makeRotationX(Math.PI / 2));

		const n = geometry.getAttribute(ROCK_PROJECTION_RAW_NORMAL);
		const t = geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT);
		expect(n.getX(0)).toBeCloseTo(0);
		expect(n.getY(0)).toBeCloseTo(0);
		expect(n.getZ(0)).toBeCloseTo(0.8);
		expect(t.getX(0)).toBeCloseTo(0);
		expect(t.getY(0)).toBeCloseTo(-0.4);
		expect(t.getZ(0)).toBeCloseTo(0);
		expect(t.getW(0)).toBe(1);
		expect(geometry.userData.ueProjectionRawBasisProof.previewTransport.bakeParity).toBe(-1);
		for (const [key, value] of Object.entries(original))
			expect(geometry.userData.ueProjectionRawBasisProof[key]).toEqual(value);
	});
	it.each([
		'missing-proof',
		'missing-parity',
		'missing-carrier',
		'unknown-sign',
		'nonfinite',
		'singular',
		'shear',
	])('rejects %s before carrier mutation', (kind) => {
		const geometry = fixture();
		const matrix = new Matrix4();
		switch (kind) {
		case 'missing-proof':
			delete geometry.userData.ueProjectionRawBasisProof;
			break;
		case 'missing-parity':
			delete geometry.userData.ueProjectionRawBasisProof.bakeParity;
			break;
		case 'missing-carrier':
			geometry.deleteAttribute(ROCK_PROJECTION_RAW_NORMAL);
			break;
		case 'unknown-sign':
			geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT).setW(0, 0);
			break;
		case 'nonfinite':
			matrix.elements[0] = NaN;
			break;
		case 'singular':
			matrix.makeScale(0, 1, 1);
			break;
		case 'shear':
			matrix.elements[4] = 0.25;
			break;
		}

		const before = Array.from(geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT).array);
		expect(() => transformRockProjectionRawBasis(geometry, matrix)).toThrow();
		expect(Array.from(geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT).array)).toEqual(before);
	});
});
