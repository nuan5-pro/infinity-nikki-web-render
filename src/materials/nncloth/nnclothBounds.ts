import { Matrix4, Vector3 } from 'three';

export interface NNClothSourceBounds {
	origin: [number, number, number]
	extent: [number, number, number]
	radius: number
	source: 'UStaticMesh.ExtendedBounds-native-cm'
}

export interface NNClothBoundsFrame {
	bounds: NNClothSourceBounds
	nativeToGeometry: number[]
	boundsScale: 1
}

export function assertNNClothBoundsFrame(frame: NNClothBoundsFrame) {
	if (
		!frame ||
		frame.bounds?.source !== 'UStaticMesh.ExtendedBounds-native-cm' ||
		frame.boundsScale !== 1 ||
		frame.bounds.origin.length !== 3 ||
		frame.bounds.extent.length !== 3 ||
		![
			...frame.bounds.origin,
			...frame.bounds.extent,
			frame.bounds.radius,
			...frame.nativeToGeometry,
		].every(Number.isFinite) ||
		frame.bounds.extent.some((value) => value < 0) ||
		frame.bounds.radius <= 0 ||
		frame.nativeToGeometry.length !== 16 ||
		new Matrix4().fromArray(frame.nativeToGeometry).determinant() === 0
	) throw new Error('[NNCloth] original ExtendedBounds/native-to-preview frame missing');
}

/** The copied UE BoxSphereBounds::TransformBy algorithm. UE matrix rows are
 * Three matrix columns after the row-vector/column-vector convention change.
 * Keep the full composed transform: repeatedly reboxing rotated bounds is not
 * equivalent to transforming the original component bounds once.
 */
export function transformNNClothBounds(bounds: NNClothSourceBounds, matrix: Matrix4, boundsScale = 1) {
	assertNNClothBoundsFrame({ bounds, nativeToGeometry: matrix.toArray(), boundsScale: 1 });
	if (!Number.isFinite(boundsScale) || boundsScale <= 0) throw new Error('[NNCloth] invalid bounds scale');

	const m = matrix.elements;
	const e = bounds.extent;
	const extent = new Vector3(
		Math.abs(m[0]! * e[0]) + Math.abs(m[4]! * e[1]) + Math.abs(m[8]! * e[2]),
		Math.abs(m[1]! * e[0]) + Math.abs(m[5]! * e[1]) + Math.abs(m[9]! * e[2]),
		Math.abs(m[2]! * e[0]) + Math.abs(m[6]! * e[1]) + Math.abs(m[10]! * e[2]),
	);
	const axisSquared = [0, 1, 2].map((row) => m[row]! ** 2 + m[row + 4]! ** 2 + m[row + 8]! ** 2);
	const radius = Math.min(Math.sqrt(Math.max(...axisSquared)) * bounds.radius, extent.length()) * boundsScale;
	return {
		origin: new Vector3(...bounds.origin).applyMatrix4(matrix),
		extent: extent.multiplyScalar(boundsScale),
		radius,
	};
}
