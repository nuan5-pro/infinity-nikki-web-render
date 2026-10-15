import { Vector3, type BufferGeometry, type Matrix4 } from 'three';

export const SPHERE_BILLBOARD_CURRENT_ATTRIBUTES = [
	'sphereUV1',
	'sphereNativeColor',
	'sphereBillboardSize',
];

const streams = [
	['_sphere_native_uv1', 'sphereUV1', 2],
	['_sphere_native_color', 'sphereNativeColor', 4],
	['_sphere_billboard_size', 'sphereBillboardSize', 1],
] as const;

export function restoreSphereBillboardCurrentGeometry(geometry: BufferGeometry): void {
	const count = geometry.getAttribute('position')?.count;
	for (const [source, target, width] of streams) {
		const a = geometry.getAttribute(source);
		if (!a || a.count !== count || a.itemSize !== width) throw new Error(`[SphereBillboard] ${source} source stream required`);

		geometry.setAttribute(target, a);
		geometry.deleteAttribute(source);
	}

	geometry.userData.sphereBillboardCurrentNativeFrame = true;
}

export function transformSphereBillboardCurrentGeometry(geometry: BufferGeometry, matrix: Matrix4): void {
	if (!geometry.userData.sphereBillboardCurrentNativeFrame) return;

	const scale = Math.max(...[0, 1, 2].map((i) => new Vector3().fromArray(matrix.elements, i * 4).length()));
	const sizes = geometry.getAttribute('sphereBillboardSize');
	for (let i = 0; i < sizes.count; i++) sizes.setX(i, sizes.getX(i) * scale);

	sizes.needsUpdate = true;
}
