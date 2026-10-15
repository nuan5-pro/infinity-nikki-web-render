import { strict as assert } from 'node:assert';
import { test, vi } from 'vitest';
import {
	BufferAttribute,
	BufferGeometry,
	InterleavedBuffer,
	InterleavedBufferAttribute,
	Matrix4,
} from 'three';
import {
	assertNNClothSourceGeometry,
	decodeNNClothNativeSNORM,
	prepareNNClothWorldBasis,
	transformNNClothWorldBasis,
	NN_CLOTH_SOURCE_NORMAL,
	NN_CLOTH_SOURCE_POSITION,
	NN_CLOTH_SOURCE_TANGENT,
	NN_CLOTH_WORLD_NORMAL,
	NN_CLOTH_WORLD_TANGENT,
} from '../../src/materials/nncloth/nnclothGeometry.js';

test('native SNORM control undoes only the declared CUE XOR and clamps int8 -128', () => {
	assert.deepEqual(decodeNNClothNativeSNORM(0x7f7f0000, 'archive-int8-dword'), [0, 0, 1, 1]);
	assert.deepEqual(decodeNNClothNativeSNORM(0xffff8080, 'cue-after-precision-xor'), [0, 0, 1, 1]);
	assert.equal(decodeNNClothNativeSNORM(0x00000080, 'archive-int8-dword')[0], -1);
	assert.equal(decodeNNClothNativeSNORM(0x000000ff, 'archive-int8-dword')[0], Math.fround(-1 / 127));
});

test('pre-skinned source controls remain unchanged across mirrored nonuniform preview baking', () => {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
	geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0]), 2));
	geometry.setAttribute(NN_CLOTH_SOURCE_POSITION, new BufferAttribute(new Float32Array([3, 7, 11]), 3));
	geometry.setAttribute(NN_CLOTH_SOURCE_NORMAL, new BufferAttribute(new Float32Array([0, 0, 0.5, 1]), 4));
	geometry.setAttribute(NN_CLOTH_SOURCE_TANGENT, new BufferAttribute(new Float32Array([1, 0, 0, 1]), 4));
	prepareNNClothWorldBasis(geometry, [0]);
	transformNNClothWorldBasis(geometry, new Matrix4().makeScale(-3, 5, 7));
	assert.deepEqual(Array.from(geometry.getAttribute(NN_CLOTH_SOURCE_NORMAL).array), [0, 0, 0.5, 1]);
	assert.deepEqual(Array.from(geometry.getAttribute(NN_CLOTH_SOURCE_POSITION).array), [3, 7, 11]);
	assert.equal(geometry.getAttribute(NN_CLOTH_WORLD_NORMAL).getY(0), 0.5);
	geometry.setAttribute('uv', new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array([0.2, 0.4, NaN]), 3), 2, 0));
	assertNNClothSourceGeometry(geometry, [0]);
	geometry.getAttribute('uv').setX(0, NaN);
	assert.throws(() => assertNNClothSourceGeometry(geometry, [0]), /nonfinite source stream uv/);
	geometry.getAttribute('uv').setX(0, 0.2);
	geometry.deleteAttribute(NN_CLOTH_SOURCE_NORMAL);
	assert.throws(() => assertNNClothSourceGeometry(geometry, [0]), /original pre-bake/);
});

test('computes the immutable bake determinant once while preserving every vertex handedness', () => {
	const geometry = new BufferGeometry();
	geometry.setAttribute(NN_CLOTH_WORLD_NORMAL, new BufferAttribute(new Float32Array([
		0, 0, 0.5, 0, 0, 1, 0, 0, 0.25,
	]), 3));
	geometry.setAttribute(NN_CLOTH_WORLD_TANGENT, new BufferAttribute(new Float32Array([
		1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1,
	]), 4));

	const matrix = new Matrix4().makeScale(-3, 5, 7);
	const determinant = vi.spyOn(matrix, 'determinant');
	transformNNClothWorldBasis(geometry, matrix);
	assert.equal(determinant.mock.calls.length, 1);

	const tangent = geometry.getAttribute(NN_CLOTH_WORLD_TANGENT);
	assert.deepEqual([0, 1, 2].map(vertex => tangent.getW(vertex)), [-1, 1, -1]);
	assert.deepEqual([0, 1, 2].map(vertex => tangent.getX(vertex)), [-1, -1, -1]);
	assert.throws(() => transformNNClothWorldBasis(geometry, new Matrix4().makeScale(0, 1, 1)), /invalid preview/);
});
