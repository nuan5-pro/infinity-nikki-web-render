import type { BufferGeometry, Matrix4 } from 'three';
import {
	restoreCurrentStaticGeometry,
	transformCurrentStaticGeometry,
} from '../surface/intStaticMeshCurrentGeometry.js';

export const SCENE_JEWEL_CURRENT_ATTRIBUTES = [
	'sceneJewelNativeTangent',
	'sceneJewelNativeNormal',
	'sceneJewelUV1',
	'sceneJewelUV23',
];

const streams = [
	['_scene_jewel_native_tangent', 'sceneJewelNativeTangent', 4],
	['_scene_jewel_native_normal', 'sceneJewelNativeNormal', 3],
	['_scene_jewel_native_uv1', 'sceneJewelUV1', 2],
	['_scene_jewel_native_uv23', 'sceneJewelUV23', 4],
] as const;

export function restoreSceneJewelCurrentGeometry(geometry: BufferGeometry): void {
	restoreCurrentStaticGeometry(geometry, streams);
	geometry.userData.sceneJewelCurrentNativeFrame = true;
}

export function transformSceneJewelCurrentGeometry(geometry: BufferGeometry, matrix: Matrix4): void {
	if (geometry.userData.sceneJewelCurrentNativeFrame)
		transformCurrentStaticGeometry(geometry, matrix, SCENE_JEWEL_CURRENT_ATTRIBUTES);
}
