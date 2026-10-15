import { describe, expect, it } from 'vitest';
import { assertNNClothReviewedGeometry } from '../../src/materials/nncloth/nnclothSourceGeometry.js';

const sources = [
	[
		'cf21b27749125766ff38ef43cb326c7ca5551650cf373be9946d69a394e7b0bc',
		'/Game/Assets/Buildin/Parts/Jewelry/PABJ0004/Material/M_PABJ0004_02.M_PABJ0004_02',
	],
	[
		'3d6add604fb2d3ac28a8955a40d32ae8b611d9c972c8eaaa6381fd5dfa3439a9',
		'/Game/Assets/Buildin/Parts/Jewelry/PABJ0004/Different/Material/M_PABJ0004_02_1.M_PABJ0004_02_1',
	],
] as const;

function proof(index: 0 | 1) {
	const [sourceIdentity, sourcePath] = sources[index];
	return {
		sourceModelSHA256: '86f4a78a8c1d1dfb0363610adc5fea291f01d2ea4b9badf7d49388ee9737d846',
		packageSHA256: '28ac568b2d847e89576ef32495b633e1f09c802c8fcd686a79789018083fb264',
		bounds: {
			source: 'UStaticMesh.ExtendedBounds-native-cm',
			origin: [3.9578094, -41.421417, 218.51549],
			extent: [275.8152, 170.4451, 220.85936],
			radius: 378.1394500732422,
		},
		sourceBinding: {
			version: 1,
			domain: 'ps4f9048-words34fed0-static-carrier-1',
			sourceIdentity,
			sourcePath,
			sourceMaterialIndex: 0,
			nativeMaterialSlot: 1,
			geometrySHA256: '200b6e5a3321a73a56877c5a89d8c571db66e8ab55f6c893360a2f5c20974e94',
		},
	};
}

describe('reviewed NN source geometry/material association', () => {
	it('joins each source identity independently with GLB index0 and native slot1', () => {
		for (const index of [0, 1] as const) {
			expect(() => assertNNClothReviewedGeometry(proof(index), sources[index][0])).not.toThrow();
			expect(() => assertNNClothReviewedGeometry(proof(index), sources[index === 0 ? 1 : 0][0])).toThrow(/identity/);
		}
	});

	it('rejects06 slot exchange, unknown source, missing proof, and forged geometry/frame', () => {
		const mutations = [
			(value: ReturnType<typeof proof>) => {
				value.sourceBinding.sourceMaterialIndex = 4;
			},
			(value: ReturnType<typeof proof>) => {
				value.sourceBinding.nativeMaterialSlot = 0;
			},
			(value: ReturnType<typeof proof>) => {
				value.sourceBinding.version = 2;
			},
			(value: ReturnType<typeof proof>) => {
				value.sourceBinding.geometrySHA256 = 'forged';
			},
			(value: ReturnType<typeof proof>) => {
				value.sourceBinding.sourcePath = sources[1][1];
			},
			(value: ReturnType<typeof proof>) => {
				value.packageSHA256 = 'forged';
			},
			(value: ReturnType<typeof proof>) => {
				value.sourceModelSHA256 = 'forged';
			},
			(value: ReturnType<typeof proof>) => {
				value.bounds.origin[0] = 0;
			},
		];

		for (const mutate of mutations) {
			const value = proof(0);
			mutate(value);
			expect(() => assertNNClothReviewedGeometry(value, sources[0][0])).toThrow();
		}

		expect(() => assertNNClothReviewedGeometry(undefined, sources[0][0])).toThrow();
		expect(() => assertNNClothReviewedGeometry({ reviewed: true }, sources[0][0])).toThrow();
	});
});
