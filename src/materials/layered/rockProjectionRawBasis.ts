import {
	Matrix3,
	Vector3,
	type BufferAttribute,
	type BufferGeometry,
	type InterleavedBufferAttribute,
	type Matrix4,
} from 'three';
import { rockProjectionBytesSHA256 } from './rockProjectionCollectionTexture.js';

export const ROCK_PROJECTION_RAW_NORMAL = '_projection_raw_n';
export const ROCK_PROJECTION_RAW_TANGENT = '_projection_raw_t';

export const ROCK_PROJECTION_RAW_ATTRIBUTES = [
	ROCK_PROJECTION_RAW_NORMAL,
	ROCK_PROJECTION_RAW_TANGENT,
];

export function rockProjectionCarrierSHA256(attribute: BufferAttribute | InterleavedBufferAttribute): string {
	const bytes = new Uint8Array(attribute.count * attribute.itemSize * 4);
	const view = new DataView(bytes.buffer);
	for (let vertex = 0; vertex < attribute.count; vertex++) {
		for (let lane = 0; lane < attribute.itemSize; lane++) {
			const value = attribute.getComponent(vertex, lane);
			if (!Number.isFinite(value)) throw new Error('[RockProjectionEditor] nonfinite raw carrier lane');

			view.setFloat32((vertex * attribute.itemSize + lane) * 4, value, true);
		}
	}

	return rockProjectionBytesSHA256(bytes);
}

export function assertRockProjectionRawCarriers(geometry: BufferGeometry): void {
	const proof = geometry.userData.ueProjectionRawBasisProof;
	const count = geometry.getAttribute('position')?.count;
	const decoded = proof?.transport;
	const preview = proof?.previewTransport;
	if (
		decoded &&
		(decoded.contract !== 'rock-projection-lossless-oriented-native-id-tuples-1' ||
			decoded.sourceTuplesMatched !== true ||
			decoded.orientedTrianglesMatched !== true ||
			decoded.simplification !== 'weld-reorder-only' ||
			!Array.isArray(decoded.nativeIDs) ||
			decoded.nativeIDs.length !== decoded.vertices ||
			decoded.nativeIDs.some(
				(value: unknown) =>
					typeof value !== 'number' ||
					!Number.isInteger(value) ||
					value < 0 ||
					value >= proof.vertices,
			))
	) throw new Error('[RockProjectionEditor] decoded source tuple/native-ID transport invalid');
	if (
		preview &&
		(preview.contract !== 'rock-projection-preview-bake-frame-1' ||
			(preview.bakeParity !== 1 && preview.bakeParity !== -1))
	) throw new Error('[RockProjectionEditor] derived preview frame invalid');

	const active = preview ?? decoded ?? proof;
	if (!proof || !count || active.vertices !== count) throw new Error('[RockProjectionEditor] original/decoded raw carrier count differs');

	for (const [name, size, hash] of [
		[ROCK_PROJECTION_RAW_NORMAL, 3, active.normalSHA256],
		[ROCK_PROJECTION_RAW_TANGENT, 4, active.tangentSHA256],
	] as const) {
		const attribute = geometry.getAttribute(name);
		if (
			!attribute ||
			attribute.count !== count ||
			attribute.itemSize !== size ||
			attribute.normalized ||
			!(attribute.array instanceof Float32Array) ||
			!/^[a-f0-9]{64}$/.test(hash ?? '') ||
			rockProjectionCarrierSHA256(attribute) !== hash
		) throw new Error(`[RockProjectionEditor] exact raw carrier ${name} bytes/shape changed`);
	}
}

export function assertRockProjectionDrawFrame(matrix: Matrix4): void {
	const e = matrix.elements;
	if (
		e.some((value) => !Number.isFinite(value)) ||
		e[3] !== 0 ||
		e[7] !== 0 ||
		e[11] !== 0 ||
		e[15] !== 1
	) throw new Error('[RockProjectionEditor] actual draw requires finite affine frame');

	const axes = [0, 1, 2].map((index) => new Vector3().setFromMatrixColumn(matrix, index));
	const [x, y, z] = axes;
	if (!x || !y || !z || axes.some((axis) => axis.length() <= 1e-12)) throw new Error('[RockProjectionEditor] singular actual draw frame');

	axes.forEach((axis) => axis.normalize());
	if (
		Math.max(Math.abs(x.dot(y)), Math.abs(x.dot(z)), Math.abs(y.dot(z))) > 1e-6 ||
		Math.abs(Math.abs(x.clone().cross(y).dot(z)) - 1) > 1e-6
	) throw new Error('[RockProjectionEditor] nonorthogonal/unproved actual draw frame');
}

/** VM VS removes each primitive axis's scale, not the source N/T lengths.
 * The original UE w is transported separately from the ordinary glTF tangent.
 */
export function transformRockProjectionRawBasis(geometry: BufferGeometry, matrix: Matrix4): void {
	const normal = geometry.getAttribute(ROCK_PROJECTION_RAW_NORMAL);
	const tangent = geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT);
	if (!normal && !tangent) return;

	assertRockProjectionRawCarriers(geometry);

	const count = geometry.getAttribute('position')?.count;
	if (
		!count ||
		!normal ||
		!tangent ||
		normal.count !== count ||
		tangent.count !== count ||
		normal.itemSize !== 3 ||
		tangent.itemSize !== 4 ||
		normal.normalized ||
		tangent.normalized ||
		!(normal.array instanceof Float32Array) ||
		!(tangent.array instanceof Float32Array)
	) throw new Error('[RockProjectionEditor] incomplete original raw basis carriers');

	const proof = geometry.userData.ueProjectionRawBasisProof;
	if (
		!proof ||
		proof.contract !== 'rock-projection-vm-raw-basis-1' ||
		proof.coordinateTransform !== 'CUE Gltf.SwapYZ(position*0.01f)' ||
		proof.sourceNativeIndex !== '_UE_VERTEX_INDEX' ||
		proof.decode !== 'archive-snorm8-vs-cross-cross-no-normalize' ||
		proof.resourceHash !== 'F995C1A9D8EF92BF8D321F8D4CB583345F07EF76' ||
		proof.vsHash !== 'e9875171a52e64fc0f751ea40bd4596ef2edf947' ||
		!/^[a-f0-9]{64}$/.test(proof.rawSHA256 ?? '') ||
		(proof.bakeParity !== 1 && proof.bakeParity !== -1)
	) throw new Error('[RockProjectionEditor] original raw basis source/frame proof missing');

	const e = matrix.elements;
	if (
		e.some((value) => !Number.isFinite(value)) ||
		e[3] !== 0 ||
		e[7] !== 0 ||
		e[11] !== 0 ||
		e[15] !== 1
	) throw new Error('[RockProjectionEditor] raw basis requires finite affine frame');

	const x = new Vector3().setFromMatrixColumn(matrix, 0);
	const y = new Vector3().setFromMatrixColumn(matrix, 1);
	const z = new Vector3().setFromMatrixColumn(matrix, 2);
	if ([x, y, z].some((axis) => axis.length() <= 1e-12)) throw new Error('[RockProjectionEditor] singular raw basis frame');

	x.normalize();
	y.normalize();
	z.normalize();
	if (Math.max(Math.abs(x.dot(y)), Math.abs(x.dot(z)), Math.abs(y.dot(z))) > 1e-6) throw new Error('[RockProjectionEditor] raw basis requires an orthogonal frame');

	const parity = x.clone().cross(y).dot(z);
	if (Math.abs(Math.abs(parity) - 1) > 1e-6) throw new Error('[RockProjectionEditor] unproved raw basis frame parity');

	const sign = parity < 0 ? -1 : 1;
	const rotation = new Matrix3().set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
	const n = new Vector3();
	const t = new Vector3();

	// Validate every lane before mutating any carrier or its proof.
	for (let vertex = 0; vertex < count; vertex++) {
		n.fromBufferAttribute(normal, vertex);
		t.fromBufferAttribute(tangent, vertex);
		if (
			![n.x, n.y, n.z, t.x, t.y, t.z].every(Number.isFinite) ||
			n.lengthSq() === 0 ||
			t.lengthSq() === 0 ||
			Math.abs(tangent.getW(vertex)) !== 1
		) throw new Error('[RockProjectionEditor] singular/nonfinite basis or unknown original handedness');
	}

	for (let vertex = 0; vertex < count; vertex++) {
		n.fromBufferAttribute(normal, vertex).applyMatrix3(rotation);
		t.fromBufferAttribute(tangent, vertex).applyMatrix3(rotation);
		normal.setXYZ(vertex, n.x, n.y, n.z);
		tangent.setXYZW(vertex, t.x, t.y, t.z, tangent.getW(vertex) * sign);
	}

	normal.needsUpdate = true;
	tangent.needsUpdate = true;

	const parityBefore = proof.previewTransport?.bakeParity ?? proof.bakeParity;
	geometry.userData.ueProjectionRawBasisProof = {
		...proof,
		previewTransport: {
			contract: 'rock-projection-preview-bake-frame-1',
			vertices: count,
			bakeParity: parityBefore * sign,
			normalSHA256: rockProjectionCarrierSHA256(normal),
			tangentSHA256: rockProjectionCarrierSHA256(tangent),
		},
	};
}
