import type { BufferGeometry, Matrix4 } from 'three';
import {
	restoreCurrentStaticGeometry,
	transformCurrentStaticGeometry,
} from '../surface/intStaticMeshCurrentGeometry.js';

export const ANIMAL_MASKED_CURRENT_ATTRIBUTES = [
	'animalMaskedNativeTangent',
	'animalMaskedNativeNormal',
	'animalMaskedUV1',
	'animalMaskedUV23',
];

const streams = [
	['_animal_masked_native_tangent', 'animalMaskedNativeTangent', 4],
	['_animal_masked_native_normal', 'animalMaskedNativeNormal', 3],
	['_animal_masked_native_uv1', 'animalMaskedUV1', 2],
	['_animal_masked_native_uv23', 'animalMaskedUV23', 4],
] as const;

export function restoreAnimalMaskedCurrentGeometry(geometry: BufferGeometry): void {
	restoreCurrentStaticGeometry(geometry, streams);
	geometry.userData.animalMaskedCurrentNativeFrame = true;
}

export function transformAnimalMaskedCurrentGeometry(geometry: BufferGeometry, matrix: Matrix4): void {
	if (!geometry.userData.animalMaskedCurrentNativeFrame) return;

	transformCurrentStaticGeometry(geometry, matrix, ANIMAL_MASKED_CURRENT_ATTRIBUTES);
}
