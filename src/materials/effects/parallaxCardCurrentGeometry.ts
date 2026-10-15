import { Matrix3, Vector3, type BufferGeometry, type Matrix4 } from 'three';
import type { FurnitureParallaxCard } from './parallaxCardShader.js';

export const CURRENT_PARALLAX_CARD_ATTRIBUTES = ['cardNativeTangent', 'cardNativeNormal'] as const;

export function restoreCurrentParallaxCardGeometry(geometry: BufferGeometry, profile: FurnitureParallaxCard): void {
	if (profile.version !== 3 || profile.geometry !== 'parallax-card-current-native-frame-v3') throw new Error('[ParallaxCard] current native frame profile required');

	const count = geometry.getAttribute('position')?.count;
	for (const [source, target, size] of [
		['_card_native_tangent', 'cardNativeTangent', 4],
		['_card_native_normal', 'cardNativeNormal', 3],
	] as const) {
		const a = geometry.getAttribute(source);
		if (
			!count ||
			!a ||
			a.count !== count ||
			a.itemSize !== size ||
			a.normalized ||
			!a.array.every(Number.isFinite) ||
			geometry.hasAttribute(target)
		) throw new Error(`[ParallaxCard] actual ${source} typed source stream missing`);

		geometry.setAttribute(target, a);
		geometry.deleteAttribute(source);
	}

	geometry.userData.currentParallaxCard = true;
}

/** Native basis magnitude survives source-node and item baking. Translation and
 * column scale affect positions, not this VF frame; a mirror flips handedness. */
export function transformCurrentParallaxCardGeometry(geometry: BufferGeometry, matrix: Matrix4): void {
	if (!geometry.userData.currentParallaxCard) return;
	if (!matrix.elements.every(Number.isFinite)) throw new Error('[ParallaxCard] finite source-node transform required');

	const linear = new Matrix3().setFromMatrix4(matrix);
	const columns = [0, 1, 2].map((i) => new Vector3().fromArray(linear.elements, i * 3));
	if (columns.some((c) => c.lengthSq() <= 0)) throw new Error('[ParallaxCard] singular source-node frame');

	columns.forEach((c) => c.normalize());
	if (columns.some((c, i) => Math.abs(c.dot(columns[(i + 1) % 3]!)) > 1e-5)) throw new Error('[ParallaxCard] sheared source-node frame unsupported');

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

	const parity = Math.sign(linear.determinant());
	const vector = new Vector3();
	for (const name of CURRENT_PARALLAX_CARD_ATTRIBUTES) {
		const a = geometry.getAttribute(name);
		if (!a) throw new Error(`[ParallaxCard] native ${name} lost during bake`);

		for (let i = 0; i < a.count; i++) {
			vector.fromBufferAttribute(a, i).applyMatrix3(linear);
			a.setXYZ(i, vector.x, vector.y, vector.z);
			if (name === 'cardNativeTangent') a.setW(i, a.getW(i) * parity);
		}

		a.needsUpdate = true;
	}
}
