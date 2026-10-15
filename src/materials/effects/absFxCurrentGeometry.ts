import { Matrix3, Vector3, type BufferGeometry, type Matrix4 } from 'three';

export const ABS_FX_CURRENT_ATTRIBUTES = [
	'absFxNativeNormal',
	'absFxUV1',
	'absFxUV2',
	'absFxPrimitiveBounds',
	'absFxDissolvePivot',
];

const streams = [
	['_abs_fx_native_normal', 'absFxNativeNormal', 3],
	['_abs_fx_native_uv1', 'absFxUV1', 2],
	['_abs_fx_native_uv2', 'absFxUV2', 2],
	['_abs_fx_native_bounds', 'absFxPrimitiveBounds', 4],
	['_abs_fx_native_pivot', 'absFxDissolvePivot', 3],
] as const;

export function restoreABSFXCurrentGeometry(geometry: BufferGeometry): void {
	const count = geometry.getAttribute('position')?.count;
	for (const [source, target, width] of streams) {
		const a = geometry.getAttribute(source);
		if (
			!count ||
			!a ||
			a.count !== count ||
			a.itemSize !== width ||
			a.normalized ||
			!a.array.every(Number.isFinite) ||
			geometry.hasAttribute(target)
		) throw new Error(`[ABSFX] actual ${source} native VF stream required`);
	}

	for (const [source, target] of streams) {
		geometry.setAttribute(target, geometry.getAttribute(source));
		geometry.deleteAttribute(source);
	}

	geometry.userData.absFxCurrentNativeFrame = true;
}

export function transformABSFXCurrentGeometry(geometry: BufferGeometry, matrix: Matrix4): void {
	if (!geometry.userData.absFxCurrentNativeFrame) return;

	const linear = new Matrix3().setFromMatrix4(matrix);
	const columns = [0, 1, 2].map((i) => new Vector3().fromArray(linear.elements, i * 3));
	if (!matrix.elements.every(Number.isFinite) || columns.some((c) => c.lengthSq() <= 0)) throw new Error('[ABSFX] nonsingular source node required');

	const scale = Math.max(...columns.map((c) => c.length()));
	columns.forEach((c) => c.normalize());
	if (columns.some((c, i) => Math.abs(c.dot(columns[(i + 1) % 3]!)) > 1e-5)) throw new Error('[ABSFX] source node shear unsupported');

	linear.set(
		columns[0]!.x,
		columns[1]!.x,
		columns[2]!.x,
		columns[0]!.y,
		columns[1]!.y,
		columns[2]!.y,
		columns[0]!.z,
		columns[1]!.z,
		columns[2]!.z,
	);

	const vector = new Vector3();
	for (const name of ['absFxNativeNormal', 'absFxPrimitiveBounds', 'absFxDissolvePivot']) {
		const a = geometry.getAttribute(name);
		for (let i = 0; i < a.count; i++) {
			vector.fromBufferAttribute(a, i);
			if (name === 'absFxNativeNormal') vector.applyMatrix3(linear);
			else vector.applyMatrix4(matrix);

			a.setXYZ(i, vector.x, vector.y, vector.z);
			if (name === 'absFxPrimitiveBounds') a.setW(i, a.getW(i) * scale);
		}

		a.needsUpdate = true;
	}
}
