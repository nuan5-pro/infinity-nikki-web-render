import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
	assertJewelryMaskedBoundsLWC,
	jewelryMaskedComponentWorldBounds,
	jewelryMaskedTileOffsetRows,
	type JewelryMaskedBoundsFrame,
	type JewelryMaskedComponentBounds,
} from '../../src/materials/jewel/jewelryMaskedBounds.js';

// Exact current-provider R01 asset ExtendedBounds, not a group bounding box.
const bounds = (): JewelryMaskedComponentBounds => ({
	kind: 'whole-static-mesh-extended-bounds',
	sourceModelSha256: 'fc2769ff6afc137eb8087c1dfc6a057dfd7807ae43b03f20f713241181735773',
	captureSha256: '1'.repeat(64),
	originCM: [-6.3128509521484375, -39.55637741088867, 174.358306884765625],
	extentCM: [85.34664154052734, 44.11665725708008, 123.731719970703125],
});

const frame = (): JewelryMaskedBoundsFrame => ({
	sourceModelSha256: bounds().sourceModelSha256,
	boundsCaptureSha256: bounds().captureSha256,
	frameProofSha256: '2'.repeat(64),
	beforeBake: true,
	sourceToGeometry: new Matrix4(),
	editorWorldToSourceWorldCM: new Matrix4(),
	objectWorld: new Matrix4(),
});

describe('Masked whole component bounds frame mechanics, not runtime proof admission', () => {
	it('transports the captured asset origin through beforeBake, object and negative/nonuniform instance frames', () => {
		const input = frame();
		input.sourceToGeometry.makeTranslation(17, -13, 2);
		input.objectWorld.makeRotationZ(0.31).setPosition(4, 9, -11);
		input.instanceLocal = new Matrix4().makeScale(-2, 3, 0.5).setPosition(7, -5, 19);
		input.editorWorldToSourceWorldCM.makeScale(100, 100, 100);

		const result = jewelryMaskedComponentWorldBounds(bounds(), input);
		const expected = new Vector3(...bounds().originCM)
			.applyMatrix4(input.sourceToGeometry)
			.applyMatrix4(input.instanceLocal)
			.applyMatrix4(input.objectWorld)
			.applyMatrix4(input.editorWorldToSourceWorldCM);
		for (let axis = 0; axis < 3; axis++)
			expect(result.originCM[axis]).toBeCloseTo(expected.getComponent(axis), 9);

		expect(result.originCM).not.toEqual(new Vector3().applyMatrix4(input.objectWorld).toArray());

		const corners = [];
		for (const x of [-1, 1])
			for (const y of [-1, 1])
				for (const z of [-1, 1]) {
					const b = bounds();
					corners.push(
						new Vector3(b.originCM[0] + x * b.extentCM[0], b.originCM[1] + y * b.extentCM[1], b.originCM[2] + z * b.extentCM[2]).applyMatrix4(result.sourceLocalToWorldCM),
					);
				}

		for (let axis = 0; axis < 3; axis++) {
			const coordinates = corners.map((point) => point.getComponent(axis));
			expect(result.extentCM[axis]).toBeCloseTo((Math.max(...coordinates) - Math.min(...coordinates)) / 2, 9);
		}
	});

	it('rejects cross-source/capture, projective/singular mappings and incomplete beforeBake transport', () => {
		expect(() =>
			jewelryMaskedComponentWorldBounds(bounds(), {
				...frame(),
				boundsCaptureSha256: '3'.repeat(64),
			}),
		).toThrow();
		expect(() => jewelryMaskedComponentWorldBounds(bounds(), { ...frame(), sourceModelSha256: '4'.repeat(64) })).toThrow();
		expect(() =>
			jewelryMaskedComponentWorldBounds(bounds(), {
				...frame(),
				sourceToGeometry: new Matrix4().makeScale(0, 1, 1),
			}),
		).toThrow();

		const projective = new Matrix4();
		projective.elements[3] = 0.1;
		expect(() => jewelryMaskedComponentWorldBounds(bounds(), { ...frame(), sourceToGeometry: projective })).toThrow();
	});

	it('requires exact supplied high/low rows instead of silently using an actor origin or default tile', () => {
		expect(() => assertJewelryMaskedBoundsLWC([2097152 + 12, -9, 7], [1, 0, 0], [12, -9, 7])).not.toThrow();
		expect(() => assertJewelryMaskedBoundsLWC([2097152 + 12, -9, 7], [0, 0, 0], [12, -9, 7])).toThrow();
		expect(() => assertJewelryMaskedBoundsLWC([0.1, 0, 0], [0, 0, 0], [0.1, 0, 0])).toThrow();
		expect(() => assertJewelryMaskedBoundsLWC([0.1, 0, 0], [0, 0, 0], [Math.fround(0.1), 0, 0])).not.toThrow();
	});

	it('matches centred-tile tie direction and final f32 casts without changing POSITION/ULP guards', () => {
		expect(jewelryMaskedTileOffsetRows([1048576, -1048576, -1048576 - 0.125])).toEqual({
			tile: [1, 0, -1],
			offsetCM: [-1048576, -1048576, 1048575.875],
		});

		const rows = jewelryMaskedTileOffsetRows([0.1, -0, 2097152 + 0.1]);
		expect(rows.tile).toEqual([0, 0, 1]);
		expect(Object.is(rows.offsetCM[1], -0)).toBe(true);
		expect(() =>
			assertJewelryMaskedBoundsLWC([0.1, -0, 2097152 + 0.1], rows.tile, [
				Math.fround(0.1) + 2 ** -27,
				-0,
				rows.offsetCM[2],
			]),
		).toThrow();
		expect(() => jewelryMaskedTileOffsetRows([(2 ** 24 + 1) * 2097152, 0, 0])).toThrow();
		for (const bad of [NaN, Infinity, -Infinity])
			expect(() => jewelryMaskedTileOffsetRows([bad, 0, 0])).toThrow();

		expect(jewelryMaskedTileOffsetRows([1048576 - 0.01, 1048576 + 0.01, -1048576 + 0.01]).tile).toEqual([0, 1, 0]);
	});
});
