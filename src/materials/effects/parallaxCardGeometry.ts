import { Matrix4, type BufferGeometry, type Material } from 'three';

const sourceSHA = '41514057bf503f52784adbbebebba46e975e0f93505f269d4f4c7070bff9a5b8';

export interface ParallaxCardGeometryProof {
	contract: string
	sourceContractSha256: string
	pixelShader: string
	vertexShader: string
	verifiedVertexCount: number
	sourceWindingParity: number
	sourceNodeBasis: string
	positionMatched: boolean
	basisMatched: boolean
	uvMatched: boolean
	windingMatched: boolean
	pose: string
	mismatches: number
	sourceNativeIndex: string
	compression?: {
		contract: string
		hashSpace: string
		decodedVertexCount: number
		proofIndexComponentType: number
		basisUVQuantizationBits: number
	}
}

export function restoreParallaxCardGeometryProof(geometry: BufferGeometry, material: Material): void {
	const count = geometry.getAttribute('position')?.count;
	const carrier = geometry.getAttribute('_parallax_card_proof_index');
	const id = carrier?.getX(0);
	const proof = material.userData.ueParallaxCardProofs?.[String(id)] as
		| ParallaxCardGeometryProof
		| undefined;
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
		proof.contract !== 'native-parallax-card-bind-basis-v1' ||
		proof.sourceContractSha256 !== sourceSHA ||
		proof.pixelShader !== '6908a0ea1431f20a76d0bd3a4bfbe2232608e4da' ||
		proof.vertexShader !== '1e1cbd045756f21ef75affcd1e7c53f0ee5d368a' ||
		proof.verifiedVertexCount !== count ||
		proof.sourceWindingParity !== 1 ||
		proof.sourceNodeBasis !== 'uniform-bind-nodes' ||
		proof.sourceNativeIndex !== '_UE_VERTEX_INDEX' ||
		proof.positionMatched !== true ||
		proof.basisMatched !== true ||
		proof.uvMatched !== true ||
		proof.windingMatched !== true ||
		proof.pose !== 'source-bind-pose' ||
		proof.mismatches !== 0
	) throw new Error('[ModelManager][ParallaxCard] original native proof/UInt32 carrier missing');
	if (
		proof.compression &&
		(proof.compression.contract !== 'parallax-card-native-lossless-draco-v1' ||
			proof.compression.hashSpace !== 'source-before-optimization' ||
			proof.compression.decodedVertexCount !== count ||
			proof.compression.proofIndexComponentType !== 5125 ||
			proof.compression.basisUVQuantizationBits !== 0)
	) throw new Error('[ModelManager][ParallaxCard] lossless decoded proof missing');

	for (const [name, width] of [
		['position', 3],
		['normal', 3],
		['tangent', 4],
		['uv', 2],
	] as const) {
		const attribute = geometry.getAttribute(name);
		if (
			!attribute ||
			attribute.count !== count ||
			attribute.itemSize !== width ||
			attribute.normalized ||
			!(attribute.array instanceof Float32Array) ||
			!attribute.array.every(Number.isFinite)
		) throw new Error(`[ModelManager][ParallaxCard] source ${name} missing before union padding`);
	}

	geometry.userData.ueParallaxCardProof = { ...proof };
	geometry.deleteAttribute('_parallax_card_proof_index');
}

export function mergeParallaxCardGeometryProofs(geometry: BufferGeometry, sources: BufferGeometry[]): void {
	if (!sources.some((source) => source.userData.ueParallaxCardProof)) return;

	const index = geometry.getIndex();
	let vertexStart = 0;
	const ranges = sources.flatMap((source, materialIndex) => {
		const vertexCount = source.getAttribute('position').count;
		const startVertex = vertexStart;
		vertexStart += vertexCount;

		const proof = source.userData.ueParallaxCardProof as ParallaxCardGeometryProof | undefined;
		if (!proof) return [];

		const group = geometry.groups[materialIndex];
		const count = source.getIndex()?.count ?? vertexCount;
		if (
			!group ||
			group.materialIndex !== materialIndex ||
			group.count !== count ||
			group.start < 0 ||
			group.start + group.count > (index?.count ?? vertexStart)
		) throw new Error('[ModelManager][ParallaxCard] merge draw range missing');

		for (let i = group.start; i < group.start + count; i++) {
			const vertex = index ? index.getX(i) : i;
			if (!Number.isInteger(vertex) || vertex < startVertex || vertex >= vertexStart) throw new Error('[ModelManager][ParallaxCard] merge borrowed native range');
		}

		return [
			{
				start: group.start,
				count,
				materialIndex,
				vertexStart: startVertex,
				vertexCount,
				proof: { ...proof },
			},
		];
	});
	geometry.userData.ueParallaxCardProof = { drawRanges: ranges };
}

/** Mirror baking reverses index winding and tangent.w together. Track exactly
 * those operations, rather than deriving facing from a remembered offset. */
export function transformParallaxCardGeometryProof(geometry: BufferGeometry, matrix: Matrix4): void {
	const value = geometry.userData.ueParallaxCardProof;
	if (!value) return;

	const columns = [0, 1, 2].map((i) => [matrix.elements[i * 4]!, matrix.elements[i * 4 + 1]!, matrix.elements[i * 4 + 2]!] as const);
	const lengths = columns.map((c) => Math.hypot(...c));
	if (
		!matrix.elements.every(Number.isFinite) ||
		lengths.some((x) => x <= 0) ||
		lengths.some((x) => Math.abs(x - lengths[0]!) > 1e-5 * lengths[0]!) ||
		[0, 1, 2].some(
			(i) =>
				Math.abs(columns[i]!.reduce((sum, x, k) => sum + x * columns[(i + 1) % 3]![k]!, 0)) >
				1e-5 * lengths[0]! ** 2,
		)
	) throw new Error('[ModelManager][ParallaxCard] nonuniform/sheared source node basis baking unproved');
	if (matrix.determinant() >= 0) return;

	const proofs = value.drawRanges
		? value.drawRanges.map((range: { proof: ParallaxCardGeometryProof }) => range.proof)
		: [value];
	for (const proof of proofs) proof.sourceWindingParity *= -1;
}

export function parallaxCardDrawProof(geometry: BufferGeometry, group: unknown): ParallaxCardGeometryProof {
	const value = geometry.userData.ueParallaxCardProof;
	if (!value) throw new Error('[ModelManager][ParallaxCard] actual draw proof missing');
	if (!value.drawRanges) return value;

	const draw = group as { start?: unknown; count?: unknown; materialIndex?: unknown } | null;
	if (
		!draw ||
		!Number.isInteger(draw.start) ||
		!Number.isInteger(draw.count) ||
		!Number.isInteger(draw.materialIndex)
	) throw new Error('[ModelManager][ParallaxCard] runtime-validated draw group required');

	const range = value.drawRanges.find(
		(item: { start: number; count: number; materialIndex: number }) =>
			item.start === draw.start &&
			item.count === draw.count &&
			item.materialIndex === draw.materialIndex,
	);
	if (!range) throw new Error('[ModelManager][ParallaxCard] draw crosses native proof ranges');

	return range.proof;
}
