import { Matrix3, Vector3, type BufferGeometry, type Matrix4 } from 'three';

export const INT_STATIC_MESH_CURRENT_ATTRIBUTES = [
	'intStaticNativeTangent',
	'intStaticNativeNormal',
	'intStaticUV1',
	'intStaticUV23',
];

const streams = [
	['_int_static_native_tangent', 'intStaticNativeTangent', 4],
	['_int_static_native_normal', 'intStaticNativeNormal', 3],
	['_int_static_native_uv1', 'intStaticUV1', 2],
	['_int_static_native_uv23', 'intStaticUV23', 4],
] as const;

export function restoreIntStaticMeshCurrentGeometry(geometry: BufferGeometry): void {
	restoreCurrentStaticGeometry(geometry, streams);
	geometry.userData.intStaticMeshCurrentNativeFrame = true;
}

export function restoreCurrentStaticGeometry(geometry: BufferGeometry, streams: readonly (readonly [string, string, number])[]): void {
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
		) throw new Error(`[IntStaticMesh] actual ${source} native VF stream required`);
	}

	for (const [source, target] of streams) {
		geometry.setAttribute(target, geometry.getAttribute(source));
		geometry.deleteAttribute(source);
	}
}

export function transformIntStaticMeshCurrentGeometry(geometry: BufferGeometry, matrix: Matrix4): void {
	if (!geometry.userData.intStaticMeshCurrentNativeFrame) return;

	transformCurrentStaticGeometry(geometry, matrix, INT_STATIC_MESH_CURRENT_ATTRIBUTES);
}

export function transformCurrentStaticGeometry(geometry: BufferGeometry, matrix: Matrix4, attributes: readonly string[]): void {
	const linear = new Matrix3().setFromMatrix4(matrix);
	const columns = [0, 1, 2].map((i) => new Vector3().fromArray(linear.elements, i * 3));
	if (!matrix.elements.every(Number.isFinite) || columns.some((c) => c.lengthSq() <= 0)) throw new Error('[IntStaticMesh] nonsingular source node required');

	columns.forEach((c) => c.normalize());
	if (columns.some((c, i) => Math.abs(c.dot(columns[(i + 1) % 3]!)) > 1e-5)) throw new Error('[IntStaticMesh] source node shear unsupported');

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

	const sign = Math.sign(linear.determinant());
	const vector = new Vector3();
	for (const name of attributes.slice(0, 2)) {
		const a = geometry.getAttribute(name);
		for (let i = 0; i < a.count; i++) {
			vector.fromBufferAttribute(a, i).applyMatrix3(linear);
			a.setXYZ(i, vector.x, vector.y, vector.z);
			if (name === attributes[0]) a.setW(i, a.getW(i) * sign);
		}

		a.needsUpdate = true;
	}
}
