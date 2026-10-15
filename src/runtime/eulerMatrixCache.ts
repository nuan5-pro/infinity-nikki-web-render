import { Matrix4, type Euler, type EulerOrder } from 'three';

const cacheKey = Symbol.for('building-momo.euler-matrix-cache-v1');
const orders = new Set<EulerOrder>(['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY']);

type RotationFunction = Matrix4['makeRotationFromEuler'] & { [cacheKey]?: true };

/** Three's material refresh repeatedly computes the same environment rotation.
 * Cache the native result, not another rotation formula. Checking the target
 * elements also catches writes made by other Matrix4 methods or callers. */
export function initEulerMatrixCache() {
	const original = Matrix4.prototype.makeRotationFromEuler as RotationFunction;
	if (original[cacheKey]) return;

	const cache = new WeakMap<
		Matrix4,
		{
			x: number;
			y: number;
			z: number;
			order: EulerOrder;
			elements: number[];
		}
	>();

	function cached<T extends Matrix4>(this: T, euler: Euler): T {
		const { x, y, z, order } = euler;
		const elements = this.elements;
		// Invalid inputs and immutable targets retain the native behavior.
		if (
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			!Number.isFinite(z) ||
			!orders.has(order) ||
			Object.isFrozen(elements)
		) {
			original.call(this, euler);
			return this;
		}

		const previous = cache.get(this);
		if (
			previous &&
			Object.is(previous.x, x) &&
			Object.is(previous.y, y) &&
			Object.is(previous.z, z) &&
			previous.order === order
		) {
			let unchanged = true;
			for (let i = 0; i < 16; i++) {
				if (Object.is(elements[i], previous.elements[i])) continue;
				unchanged = false;
				break;
			}

			if (unchanged) return this;
		}

		original.call(this, euler);
		cache.set(this, { x, y, z, order, elements: elements.slice() });
		return this;
	}

	Matrix4.prototype.makeRotationFromEuler = Object.assign(cached, { [cacheKey]: true as const });
}
