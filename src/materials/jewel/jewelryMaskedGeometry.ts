import {
	BufferAttribute,
	IntType,
	Matrix3,
	Matrix4,
	type BufferGeometry,
	type Material,
} from 'three';
import {
	readJewelryMaskedSourceContract,
	type JewelryMaskedSourceContract,
} from './jewelryMaskedShader.js';

const streams = [
	['_jewel_masked_packed_basis', 'jewelryNativePackedBasis', 2, Uint32Array],
	['_jewel_masked_local_cm', 'jewelryNativeLocalCM', 3, Float32Array],
	['_jewel_masked_source_index', 'jewelryNativeSourceIndex', 1, Uint32Array],
	['_jewel_masked_proof_index', 'jewelryNativeProofIndex', 1, Uint32Array],
] as const;

export const JEWELRY_MASKED_ATTRIBUTES: readonly string[] = streams.map(([, target]) => target);

export interface JewelryMaskedGeometryProof {
	contract: string
	sourceContractSha256: string
	runtimeProofSha256: string
	sourceModelSha256: string
	geometryCaptureSha256: string
	pixelShader: string
	vertexShader: string
	proofIndex: number
	proofScope: 'original-static-section-before-bake'
	sourceMaterialSlot: number
	sourceMeshIndex: number
	sourcePrimitiveIndex: number
	sourceVertexCount: number
	sourceIDCount: number
	verifiedVertexCount: number
	positionMatched: true
	uvMatched: true
	packedBasisMatched: true
	localCMMatched: true
	beforeBake: true
	runtimeAdmitted: true
	mismatches: 0
	sourceToGeometry: number[]
	/** Full native-local centimetre → geometry affine, distinct from the direction frame. */
	sourceCMToGeometry: number[]
	compression: {
		contract: 'jewelry-masked-static-typed-lossless-v1'
		hashSpace: 'source-before-optimization'
		decodedVertexCount: number
		proofIndexComponentType: 5125
		sourceIndexComponentType: 5125
		packedBasisComponentType: 5125
		localCMQuantizationBits: 0
		retainedTupleMismatches: 0
		orientedAssociationMismatches: 0
	}
}

interface DrawProof {
	start: number
	count: number
	materialIndex: number
	vertexStart: number
	vertexCount: number
	proof: JewelryMaskedGeometryProof
}

interface MergedProof {
	drawRanges: DrawProof[]
}

const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;

const affine = (values: number[]) =>
	Array.isArray(values) &&
	values.length === 16 &&
	values.every(Number.isFinite) &&
	values[3] === 0 &&
	values[7] === 0 &&
	values[11] === 0 &&
	values[15] === 1 &&
	Number.isFinite(new Matrix4().fromArray(values).determinant()) &&
	new Matrix4().fromArray(values).determinant() !== 0;

function validateFrame(proof: JewelryMaskedGeometryProof): void {
	if (
		!Array.isArray(proof.sourceToGeometry) ||
		proof.sourceToGeometry.length !== 9 ||
		!proof.sourceToGeometry.every(Number.isFinite) ||
		new Matrix3().fromArray(proof.sourceToGeometry).determinant() === 0 ||
		!affine(proof.sourceCMToGeometry)
	) throw new Error('[JewelryMasked] complete beforeBake direction/centimetre frame missing');

	const full = new Matrix3().setFromMatrix4(new Matrix4().fromArray(proof.sourceCMToGeometry)).elements;
	for (let column = 0; column < 3; column++) {
		const scale = Math.hypot(...full.slice(column * 3, column * 3 + 3));
		if (!Number.isFinite(scale) || scale <= 0) throw new Error('[JewelryMasked] singular source CM column');

		for (let row = 0; row < 3; row++) {
			if (
				Math.abs(full[column * 3 + row]! / scale - proof.sourceToGeometry[column * 3 + row]!) >
				1e-12
			) throw new Error('[JewelryMasked] direction frame differs from full source CM affine');
		}
	}
}

/** Restore only an already admitted runtime proof. Private source-only recovery cannot use this bridge. */
export function restoreJewelryMaskedGeometry(geometry: BufferGeometry, material: Material, source: JewelryMaskedSourceContract): void {
	if (!readJewelryMaskedSourceContract(source)) throw new Error('[JewelryMasked] invalid optional source contract');

	const count = geometry.getAttribute('position')?.count;
	const attributes = streams.map(([name, target, width, type]) => {
		const lower = geometry.getAttribute(name);
		const upper = geometry.getAttribute(name.toUpperCase());
		const attribute = lower ?? upper;
		if (
			(lower && upper) ||
			!count ||
			!(attribute instanceof BufferAttribute) ||
			attribute.count !== count ||
			attribute.itemSize !== width ||
			attribute.normalized ||
			!(attribute.array instanceof type) ||
			geometry.hasAttribute(target)
		) throw new Error(`[JewelryMasked] original exact typed stream missing/ambiguous ${name}`);

		return attribute;
	});
	const carrier = attributes[3]!;
	const id = carrier.getX(0);
	const proof = material.userData.UEJewelryMaskedProofs?.[String(id)] as
		| JewelryMaskedGeometryProof
		| undefined;
	if (
		!count ||
		!integer(id) ||
		id === 0 ||
		!(carrier.array instanceof Uint32Array) ||
		!carrier.array.every((value) => value === id) ||
		!proof ||
		proof.contract !== source.contract ||
		proof.sourceContractSha256 !== source.sourceContractSha256 ||
		proof.runtimeProofSha256 !== source.runtimeProofSha256 ||
		(source.sourceModelSha256 !== undefined &&
			proof.sourceModelSha256 !== source.sourceModelSha256) ||
		proof.geometryCaptureSha256 !== source.geometryCaptureSha256 ||
		proof.pixelShader !== source.pixelShader ||
		proof.vertexShader !== source.vertexShader ||
		proof.proofIndex !== id ||
		proof.proofScope !== 'original-static-section-before-bake' ||
		proof.runtimeAdmitted !== true ||
		proof.positionMatched !== true ||
		proof.uvMatched !== true ||
		proof.packedBasisMatched !== true ||
		proof.localCMMatched !== true ||
		proof.beforeBake !== true ||
		proof.mismatches !== 0 ||
		proof.verifiedVertexCount !== count ||
		![proof.sourceMaterialSlot, proof.sourceMeshIndex, proof.sourcePrimitiveIndex].every(integer) ||
		!integer(proof.sourceVertexCount) ||
		proof.sourceVertexCount === 0 ||
		!integer(proof.sourceIDCount) ||
		proof.sourceIDCount === 0
	) throw new Error('[JewelryMasked] admitted source-slot/runtime/typed proof missing');

	const compression = proof.compression;
	if (
		!compression ||
		compression.contract !== 'jewelry-masked-static-typed-lossless-v1' ||
		compression.hashSpace !== 'source-before-optimization' ||
		compression.decodedVertexCount !== count ||
		compression.proofIndexComponentType !== 5125 ||
		compression.sourceIndexComponentType !== 5125 ||
		compression.packedBasisComponentType !== 5125 ||
		compression.localCMQuantizationBits !== 0 ||
		compression.retainedTupleMismatches !== 0 ||
		compression.orientedAssociationMismatches !== 0
	) throw new Error('[JewelryMasked] original typed association/lossless compression proof missing');

	validateFrame(proof);

	const ids = attributes[2]!.array as Uint32Array;
	if (
		ids.some((value) => value >= proof.sourceVertexCount) ||
		new Set(ids).size !== proof.sourceIDCount ||
		!(attributes[1]!.array instanceof Float32Array) ||
		!attributes[1]!.array.every(Number.isFinite)
	) throw new Error('[JewelryMasked] source ID/local CM controls differ from section proof');
	// Mutate only after every source/runtime/count/frame check. GPU integer inputs
	// remain Uint32; generic float readers and normalized attributes are not used.
	streams.forEach(([name, target, , type], index) => {
		const attribute = attributes[index]!;
		if (type === Uint32Array) attribute.gpuType = IntType;
		geometry.setAttribute(target, attribute);
		geometry.deleteAttribute(name);
		geometry.deleteAttribute(name.toUpperCase());
	});
	geometry.userData.ueJewelryMaskedProof = {
		...proof,
		sourceToGeometry: [...proof.sourceToGeometry],
		sourceCMToGeometry: [...proof.sourceCMToGeometry],
	};
}

/** Follow geometry bake without touching raw packed/local-CM/source-ID controls. */
export function transformJewelryMaskedGeometry(geometry: BufferGeometry, matrix: Matrix4): void {
	const value = geometry.userData.ueJewelryMaskedProof as
		| JewelryMaskedGeometryProof
		| MergedProof
		| undefined;
	if (!value) return;
	if (!affine(matrix.elements)) throw new Error('[JewelryMasked] singular/nonaffine geometry bake');

	const proofs = 'drawRanges' in value ? value.drawRanges.map((range) => range.proof) : [value];
	const updated = proofs.map((proof) => {
		validateFrame(proof);

		const full = matrix.clone().multiply(new Matrix4().fromArray(proof.sourceCMToGeometry));
		const direction = new Matrix3().setFromMatrix4(full);
		for (let column = 0; column < 3; column++) {
			const scale = Math.hypot(...direction.elements.slice(column * 3, column * 3 + 3));
			for (let row = 0; row < 3; row++)
				direction.elements[column * 3 + row] = direction.elements[column * 3 + row]! / scale;
		}

		const next = {
			...proof,
			sourceCMToGeometry: full.toArray(),
			sourceToGeometry: direction.toArray(),
		};

		validateFrame(next);
		return next;
	});
	updated.forEach((proof, index) => Object.assign(proofs[index]!, proof));
}

/** Non-source slots may have zero padding, but admitted draws must not reference it. */
export function mergeJewelryMaskedGeometry(geometry: BufferGeometry, sources: BufferGeometry[]): void {
	if (!sources.some((source) => source.userData.ueJewelryMaskedProof)) return;

	const total = geometry.getAttribute('position').count;
	for (const [, target, size, type] of streams) {
		const attribute = geometry.getAttribute(target);
		if (
			!(attribute instanceof BufferAttribute) ||
			attribute.count !== total ||
			attribute.itemSize !== size ||
			attribute.normalized ||
			!(attribute.array instanceof type)
		) throw new Error('[JewelryMasked] merge discarded/converted typed controls');

		if (type === Uint32Array) attribute.gpuType = IntType;
	}

	let vertexStart = 0;
	const index = geometry.getIndex();
	const ranges: DrawProof[] = [];
	sources.forEach((source, materialIndex) => {
		const vertexCount = source.getAttribute('position').count;
		const first = vertexStart;
		vertexStart += vertexCount;

		const proof = source.userData.ueJewelryMaskedProof as JewelryMaskedGeometryProof | undefined;
		if (!proof) return;
		if ('drawRanges' in proof) throw new Error('[JewelryMasked] nested source merges require explicit original slot remapping');

		const group = geometry.groups[materialIndex];
		const count = source.getIndex()?.count ?? vertexCount;
		if (
			!group ||
			group.materialIndex !== materialIndex ||
			group.count !== count ||
			!integer(group.start) ||
			count % 3 !== 0
		) throw new Error('[JewelryMasked] original source section merge drawrange missing');

		const controls = geometry.getAttribute('jewelryNativeProofIndex');
		if (!controls || !(controls.array instanceof Uint32Array) || controls.normalized) throw new Error('[JewelryMasked] merged typed proof IDs missing');

		for (let draw = group.start; draw < group.start + count; draw++) {
			const vertex = index ? index.getX(draw) : draw;
			if (
				!integer(vertex) ||
				vertex < first ||
				vertex >= vertexStart ||
				controls.getX(vertex) !== proof.proofIndex
			) throw new Error('[JewelryMasked] merged draw borrows other original source scope or zero padding');
		}

		ranges.push({
			start: group.start,
			count,
			materialIndex,
			vertexStart: first,
			vertexCount,
			proof: {
				...proof,
				sourceToGeometry: [...proof.sourceToGeometry],
				sourceCMToGeometry: [...proof.sourceCMToGeometry],
			},
		});
	});
	geometry.userData.ueJewelryMaskedProof = { drawRanges: ranges };
}
