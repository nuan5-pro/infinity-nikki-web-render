import { describe, expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';
import {
	installNNClothRendererContext,
	requireNNClothRendererLease,
} from '../../src/materials/nncloth/nnclothRendererContext.js';

function renderer() {
	const lost = vi.fn(() => false);
	const gl = { isContextLost: lost } as unknown as WebGL2RenderingContext;
	const canvas = new EventTarget();

	const value = { getContext: () => gl,

		domElement: canvas } as unknown as WebGLRenderer;

	return { value, lost, canvas };
}

describe('actual NN renderer lease', () => {
	it('requires an explicit owner and supports independent renderers', () => {
		expect(() => requireNNClothRendererLease()).toThrow();

		const a = renderer();
		const b = renderer();
		const disposeA = installNNClothRendererContext(a.value);
		const first = requireNNClothRendererLease(a.value);
		const disposeB = installNNClothRendererContext(b.value);
		expect(() => requireNNClothRendererLease()).toThrow(/unavailable/);
		expect(() => first.assertCurrent()).not.toThrow();
		expect(requireNNClothRendererLease(b.value) === first).toBe(false);
		disposeB();
		expect(requireNNClothRendererLease(a.value)).toBe(first);
		expect(() => first.assertCurrent(b.value)).toThrow();
		disposeA();
	});

	it('late old disposal cannot unregister a replacement generation', () => {
		const a = renderer();
		const oldDispose = installNNClothRendererContext(a.value);
		const old = requireNNClothRendererLease(a.value);
		const invalidate = vi.fn();
		old.onInvalidate(invalidate);

		const dispose = installNNClothRendererContext(a.value);
		const current = requireNNClothRendererLease(a.value);
		expect(current.generation).toBeGreaterThan(old.generation);
		expect(invalidate).toHaveBeenCalledTimes(1);
		oldDispose();
		expect(requireNNClothRendererLease(a.value)).toBe(current);
		expect(() => old.assertCurrent()).toThrow();
		dispose();
	});

	it('context loss invalidates pending owners once; fresh ready can register again', () => {
		const a = renderer();
		const dispose = installNNClothRendererContext(a.value);
		const lease = requireNNClothRendererLease(a.value);
		const canceled = vi.fn();
		lease.onInvalidate(canceled);
		a.lost.mockReturnValue(true);
		expect(() => lease.assertCurrent()).toThrow(/lost/);
		a.canvas.dispatchEvent(new Event('webglcontextlost'));
		dispose();
		expect(canceled).toHaveBeenCalledTimes(1);
		expect(() => requireNNClothRendererLease()).toThrow();
		a.lost.mockReturnValue(false);

		const ready = installNNClothRendererContext(a.value);
		expect(requireNNClothRendererLease(a.value).generation).toBeGreaterThan(lease.generation);
		ready();
	});
});
