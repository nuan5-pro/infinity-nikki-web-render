import { Float32BufferAttribute, Matrix3, Vector3, type BufferGeometry, type Matrix4 } from 'three';
import type { FurnitureCharacterJewel } from './characterJewelShader.js';

const streams = [
	['_character_native_tangent', 'characterNativeTangent', 4],
	['_character_native_normal', 'characterNativeNormal', 3],
	['_character_native_uv1', 'characterUV1', 2],
	['_character_native_uv2', 'characterUV2', 2],
	['_character_native_uv3', 'characterUV3', 2],
	['_character_native_local_cm', 'characterLocalCM', 3],
	['_character_native_origin', 'characterPrimitiveOrigin', 3],
	['_character_native_pivot', 'characterDissolvePivot', 3],
	['_character_native_radius', 'characterPrimitiveRadius', 1],
] as const;

export const CHARACTER_JEWEL_ATTRIBUTES = [
	'characterNativeTangent',
	'characterNativeNormal',
	'characterUV1',
	'characterUV23',
	'characterLocalCM',
	'characterPrimitiveBounds',
	'characterDissolvePivot',
];

export function restoreCharacterJewelGeometry(geometry: BufferGeometry, profile: FurnitureCharacterJewel): void {
	if (profile.version !== 1 || profile.family !== 'character-jewel-current') throw new Error('[CharacterJewel] actual current family required');

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
		) throw new Error(`[CharacterJewel] actual ${source} typed native VF stream missing`);
	}

	for (const [source, target] of streams) {
		geometry.setAttribute(target, geometry.getAttribute(source));
		geometry.deleteAttribute(source);
	}

	const uv2 = geometry.getAttribute('characterUV2');
	const uv3 = geometry.getAttribute('characterUV3');
	const origin = geometry.getAttribute('characterPrimitiveOrigin');
	const radius = geometry.getAttribute('characterPrimitiveRadius');
	const uv23 = new Float32Array(count! * 4);
	const bounds = new Float32Array(count! * 4);
	for (let i = 0; i < count!; i++) {
		uv23.set([uv2.getX(i), uv2.getY(i), uv3.getX(i), uv3.getY(i)], i * 4);
		bounds.set([origin.getX(i), origin.getY(i), origin.getZ(i), radius.getX(i)], i * 4);
	}

	geometry.setAttribute('characterUV23', new Float32BufferAttribute(uv23, 4));
	geometry.setAttribute('characterPrimitiveBounds', new Float32BufferAttribute(bounds, 4));
	for (const name of [
		'characterUV2',
		'characterUV3',
		'characterPrimitiveOrigin',
		'characterPrimitiveRadius',
	])
		geometry.deleteAttribute(name);

	geometry.userData.characterJewelNativeFrame = true;
}

export function transformCharacterJewelGeometry(geometry: BufferGeometry, matrix: Matrix4): void {
	if (!geometry.userData.characterJewelNativeFrame) return;

	const linear = new Matrix3().setFromMatrix4(matrix);
	const columns = [0, 1, 2].map((i) => new Vector3().fromArray(linear.elements, i * 3));
	if (!matrix.elements.every(Number.isFinite) || columns.some((c) => c.lengthSq() <= 0)) throw new Error('[CharacterJewel] finite nonsingular node transform required');

	columns.forEach((c) => c.normalize());
	if (columns.some((c, i) => Math.abs(c.dot(columns[(i + 1) % 3]!)) > 1e-5)) throw new Error('[CharacterJewel] source-node shear unsupported');

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
	for (const name of ['characterNativeTangent', 'characterNativeNormal']) {
		const a = geometry.getAttribute(name);
		if (!a) throw new Error('[CharacterJewel] native frame lost before bake');

		for (let i = 0; i < a.count; i++) {
			vector.fromBufferAttribute(a, i).applyMatrix3(linear);
			a.setXYZ(i, vector.x, vector.y, vector.z);
			if (name === 'characterNativeTangent') a.setW(i, a.getW(i) * sign);
		}

		a.needsUpdate = true;
	}

	for (const name of ['characterPrimitiveBounds', 'characterDissolvePivot']) {
		const a = geometry.getAttribute(name);
		for (let i = 0; i < a.count; i++) {
			vector.fromBufferAttribute(a, i).applyMatrix4(matrix);
			a.setXYZ(i, vector.x, vector.y, vector.z);
		}

		a.needsUpdate = true;
	}

	const radius = geometry.getAttribute('characterPrimitiveBounds');
	const e = matrix.elements;
	const scale = Math.max(...[0, 1, 2].map((i) => Math.hypot(e[i * 4]!, e[i * 4 + 1]!, e[i * 4 + 2]!)));
	for (let i = 0; i < radius.count; i++) radius.setW(i, radius.getW(i) * scale);

	radius.needsUpdate = true;
}
