import type { BufferGeometry, Material } from 'three';
import type { FurnitureJewel } from './jewelShader.js';

export const JEWEL_HEIGHT_ATTRIBUTE = '_jewel_object_height';

/** Resolve the producer's per-primitive proof before transforms or union padding. */
export function restoreJewelGeometryProof(geometry: BufferGeometry, material: Material, jewel: Pick<FurnitureJewel, 'opal'>): void {
	if (!jewel.opal) return;

	const count = geometry.getAttribute('position')?.count;
	const carrier = geometry.getAttribute('_jewel_proof_index');
	const id = carrier?.getX(0);
	const proof = material.userData.ueJewelPrimitiveProofs?.[String(id)];
	if (
		!count ||
		!carrier ||
		carrier.itemSize !== 1 ||
		carrier.count !== count ||
		carrier.normalized ||
		!(carrier.array instanceof Uint32Array) ||
		!id ||
		!carrier.array.every((value) => value === id) ||
		!proof ||
		proof.contract !== jewel.opal.geometry ||
		proof.verifiedVertexCount !== count ||
		proof.sourceNativeIndex !== '_UE_VERTEX_INDEX' ||
		proof.positionMatched !== true ||
		proof.uv0Matched !== true ||
		proof.basisMatched !== true ||
		proof.primitiveLocalHeightMatched !== true ||
		proof.mismatches !== 0 ||
		proof.heightSpace !== 'native-position-z-cm-source-bind-pose'
	) throw new Error('[ModelManager] Opal native source proof transport missing');
	if (
		jewel.opal.parallax &&
		(geometry.getAttribute('tangent')?.itemSize !== 4 ||
			geometry.getAttribute('tangent')?.count !== count)
	) throw new Error('[ModelManager] Opal native tangent missing');

	if (jewel.opal.heightGradient) {
		const height = geometry.getAttribute(JEWEL_HEIGHT_ATTRIBUTE);
		if (
			!height ||
			height.itemSize !== 1 ||
			height.count !== count ||
			height.normalized ||
			!(height.array instanceof Float32Array) ||
			!height.array.every(Number.isFinite)
		) throw new Error('[ModelManager] Opal before-bake native height missing');
	}

	geometry.userData.ueJewelPrimitiveProof = proof;
	geometry.deleteAttribute('_jewel_proof_index');
}

/** Associate proof only with its actual merged material draw and vertex interval. */
export function mergeJewelGeometryProofs(geometry: BufferGeometry, sources: BufferGeometry[]): void {
	if (!sources.some((source) => source.userData.ueJewelPrimitiveProof)) return;

	const index = geometry.getIndex();
	let vertexStart = 0;
	const drawRanges = sources.flatMap((source, materialIndex) => {
		const vertexCount = source.getAttribute('position').count;
		const startVertex = vertexStart;
		vertexStart += vertexCount;

		const proof = source.userData.ueJewelPrimitiveProof;
		if (!proof) return [];

		const group = geometry.groups[materialIndex];
		const drawCount = source.getIndex()?.count ?? vertexCount;
		if (
			!group ||
			group.materialIndex !== materialIndex ||
			group.count !== drawCount ||
			!Number.isInteger(group.start) ||
			group.start < 0 ||
			group.start + group.count > (index?.count ?? vertexStart)
		) throw new Error('[ModelManager] Opal merge group missing or invalid');

		for (let offset = group.start; offset < group.start + group.count; offset++) {
			const vertex = index ? index.getX(offset) : offset;
			if (!Number.isInteger(vertex) || vertex < startVertex || vertex >= vertexStart) throw new Error('[ModelManager] Opal merged draw crosses source vertex interval');
		}

		return [
			{
				start: group.start,
				count: group.count,
				materialIndex,
				vertexStart: startVertex,
				vertexCount,
				proof,
			},
		];
	});
	geometry.userData.ueJewelPrimitiveProof = { drawRanges };
}
