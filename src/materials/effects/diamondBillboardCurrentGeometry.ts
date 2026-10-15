import type { BufferGeometry, Matrix4 } from 'three';
import {
	restoreCurrentStaticGeometry,
	transformCurrentStaticGeometry,
} from '../surface/intStaticMeshCurrentGeometry.js';

export const DIAMOND_BILLBOARD_CURRENT_ATTRIBUTES = [
	'diamondNativeTangent',
	'diamondNativeNormal',
	'diamondUV1',
	'diamondUV23',
	'diamondBillboardSize',
	'diamondLocalCM',
];

const streams = [
	['_diamond_native_tangent', 'diamondNativeTangent', 4],
	['_diamond_native_normal', 'diamondNativeNormal', 3],
	['_diamond_native_uv1', 'diamondUV1', 2],
	['_diamond_native_uv23', 'diamondUV23', 4],
	['_diamond_billboard_size', 'diamondBillboardSize', 1],
	['_diamond_native_local_cm', 'diamondLocalCM', 3],
] as const;

export function restoreDiamondBillboardCurrentGeometry(geometry: BufferGeometry): void {
	restoreCurrentStaticGeometry(geometry, streams);
	geometry.userData.diamondBillboardCurrentNativeFrame = true;
}

export function transformDiamondBillboardCurrentGeometry(geometry: BufferGeometry, matrix: Matrix4): void {
	if (!geometry.userData.diamondBillboardCurrentNativeFrame) return;

	transformCurrentStaticGeometry(geometry, matrix, DIAMOND_BILLBOARD_CURRENT_ATTRIBUTES);

	const size = geometry.getAttribute('diamondBillboardSize');
	const e = matrix.elements;
	const scale = Math.max(...[0, 1, 2].map((i) => Math.hypot(e[i * 4]!, e[i * 4 + 1]!, e[i * 4 + 2]!)));
	for (let i = 0; i < size.count; i++) size.setX(i, size.getX(i) * scale);

	size.needsUpdate = true;
}
