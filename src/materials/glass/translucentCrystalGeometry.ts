import type { BufferGeometry, Material } from 'three';
import type { FurnitureTranslucentCrystal } from './translucentCrystalShader.js';

/** Resolve before baking/union padding; compressed byte hashes are not rechecked. */
export function restoreTranslucentCrystalGeometryProof(geometry: BufferGeometry, material: Material, profile: FurnitureTranslucentCrystal): void {
	const count = geometry.getAttribute('position')?.count;
	const carrier = geometry.getAttribute('_crystal_proof_index');
	const id = carrier?.getX(0);
	const proof = material.userData.ueTranslucentCrystalProofs?.[String(id)];
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
		proof.contract !== profile.geometry ||
		proof.verifiedVertexCount !== count ||
		proof.sourceNativeIndex !== '_UE_VERTEX_INDEX' ||
		proof.positionMatched !== true ||
		proof.basisMatched !== true ||
		proof.uvMatched !== true ||
		proof.mismatches !== 0 ||
		proof.pose !== 'source-bind-pose' ||
		proof.pixelShader !== 'a576d489ff423f4197f5746a78127a0ea3aefdb4'
	) throw new Error('[ModelManager][Crystal] native geometry proof transport missing');
	if (
		proof.compression &&
		(proof.compression.contract !== 'crystal-native-lossless-draco-v1' ||
			proof.compression.proofIndexComponentType !== 5125 ||
			proof.compression.basisUVQuantizationBits !== 0 ||
			proof.compression.decodedVertexCount !== count ||
			proof.compression.hashSpace !== 'source-before-optimization')
	) throw new Error('[ModelManager][Crystal] native lossless compression contract missing');

	for (const name of [
		'position',
		'normal',
		'tangent',
		...profile.requiredUv.map((uv) => (uv === 0 ? 'uv' : `uv${uv}`)),
	]) {
		const attribute = geometry.getAttribute(name);
		const size = name === 'tangent' ? 4 : name === 'position' || name === 'normal' ? 3 : 2;
		if (
			!attribute ||
			attribute.itemSize !== size ||
			attribute.count !== count ||
			attribute.normalized ||
			!(attribute.array instanceof Float32Array) ||
			!attribute.array.every(Number.isFinite)
		) throw new Error(`[ModelManager][Crystal] native ${name} stream missing`);
	}

	geometry.userData.ueTranslucentCrystalProof = proof;
	geometry.deleteAttribute('_crystal_proof_index');
}

/** Preserve proof only for its material draw and source vertex interval. */
export function mergeTranslucentCrystalGeometryProofs(geometry: BufferGeometry, sources: BufferGeometry[]): void {
	if (!sources.some((source) => source.userData.ueTranslucentCrystalProof)) return;

	const index = geometry.getIndex();
	let vertexStart = 0;
	const drawRanges = sources.flatMap((source, materialIndex) => {
		const vertexCount = source.getAttribute('position').count;
		const startVertex = vertexStart;
		vertexStart += vertexCount;

		const proof = source.userData.ueTranslucentCrystalProof;
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
		) throw new Error('[ModelManager][Crystal] native merge group missing');

		for (let offset = group.start; offset < group.start + group.count; offset++) {
			const vertex = index ? index.getX(offset) : offset;
			if (!Number.isInteger(vertex) || vertex < startVertex || vertex >= vertexStart) throw new Error('[ModelManager][Crystal] merged draw crosses source vertex interval');
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
	geometry.userData.ueTranslucentCrystalProof = { drawRanges };
}
