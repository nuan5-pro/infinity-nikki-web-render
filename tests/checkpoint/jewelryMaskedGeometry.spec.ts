import { BufferAttribute, BufferGeometry, IntType, Matrix4, MeshBasicMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import {
	mergeJewelryMaskedGeometry,
	restoreJewelryMaskedGeometry,
	transformJewelryMaskedGeometry,
	type JewelryMaskedGeometryProof,
} from '../../src/materials/jewel/jewelryMaskedGeometry.js';
import type { JewelryMaskedSourceContract } from '../../src/materials/jewel/jewelryMaskedShader.js';
import {
	jewelryMaskedLocalVertexShader,
	jewelryMaskedPixelShader,
	jewelryMaskedPreshader,
	type MaskedVec4,
} from '../../src/materials/jewel/jewelryMaskedSource.js';

// Mechanical adversarial fixtures: these hashes are not runtime/source admission evidence.
function contract(): JewelryMaskedSourceContract {
	const materialCB = Array.from({ length: 40 }, (): MaskedVec4 => [0, 0, 0, 0]);
	materialCB[28]![2] = Math.fround(-0.01);
	materialCB[29]![0] = Math.fround(-0.01);
	return {
		version: 1,
		contract: 'jewelry-v2-masked-de3c-local430-static-v1',
		pixelShader: jewelryMaskedPixelShader,
		vertexShader: jewelryMaskedLocalVertexShader,
		opacityShader: 'cfcd63ed610888ccf8acbba69d9115e7de7f9d3e',
		preshaderContract: jewelryMaskedPreshader,
		materialLayoutHash: 56953856,
		sourceContractSha256: '1'.repeat(64),
		geometryCaptureSha256: '2'.repeat(64),
		runtimeProofSha256: '3'.repeat(64),
		sourceModelSha256: '4'.repeat(64),
		previewFrameSha256: '8'.repeat(64),
		componentBoundsCaptureSha256: '9'.repeat(64),
		nativeTextureBindings: {
			N: '/Game/Test/N.N',
			N1: '/Game/Test/N1.N1',
			O1: '/Game/Test/O1.O1',
			O: '/Game/Test/O.O',
			T: '/Game/Test/T.T',
			D: '/Game/Test/D.D',
			D1: '/Game/Test/D1.D1',
			C: '/Game/Test/C.C',
			S: '/Game/Test/S.S',
		},
		materialCB,
		domain: {
			kind: 'editor-linked-mpc-tod-defaults',
			collectionStateId: '73C1D5ED-4B7AE2FA-DA3C9D83-4F8F468D',
			collectionCaptureSha256: '5'.repeat(64),
			viewDefaultsSourceSha256: '6'.repeat(64),
			aaMethod: 0,
			ready: 0,
			globalAttributeFactor: 1,
			swapLightFactor: 1,
			materialTextureMipBias: 0,
			normalOverride: [0, 0, 0, 1],
			implicitNoisePackageSha256:
				'a1fd94076f62af28f8f986ada8239646039a0a4e3356bc4b66483dc10ced798a',
			clock: 'editor-monotonic-seconds-not-live-UE',
			primitivePositionDomain: 'source-defined-tile-offset-preview-not-live-CVar',
		},
	};
}

function fixture(id = 1) {
	const source = contract();
	const geometry = new BufferGeometry();
	const material = new MeshBasicMaterial();
	geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
	geometry.setIndex([0, 1, 2]);
	geometry.setAttribute(
		'_jewel_masked_packed_basis',
		new BufferAttribute(new Uint32Array([0xff80807f, 0x7f7f8080, 0xff80807f, 0x7f7f8080, 0xff80807f, 0x7f7f8080]), 2),
	);
	geometry.setAttribute('_jewel_masked_local_cm', new BufferAttribute(new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]), 3));
	geometry.setAttribute('_jewel_masked_source_index', new BufferAttribute(new Uint32Array([6, 7, 8]), 1));
	geometry.setAttribute('_jewel_masked_proof_index', new BufferAttribute(new Uint32Array([id, id, id]), 1));

	const proof: JewelryMaskedGeometryProof = {
		contract: source.contract,
		sourceContractSha256: source.sourceContractSha256,
		runtimeProofSha256: source.runtimeProofSha256,
		sourceModelSha256: source.sourceModelSha256,
		geometryCaptureSha256: source.geometryCaptureSha256,
		pixelShader: source.pixelShader,
		vertexShader: source.vertexShader,
		proofIndex: id,
		proofScope: 'original-static-section-before-bake',
		sourceMaterialSlot: 1,
		sourceMeshIndex: 0,
		sourcePrimitiveIndex: 1,
		sourceVertexCount: 2278,
		sourceIDCount: 3,
		verifiedVertexCount: 3,
		positionMatched: true,
		uvMatched: true,
		packedBasisMatched: true,
		localCMMatched: true,
		beforeBake: true,
		runtimeAdmitted: true,
		mismatches: 0,
		sourceToGeometry: [1, 0, 0, 0, 1, 0, 0, 0, 1],
		sourceCMToGeometry: new Matrix4().makeScale(0.01, 0.01, 0.01).toArray(),
		compression: {
			contract: 'jewelry-masked-static-typed-lossless-v1',
			hashSpace: 'source-before-optimization',
			decodedVertexCount: 3,
			proofIndexComponentType: 5125,
			sourceIndexComponentType: 5125,
			packedBasisComponentType: 5125,
			localCMQuantizationBits: 0,
			retainedTupleMismatches: 0,
			orientedAssociationMismatches: 0,
		},
	};

	material.userData.UEJewelryMaskedProofs = { [id]: proof };
	return { geometry, material, source, proof };
}

describe('Masked typed restore/frame/merge mechanics, not producer admission', () => {
	it('renames exact large uint32 streams without float conversion and uses integer GPU attributes', () => {
		const f = fixture();
		restoreJewelryMaskedGeometry(f.geometry, f.material, f.source);
		expect(f.geometry.getAttribute('jewelryNativePackedBasis').array).toBeInstanceOf(Uint32Array);
		expect(f.geometry.getAttribute('jewelryNativePackedBasis').getX(0)).toBe(0xff80807f);
		expect((f.geometry.getAttribute('jewelryNativePackedBasis') as BufferAttribute).gpuType).toBe(IntType);
		expect(f.geometry.hasAttribute('_jewel_masked_packed_basis')).toBe(false);
	});

	it('rejects source-only runtime=false and malformed typed/compression controls before mutating geometry', () => {
		for (const change of [
			(f: ReturnType<typeof fixture>) => {
				Object.assign(f.proof, { runtimeAdmitted: false });
			},
			(f: ReturnType<typeof fixture>) => {
				f.proof.runtimeProofSha256 = '9'.repeat(64);
			},
			(f: ReturnType<typeof fixture>) => {
				Object.assign(f.proof.compression, { localCMQuantizationBits: 16 });
			},
			(f: ReturnType<typeof fixture>) => {
				f.geometry.setAttribute('_jewel_masked_source_index', new BufferAttribute(new Float32Array([6, 7, 8]), 1));
			},
			(f: ReturnType<typeof fixture>) => {
				f.geometry.getAttribute('_jewel_masked_proof_index').setX(2, 2);
			},
			(f: ReturnType<typeof fixture>) => {
				f.geometry.getAttribute('_jewel_masked_source_index').setX(2, 2278);
			},
		]) {
			const f = fixture();
			change(f);
			expect(() => restoreJewelryMaskedGeometry(f.geometry, f.material, f.source)).toThrow();
			expect(f.geometry.hasAttribute('jewelryNativePackedBasis')).toBe(false);
			expect(f.geometry.hasAttribute('_jewel_masked_packed_basis')).toBe(true);
		}
	});

	it('tracks full CM affine through mirrored nonuniform bake without modifying raw controls', () => {
		const f = fixture();
		restoreJewelryMaskedGeometry(f.geometry, f.material, f.source);

		const packed = Array.from(f.geometry.getAttribute('jewelryNativePackedBasis').array);
		const matrix = new Matrix4().makeScale(-2, 3, 0.5).setPosition(7, -11, 19);
		transformJewelryMaskedGeometry(f.geometry, matrix);

		const proof = f.geometry.userData.ueJewelryMaskedProof as JewelryMaskedGeometryProof;
		expect(proof.sourceCMToGeometry).toEqual(
			matrix
				.clone()
				.multiply(new Matrix4().makeScale(0.01, 0.01, 0.01))
				.toArray(),
		);
		expect(proof.sourceToGeometry).toEqual([-1, 0, 0, 0, 1, 0, 0, 0, 1]);
		expect(Array.from(f.geometry.getAttribute('jewelryNativePackedBasis').array)).toEqual(packed);
		expect(() => transformJewelryMaskedGeometry(f.geometry, new Matrix4().makeScale(0, 1, 1))).toThrow();
	});

	it('merges scoped draws with explicit vertex ranges and rejects cross-scope indices', () => {
		const a = fixture(1);
		const b = fixture(2);
		restoreJewelryMaskedGeometry(a.geometry, a.material, a.source);
		restoreJewelryMaskedGeometry(b.geometry, b.material, b.source);

		const merged = mergeGeometries([a.geometry, b.geometry], true)!;
		mergeJewelryMaskedGeometry(merged, [a.geometry, b.geometry]);
		expect(
			merged.userData.ueJewelryMaskedProof.drawRanges.map(
				(range: { vertexStart: number; vertexCount: number }) => [
					range.vertexStart,
					range.vertexCount,
				],
			),
		).toEqual([
			[0, 3],
			[3, 3],
		]);
		expect((merged.getAttribute('jewelryNativeSourceIndex') as BufferAttribute).gpuType).toBe(IntType);
		merged.getIndex()!.setX(3, 0);
		expect(() => mergeJewelryMaskedGeometry(merged, [a.geometry, b.geometry])).toThrow('other original source scope');
	});
});
