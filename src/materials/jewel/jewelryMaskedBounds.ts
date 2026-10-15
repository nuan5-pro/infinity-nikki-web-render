import { Matrix4, Vector3 } from 'three';
import type { MaskedVec3 } from './jewelryMaskedSource.js';

export interface JewelryMaskedComponentBounds {
	kind: 'whole-static-mesh-extended-bounds';
	sourceModelSha256: string;
	captureSha256: string;
	originCM: MaskedVec3;
	extentCM: MaskedVec3;
}

export interface JewelryMaskedBoundsFrame {
	sourceModelSha256: string;
	boundsCaptureSha256: string;
	frameProofSha256: string;
	beforeBake: true;
	/** Original native-local cm → decoded geometry local. Includes bake translation, not only the TBN 3x3. */
	sourceToGeometry: Matrix4;
	/** Actual viewer world → explicitly verified source-world cm frame. */
	editorWorldToSourceWorldCM: Matrix4;
	objectWorld: Matrix4;
	/** Required for an instanced draw; absence means a non-instanced object only. */
	instanceLocal?: Matrix4;
}

const sha = (value: string) => /^[a-f0-9]{64}$/.test(value);
const finite = (values: readonly number[]) => values.every(Number.isFinite);

const affine = (matrix: Matrix4) =>
	finite(matrix.elements) &&
	matrix.elements[3] === 0 &&
	matrix.elements[7] === 0 &&
	matrix.elements[11] === 0 &&
	matrix.elements[15] === 1 &&
	Number.isFinite(matrix.determinant()) &&
	matrix.determinant() !== 0;

/** X6 CalcBounds(GetExtendedBounds().TransformBy(LocalToWorld)): whole component, not isolated material triangles. */
export function jewelryMaskedComponentWorldBounds(bounds: JewelryMaskedComponentBounds, frame: JewelryMaskedBoundsFrame): {
	originCM: MaskedVec3;
	extentCM: MaskedVec3;
	sourceLocalToWorldCM: Matrix4;
} {
	if (
		bounds.kind !== 'whole-static-mesh-extended-bounds' ||
		![
			bounds.sourceModelSha256,
			bounds.captureSha256,
			frame.sourceModelSha256,
			frame.boundsCaptureSha256,
			frame.frameProofSha256,
		].every(sha) ||
		frame.beforeBake !== true ||
		bounds.sourceModelSha256 !== frame.sourceModelSha256 ||
		bounds.captureSha256 !== frame.boundsCaptureSha256 ||
		bounds.originCM.length !== 3 ||
		bounds.extentCM.length !== 3 ||
		!finite(bounds.originCM) ||
		!finite(bounds.extentCM) ||
		bounds.extentCM.some((value) => value < 0) ||
		![frame.sourceToGeometry, frame.editorWorldToSourceWorldCM, frame.objectWorld].every(affine) ||
		(frame.instanceLocal && !affine(frame.instanceLocal))
	) throw new Error('[JewelryMasked] unproved whole-component bounds/affine beforeBake frame');

	const matrix = frame.editorWorldToSourceWorldCM.clone().multiply(frame.objectWorld);
	if (frame.instanceLocal) matrix.multiply(frame.instanceLocal);
	matrix.multiply(frame.sourceToGeometry);
	if (!affine(matrix)) throw new Error('[JewelryMasked] component source frame overflow/singularity');

	const origin = new Vector3(...bounds.originCM).applyMatrix4(matrix);
	const e = matrix.elements;
	const b = bounds.extentCM;
	// TransformBy propagates the whole asset AABB, including negative/nonuniform
	// instance scales; node origin and per-material recomputed bounds are unrelated.
	const extent: MaskedVec3 = [
		Math.abs(e[0]!) * b[0] + Math.abs(e[4]!) * b[1] + Math.abs(e[8]!) * b[2],
		Math.abs(e[1]!) * b[0] + Math.abs(e[5]!) * b[1] + Math.abs(e[9]!) * b[2],
		Math.abs(e[2]!) * b[0] + Math.abs(e[6]!) * b[1] + Math.abs(e[10]!) * b[2],
	];

	if (!finite(origin.toArray()) || !finite(extent)) throw new Error('[JewelryMasked] transformed component bounds overflow');

	return {
		originCM: origin.toArray() as MaskedVec3,
		extentCM: extent,
		sourceLocalToWorldCM: matrix,
	};
}

/** Current X6 FLargeWorldRenderPosition<double> arithmetic, then default GetTile/GetOffset<float> storage.
 * This computes the explicitly selected tile-offset source domain, not live CVar/primitive state. */
export function jewelryMaskedTileOffsetRows(originCM: MaskedVec3): {
	tile: MaskedVec3;
	offsetCM: MaskedVec3;
} {
	if (originCM.length !== 3 || !finite(originCM)) throw new Error('[JewelryMasked] nonfinite source absolute position');

	const tile = originCM.map((value) => Math.floor(value / 2097152 + 0.5));
	if (tile.some((value) => !Number.isSafeInteger(value) || Math.fround(value) !== value)) throw new Error('[JewelryMasked] source tile outside exact-f32 preview domain');

	const internalOffset = originCM.map((value, axis) => value - tile[axis]! * 2097152);
	if (
		originCM.some((value, axis) => !(Math.abs(tile[axis]! * 2097152 + internalOffset[axis]! - value) <= 2 ** -32))
	) throw new Error('[JewelryMasked] internal double tile/offset fails source Validate diagnostic condition');

	const offsetCM = internalOffset.map(Math.fround);
	if (!finite(offsetCM)) throw new Error('[JewelryMasked] source relative position overflow');

	return {
		tile: [Math.fround(tile[0]!), Math.fround(tile[1]!), Math.fround(tile[2]!)],
		offsetCM: [offsetCM[0]!, offsetCM[1]!, offsetCM[2]!],
	};
}

/** Verify explicitly supplied source rows, including the native final float cast.
 * The old exact-double reconstruction rule was conservative, not the native row-storage equation. */
export function assertJewelryMaskedBoundsLWC(originCM: MaskedVec3, tile: MaskedVec3, offsetCM: MaskedVec3): void {
	const expected = jewelryMaskedTileOffsetRows(originCM);
	if (
		![originCM, tile, offsetCM].every((values) => values.length === 3 && finite(values)) ||
		!tile.every(Number.isInteger) ||
		tile.some((value) => Math.fround(value) !== value) ||
		offsetCM.some((value) => Math.fround(value) !== value) ||
		tile.some((value, i) => !Object.is(value, expected.tile[i])) ||
		offsetCM.some((value, i) => !Object.is(value, expected.offsetCM[i]))
	) throw new Error('[JewelryMasked] component LWC rows require transformed whole bounds');
}
