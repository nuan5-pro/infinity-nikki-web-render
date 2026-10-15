import { BufferAttribute, Matrix3, Vector3, type BufferGeometry, type Matrix4 } from 'three';
import { assertNNClothBoundsFrame, type NNClothSourceBounds } from './nnclothBounds.js';
import { assertNNClothReviewedGeometry } from './nnclothSourceGeometry.js';

export const NN_CLOTH_SOURCE_POSITION = 'nnSourcePosition';
export const NN_CLOTH_SOURCE_NORMAL = 'nnSourceNormal';
export const NN_CLOTH_SOURCE_TANGENT = 'nnSourceTangent';
export const NN_CLOTH_WORLD_NORMAL = 'nnWorldNormal';
export const NN_CLOTH_WORLD_TANGENT = 'nnWorldTangent';

export function restoreNNClothSourceGeometry(geometry: BufferGeometry, metadata: unknown) {
	if (metadata === undefined) return;

	const proof = metadata as {
		contract?: string;
		packageSHA256?: string;
		sourceModelSHA256?: string;
		rawPRENormal?: string;
		requiredUV?: number[];
		shaderUVMap?: number[];
		bounds?: NNClothSourceBounds;
		nativeToExport?: number[];
	};
	const reviewedSource = proof !== null && typeof proof === 'object' && 'sourceBinding' in proof;
	if (reviewedSource) assertNNClothReviewedGeometry(proof);
	if (
		!proof ||
		proof.contract !== 'nncloth-native-static-controls-1' ||
		(!reviewedSource &&
			proof.packageSHA256 !== 'a857a939c01840dd93c5cd5400a652c98e8ec49b34a90d1e8e858d3f4aa21915') ||
		!/^[a-f0-9]{64}$/.test(proof.sourceModelSHA256 ?? '') ||
		proof.rawPRENormal !== 'original-archive-SNORM-not-normalized' ||
		proof.requiredUV?.join(',') !== '0,1,2' ||
		proof.shaderUVMap?.join(',') !== '0,1,2,2' ||
		proof.nativeToExport?.join(',') !== '0.01,0,0,0,0,0,0.01,0,0,0.01,0,0,0,0,0,1' ||
		!proof.bounds
	) throw new Error('[NNCloth] original native source geometry/frame proof invalid');

	for (const [source, target] of [
		['_nn_source_position', NN_CLOTH_SOURCE_POSITION],
		['_nn_source_normal', NN_CLOTH_SOURCE_NORMAL],
		['_nn_source_tangent', NN_CLOTH_SOURCE_TANGENT],
	]) {
		const stream = geometry.getAttribute(source!);
		if (!stream) throw new Error(`[NNCloth] original typed control stream ${source} missing before padding`);

		geometry.setAttribute(target!, stream);
		geometry.deleteAttribute(source!);
	}

	const frame = {
		bounds: proof.bounds,
		nativeToGeometry: proof.nativeToExport,
		boundsScale: 1 as const,
	};

	assertNNClothBoundsFrame(frame);
	geometry.userData.nnclothBoundsFrame = frame;
	prepareNNClothWorldBasis(geometry, [0, 1, 2]);
}

/** Decode the declared packed-normal domain. */
export function decodeNNClothNativeSNORM(word: number, domain: 'archive-int8-dword' | 'cue-after-precision-xor') {
	if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) throw new Error('[NNCloth] invalid original packed normal DWORD');

	const raw = domain === 'cue-after-precision-xor' ? (word ^ 0x80808080) >>> 0 : word;
	return Array.from({ length: 4 }, (_, lane) => {
		const byte = (raw >>> (lane * 8)) & 255;
		const signed = byte < 128 ? byte : byte - 256;
		return Math.fround(Math.max(signed / 127, -1));
	}) as [number, number, number, number];
}

export function assertNNClothSourceGeometry(geometry: BufferGeometry, requiredUV: number[]) {
	const count = geometry.getAttribute('position')?.count;
	for (const [name, size] of [
		[NN_CLOTH_SOURCE_POSITION, 3],
		[NN_CLOTH_SOURCE_NORMAL, 4],
		[NN_CLOTH_SOURCE_TANGENT, 4],
		...requiredUV.map((channel) => [channel === 0 ? 'uv' : `uv${channel}`, 2]),
	] as Array<[string, number]>) {
		const stream = geometry.getAttribute(name);
		if (
			!count ||
			!stream ||
			stream.itemSize !== size ||
			stream.count !== count ||
			stream.normalized ||
			!(stream.array instanceof Float32Array)
		) throw new Error(`[NNCloth] original pre-bake control/UV stream ${name} missing`);
		// Interleaved streams share storage. Validate the addressed float lanes.
		for (let vertex = 0; vertex < stream.count; vertex++) {
			for (let lane = 0; lane < size; lane++) {
				if (!Number.isFinite(stream.getComponent(vertex, lane))) throw new Error(`[NNCloth] nonfinite source stream ${name}`);
			}
		}
	}
}

/** Build the preview basis from immutable native controls. */
export function prepareNNClothWorldBasis(geometry: BufferGeometry, requiredUV: number[]) {
	assertNNClothSourceGeometry(geometry, requiredUV);

	const sourceNormal = geometry.getAttribute(NN_CLOTH_SOURCE_NORMAL);
	const sourceTangent = geometry.getAttribute(NN_CLOTH_SOURCE_TANGENT);
	const normals = new Float32Array(sourceNormal.count * 3);
	const tangents = new Float32Array(sourceNormal.count * 4);

	const cross = (a: number[], b: number[]) => [
		Math.fround(Math.fround(a[1]! * b[2]!) - Math.fround(a[2]! * b[1]!)),
		Math.fround(Math.fround(a[2]! * b[0]!) - Math.fround(a[0]! * b[2]!)),
		Math.fround(Math.fround(a[0]! * b[1]!) - Math.fround(a[1]! * b[0]!)),
	];

	for (let vertex = 0; vertex < sourceNormal.count; vertex++) {
		const n = [sourceNormal.getX(vertex), sourceNormal.getY(vertex), sourceNormal.getZ(vertex)];
		const x = [sourceTangent.getX(vertex), sourceTangent.getY(vertex), sourceTangent.getZ(vertex)];
		const sign = sourceNormal.getW(vertex);
		const y = cross(n, x).map((value) => Math.fround(value * sign));
		const correctedX = cross(y, n).map((value) => Math.fround(value * sign));
		// Exported positions use CUE SwapYZ; controls retain their original UE frame.
		normals.set([n[0]!, n[2]!, n[1]!], vertex * 3);
		tangents.set([correctedX[0]!, correctedX[2]!, correctedX[1]!, -sign], vertex * 4);
	}

	geometry.setAttribute(NN_CLOTH_WORLD_NORMAL, new BufferAttribute(normals, 3));
	geometry.setAttribute(NN_CLOTH_WORLD_TANGENT, new BufferAttribute(tangents, 4));
}

export function transformNNClothWorldBasis(geometry: BufferGeometry, matrix: Matrix4) {
	const normal = geometry.getAttribute(NN_CLOTH_WORLD_NORMAL);
	const tangent = geometry.getAttribute(NN_CLOTH_WORLD_TANGENT);
	if (!normal && !tangent) return;

	const determinant = matrix.determinant();
	if (
		!normal ||
		!tangent ||
		normal.count !== tangent.count ||
		!Number.isFinite(determinant) ||
		determinant === 0
	) throw new Error('[NNCloth] invalid preview basis/frame transform');
	// LocalVS removes preview axis scale while preserving authored SNORM lengths.
	const columns = [0, 1, 2].map((column) => new Vector3().setFromMatrixColumn(matrix, column).normalize());
	const transform = new Matrix3().set(
		columns[0]!.x,
		columns[1]!.x,
		columns[2]!.x,
		columns[0]!.y,
		columns[1]!.y,
		columns[2]!.y,
		columns[0]!.z,
		columns[1]!.z,
		columns[2]!.z,
	);
	const vector = new Vector3();
	const mirrored = determinant < 0;
	for (let vertex = 0; vertex < normal.count; vertex++) {
		vector.fromBufferAttribute(normal, vertex).applyMatrix3(transform);
		normal.setXYZ(vertex, vector.x, vector.y, vector.z);
		vector.fromBufferAttribute(tangent, vertex).applyMatrix3(transform);
		tangent.setXYZ(vertex, vector.x, vector.y, vector.z);
		if (mirrored) tangent.setW(vertex, -tangent.getW(vertex));
	}

	normal.needsUpdate = tangent.needsUpdate = true;
}
