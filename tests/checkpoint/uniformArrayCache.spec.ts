import { describe, expect, it, vi } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import {
	cacheArrayUniform,
	prepareUniformArrayCache,
} from '../../src/runtime/uniformArrayCache.js';
import type { WebGLRenderer } from 'three';

const gl = {} as WebGLRenderingContext;

describe('program numeric array cache', () => {
	it.each([
		0x1406, 0x8b50, 0x8b51, 0x8b52, 0x8b5a, 0x8b5b, 0x8b5c, 0x1404, 0x8b53, 0x8b54, 0x8b55, 0x8b56,
		0x8b57, 0x8b58, 0x8b59, 0x1405, 0x8dc6, 0x8dc7, 0x8dc8,
	])('preserves numeric array changes for standard GLenum %i', (type) => {
		const upload = vi.fn();
		const uniform = { type, size: 1, setValue: upload };
		cacheArrayUniform(uniform);

		const values = new Float32Array(16).fill(1);
		uniform.setValue(gl, values);
		uniform.setValue(gl, values.slice());
		values[15] = 2;
		uniform.setValue(gl, values);
		expect(upload).toHaveBeenCalledTimes(2);
	});

	it('leaves unknown reflected types untouched', () => {
		const setter = vi.fn();
		const uniform = { type: 0xffff, size: 1, setValue: setter };
		cacheArrayUniform(uniform);
		expect(uniform.setValue).toBe(setter);
	});

	it('waits for ready programs and gives rebuilt programs independent caches', () => {
		const uniform = { type: 0x1406, size: 1, setValue: vi.fn() };
		const program = { isReady: vi.fn(() => false), getUniforms: vi.fn(() => ({ seq: [uniform] })) };
		const renderer = { info: { programs: [program] } } as unknown as WebGLRenderer;
		prepareUniformArrayCache(renderer);
		expect(program.getUniforms).not.toHaveBeenCalled();
		program.isReady.mockReturnValue(true);
		prepareUniformArrayCache(renderer);

		const cached = uniform.setValue;
		prepareUniformArrayCache(renderer);
		expect(uniform.setValue).toBe(cached);
		expect(program.getUniforms).toHaveBeenCalledTimes(1);

		const rebuiltUpload = vi.fn();
		const rebuilt = { type: 0x1406, size: 1, setValue: rebuiltUpload };

		const second = { isReady: () => true,

			getUniforms: () => ({ seq: [rebuilt] }) };

		renderer.info.programs = [second] as unknown as WebGLRenderer['info']['programs'];
		prepareUniformArrayCache(renderer);
		uniform.setValue(gl, [1]);
		rebuilt.setValue(gl, [1]);
		expect(rebuiltUpload).toHaveBeenCalledTimes(1);
		expect(program.getUniforms).toHaveBeenCalledTimes(1);
	});

	it('retains program state across distinct material arrays and notices in-place edits', () => {
		const upload = vi.fn();
		const uniform = { type: 0x1406, size: 2, setValue: upload };
		cacheArrayUniform(uniform);

		const a = new Float32Array([1, 2]);
		const b = new Float32Array([1, 2]);
		uniform.setValue(gl, a);
		uniform.setValue(gl, b);
		expect(upload).toHaveBeenCalledTimes(1);
		b[1] = 3;
		uniform.setValue(gl, b);
		uniform.setValue(gl, a);
		expect(upload).toHaveBeenCalledTimes(3);
	});

	it('compares matrix and vector components rather than identities', () => {
		const matrixUpload = vi.fn();
		const vectorUpload = vi.fn();
		const matrices = { type: 0x8b5c, size: 1, setValue: matrixUpload };
		const vectors = { type: 0x8b51, size: 2, setValue: vectorUpload };
		cacheArrayUniform(matrices);
		cacheArrayUniform(vectors);

		const matrix = new Matrix4();
		const values = [new Vector3(1, 2, 3), new Vector3(4, 5, 6)];
		matrices.setValue(gl, [matrix]);
		matrices.setValue(gl, [matrix.clone()]);
		matrix.elements[12] = 5;
		matrices.setValue(gl, [matrix]);
		vectors.setValue(gl, values);
		vectors.setValue(gl, values.map((v) => v.clone()));
		values[1]!.y = 8;
		vectors.setValue(gl, values);
		expect(matrixUpload).toHaveBeenCalledTimes(2);
		expect(vectorUpload).toHaveBeenCalledTimes(2);
	});

	it('does not suppress scalar or sampler work and retries failed uploads', () => {
		const sampler = { type: 0x8b5e, size: 1, setValue: vi.fn() };
		const scalar = { type: 0x1406, setValue: vi.fn() };
		const samplerSetter = sampler.setValue;
		const scalarSetter = scalar.setValue;
		cacheArrayUniform(sampler);
		cacheArrayUniform(scalar);
		expect(sampler.setValue).toBe(samplerSetter);
		expect(scalar.setValue).toBe(scalarSetter);

		const upload = vi.fn().mockImplementationOnce(() => {
			throw new Error('context');
		});
		const array = { type: 0x1406, size: 1, setValue: upload };
		cacheArrayUniform(array);
		expect(() => array.setValue(gl, [1])).toThrow('context');
		array.setValue(gl, [1]);
		expect(upload).toHaveBeenCalledTimes(2);
	});
});
