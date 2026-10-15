import { afterEach, describe, expect, it, vi } from 'vitest';
import { Euler, Matrix4, type EulerOrder } from 'three';
import { initEulerMatrixCache } from '../../src/runtime/eulerMatrixCache.js';

const original = Matrix4.prototype.makeRotationFromEuler;
afterEach(() => {
	vi.restoreAllMocks();
	Matrix4.prototype.makeRotationFromEuler = original;
});

describe('native Euler matrix cache', () => {
	it('reuses equal inputs and is idempotent across renderer/HMR initialization', () => {
		const native = vi.spyOn(Matrix4.prototype, 'makeRotationFromEuler');
		initEulerMatrixCache();

		const installed = Matrix4.prototype.makeRotationFromEuler;
		initEulerMatrixCache();
		expect(Matrix4.prototype.makeRotationFromEuler).toBe(installed);

		const matrix = new Matrix4();
		const euler = new Euler(1, 2, 3);
		expect(matrix.makeRotationFromEuler(euler)).toBe(matrix);
		matrix.makeRotationFromEuler(euler);
		matrix.makeRotationFromEuler(euler.clone());
		expect(native).toHaveBeenCalledOnce();
		euler.x = 4;
		matrix.makeRotationFromEuler(euler);
		expect(native).toHaveBeenCalledTimes(2);
	});

	it('matches native values for every order, target mutation, and signed zero', () => {
		initEulerMatrixCache();

		const matrix = new Matrix4();
		const orders: EulerOrder[] = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];
		for (const order of orders) {
			for (let i = 0; i < 100; i++) {
				const euler = new Euler(Math.sin(i) * 10, Math.cos(i * 0.37) * 10, Math.sin(i * 0.73) * 10, order);
				const reference = original.call(new Matrix4(), euler);
				matrix.makeRotationFromEuler(euler).makeRotationFromEuler(euler);
				expect(matrix.elements.every((value, index) => Object.is(value, reference.elements[index]))).toBe(true);
				matrix.elements[i % 16]! += 7;
				matrix.makeRotationFromEuler(euler);
				expect(matrix.elements.every((value, index) => Object.is(value, reference.elements[index]))).toBe(true);
			}
		}

		for (const x of [0, -0, Math.PI, 1e20]) {
			const euler = new Euler(x, -x, x);
			const reference = original.call(new Matrix4(), euler);
			matrix.makeRotationFromEuler(euler).makeRotationFromEuler(euler);
			expect(matrix.elements.every((value, index) => Object.is(value, reference.elements[index]))).toBe(true);
		}
	});

	it('does not cache nonfinite inputs, unsupported orders, or frozen targets', () => {
		const native = vi.spyOn(Matrix4.prototype, 'makeRotationFromEuler');
		initEulerMatrixCache();

		const matrix = new Matrix4();
		const nonfinite = new Euler(NaN, Infinity, 0);
		matrix.makeRotationFromEuler(nonfinite).makeRotationFromEuler(nonfinite);
		expect(native).toHaveBeenCalledTimes(2);

		const unsupported = new Euler(0, 0, 0, 'invalid' as EulerOrder);
		const unsupportedResult = original.call(matrix.clone(), unsupported).elements;
		matrix.makeRotationFromEuler(unsupported).makeRotationFromEuler(unsupported);
		expect(native).toHaveBeenCalledTimes(4);
		expect(matrix.elements.every((value, index) => Object.is(value, unsupportedResult[index]))).toBe(true);

		const euler = new Euler(1, 2, 3);
		matrix.makeRotationFromEuler(euler);
		Object.freeze(matrix.elements);
		expect(() => matrix.makeRotationFromEuler(euler)).toThrow(TypeError);
		expect(native).toHaveBeenCalledTimes(6);
	});
});
