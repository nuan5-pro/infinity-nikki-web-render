import { Matrix3, type Matrix4, type BufferGeometry, type Material } from 'three';

export const parallaxCardBasisV2SHA = '349f5c248bd5d004bd2926fb0aaa3e06880b00789c1dedcaf621000dcc2e7096';
export const parallaxCardBasisV2Contract = 'parallax-card-native-rhi-basis-v2';

export interface ParallaxCardBasisV2Proof {
	contract: string;
	contractSha256: string;
	sourceModelSha256: string;
	pixelShader: string;
	vertexShader: string;
	verifiedVertexCount: number;
	sourceWindingParity: number;
	sourceToGeometry: number[];
	sourceNativeIndex: string;
	sourceDomain: string;
	boneDomain: string;
	mismatches: number;
	compression?: {
		contract: string;
		hashSpace: string;
		decodedVertexCount: number;
		proofIndexComponentType: number;
		sourceIndexComponentType: number;
		basisBindQuantizationBits: number;
	};
}

const streams = [
	['_jewel_rhi_tangent_x', 'cardRHITangentX', 4],
	['_jewel_rhi_normal_z', 'cardRHINormalZ', 3],
	['_jewel_rhi_bind_row0', 'cardRHIBindRow0', 3],
	['_jewel_rhi_bind_row1', 'cardRHIBindRow1', 3],
	['_jewel_rhi_bind_row2', 'cardRHIBindRow2', 3],
] as const;

export const PARALLAX_CARD_BASIS_V2_ATTRIBUTES: readonly string[] = [
	...streams.map(([, target]) => target),
	'_jewel_rhi_source_index',
];

function validateFrame(proof: ParallaxCardBasisV2Proof): void {
	const values = proof.sourceToGeometry;
	if (
		!Array.isArray(values) ||
		values.length !== 9 ||
		!values.every(Number.isFinite) ||
		![1, -1].includes(proof.sourceWindingParity)
	) throw new Error('[ParallaxCardV2] source frame missing');

	const matrix = new Matrix3().fromArray(values);
	const columns = [0, 1, 2].map((i) => values.slice(i * 3, i * 3 + 3));
	if (
		columns.some((column) => Math.abs(Math.hypot(...column) - 1) > 1e-5) ||
		columns.some((column, i) => Math.abs(column.reduce((sum, x, j) => sum + x * columns[(i + 1) % 3]![j]!, 0)) > 1e-5) ||
		Math.abs(matrix.determinant() + proof.sourceWindingParity) > 1e-5
	) throw new Error('[ParallaxCardV2] source frame requires orthogonal native XYZ transport');
}

export function restoreParallaxCardBasisV2(geometry: BufferGeometry, material: Material): void {
	const count = geometry.getAttribute('position')?.count;
	const carrier = geometry.getAttribute('_parallax_card_basis_v2_proof_index');
	const sourceIDs = geometry.getAttribute('_jewel_rhi_source_index');
	const id = carrier?.getX(0);
	const proof = material.userData.UEParallaxCardBasisV2Proofs?.[String(id)] as
		| ParallaxCardBasisV2Proof
		| undefined;
	if (
		!count ||
		!carrier ||
		carrier.count !== count ||
		carrier.itemSize !== 1 ||
		carrier.normalized ||
		!(carrier.array instanceof Uint32Array) ||
		id !== 1 ||
		!carrier.array.every((value) => value === id) ||
		!sourceIDs ||
		sourceIDs.count !== count ||
		sourceIDs.itemSize !== 1 ||
		sourceIDs.normalized ||
		!(sourceIDs.array instanceof Uint32Array) ||
		!proof ||
		proof.contract !== parallaxCardBasisV2Contract ||
		proof.contractSha256 !== parallaxCardBasisV2SHA ||
		proof.sourceModelSha256 !==
			'fb02f8868d5eb6610dab9e31375890d8c2c9979b4116af60e382aed15649758a' ||
		proof.pixelShader !== '6908a0ea1431f20a76d0bd3a4bfbe2232608e4da' ||
		proof.vertexShader !== '1e1cbd045756f21ef75affcd1e7c53f0ee5d368a' ||
		proof.verifiedVertexCount !== count ||
		proof.sourceNativeIndex !== '_UE_VERTEX_INDEX' ||
		proof.mismatches !== 0 ||
		proof.sourceDomain !== 'native-snorm8-original-split-buffer' ||
		proof.boneDomain !== 'explicit-original-source-reference-bind-rows'
	) throw new Error('[ParallaxCardV2] native source/typed carrier proof missing');

	validateFrame(proof);

	const compression = proof.compression;
	if (
		compression &&
		(compression.contract !== 'parallax-card-native-rhi-lossless-draco-v2' ||
			compression.hashSpace !== 'source-before-optimization' ||
			compression.decodedVertexCount !== count ||
			compression.proofIndexComponentType !== 5125 ||
			compression.sourceIndexComponentType !== 5125 ||
			compression.basisBindQuantizationBits !== 0)
	) throw new Error('[ParallaxCardV2] lossy or untyped compression proof');

	for (const [source, target, width] of streams) {
		const attribute = geometry.getAttribute(source);
		if (
			!attribute ||
			attribute.count !== count ||
			attribute.itemSize !== width ||
			attribute.normalized ||
			!(attribute.array instanceof Float32Array) ||
			!attribute.array.every(Number.isFinite) ||
			geometry.hasAttribute(target)
		) throw new Error(`[ParallaxCardV2] native ${source} missing before union padding`);
	}

	for (const [source, target] of streams) {
		geometry.setAttribute(target, geometry.getAttribute(source));
		geometry.deleteAttribute(source);
	}

	geometry.userData.parallaxCardBasisV2 = {
		...proof,
		sourceToGeometry: [...proof.sourceToGeometry],
	};
	geometry.deleteAttribute('_parallax_card_basis_v2_proof_index');
}

interface DrawRange {
	start: number;
	count: number;
	materialIndex: number;
	proof: ParallaxCardBasisV2Proof;
}

export function parallaxCardBasisV2DrawProof(geometry: BufferGeometry, group: unknown): ParallaxCardBasisV2Proof {
	const value = geometry.userData.parallaxCardBasisV2 as
		| ParallaxCardBasisV2Proof
		| { drawRanges: DrawRange[] }
		| undefined;
	if (!value) throw new Error('[ParallaxCardV2] actual draw proof missing');

	if (!('drawRanges' in value)) {
		validateFrame(value);
		return value;
	}

	const draw = group as { start?: unknown; count?: unknown; materialIndex?: unknown } | null;
	if (
		!draw ||
		!Number.isInteger(draw.start) ||
		!Number.isInteger(draw.count) ||
		!Number.isInteger(draw.materialIndex)
	) throw new Error('[ParallaxCardV2] runtime-validated draw group missing');

	const range = value.drawRanges.find(
		(item) =>
			item.start === draw.start &&
			item.count === draw.count &&
			item.materialIndex === draw.materialIndex,
	);
	if (!range) throw new Error('[ParallaxCardV2] draw crosses source-native range');

	validateFrame(range.proof);
	return range.proof;
}

/** Raw RHI streams stay before VF and source-node bake. Only this orthogonal
 * transport follows baking; Three's generic normal/tangent transforms are not
 * the selected GPUSkin instruction sequence. */
export function transformParallaxCardBasisV2(geometry: BufferGeometry, matrix: Matrix4): void {
	const value = geometry.userData.parallaxCardBasisV2;
	if (!value) return;

	const linear = new Matrix3().setFromMatrix4(matrix);
	const scale = Math.hypot(...linear.elements.slice(0, 3));
	if (
		!matrix.elements.every(Number.isFinite) ||
		!(scale > 0) ||
		matrix.elements[3] !== 0 ||
		matrix.elements[7] !== 0 ||
		matrix.elements[11] !== 0 ||
		matrix.elements[15] !== 1
	) throw new Error('[ParallaxCardV2] source-node affine frame unproved');

	for (let i = 0; i < linear.elements.length; i++) linear.elements[i] = linear.elements[i]! / scale;

	const proofs: ParallaxCardBasisV2Proof[] = value.drawRanges
		? value.drawRanges.map((range: DrawRange) => range.proof)
		: [value];
	const updated = proofs.map((proof) => {
		const next = {
			...proof,
			sourceToGeometry: new Matrix3()
				.multiplyMatrices(linear, new Matrix3().fromArray(proof.sourceToGeometry))
				.toArray(),
			sourceWindingParity: proof.sourceWindingParity * Math.sign(linear.determinant()),
		};

		validateFrame(next);
		return next;
	});
	updated.forEach((proof, i) => Object.assign(proofs[i]!, proof));
}

export function mergeParallaxCardBasisV2(geometry: BufferGeometry, sources: BufferGeometry[]): void {
	if (!sources.some((source) => source.userData.parallaxCardBasisV2)) return;

	let offset = 0;
	const index = geometry.getIndex();
	const ranges = sources.flatMap((source, materialIndex): DrawRange[] => {
		const vertexStart = offset;
		const vertexCount = source.getAttribute('position').count;
		offset += vertexCount;

		const proof = source.userData.parallaxCardBasisV2 as ParallaxCardBasisV2Proof | undefined;
		if (!proof) return [];

		const group = geometry.groups[materialIndex];
		const count = source.getIndex()?.count ?? vertexCount;
		if (
			!group ||
			group.materialIndex !== materialIndex ||
			group.count !== count ||
			group.start < 0 ||
			group.start + count > (index?.count ?? geometry.getAttribute('position').count)
		) throw new Error('[ParallaxCardV2] merge draw range missing');

		for (let i = group.start; i < group.start + count; i++) {
			const vertex = index ? index.getX(i) : i;
			if (!Number.isInteger(vertex) || vertex < vertexStart || vertex >= offset) throw new Error('[ParallaxCardV2] merge borrowed native source vertices');
		}

		return [
			{
				start: group.start,
				count,
				materialIndex,
				proof: { ...proof, sourceToGeometry: [...proof.sourceToGeometry] },
			},
		];
	});
	geometry.userData.parallaxCardBasisV2 = { drawRanges: ranges };
}
