import { expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, IntType, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Ray, Uint32BufferAttribute, Vector3 } from 'three';
import { geometryTransfers, packGeometryBuffers, processGeometryBuffers, restoreGeometryBuffers } from '../src/furniture/geometryBuffers.js';

it.each([true, false])('transfers owned geometry and indirect BVH without detaching its cached source (indexed=%s)', (indexed) => {
	const box = new BoxGeometry();
	box.computeTangents();
	const source = indexed ? box : box.toNonIndexed();
	source.setAttribute('nativeBasis', new Float32BufferAttribute(new Float32Array(source.getAttribute('position').count * 3).fill(.25), 3));
	const original = source.getAttribute('position').array.slice();
	const geometry = source.clone();
	const metadata = { component: 17 };
	geometry.userData = metadata;
	const input = { geometries: [packGeometryBuffers(geometry)], matrices: [new Matrix4().makeTranslation(2, 0, 0).toArray()], boundsTree: true };
	const transferred = structuredClone(input, { transfer: geometryTransfers(input.geometries) });
	expect(geometry.getAttribute('position').array.byteLength).toBe(0);
	expect(source.getAttribute('position').array).toEqual(original);
	const processed = processGeometryBuffers(transferred);
	const output = structuredClone(processed, { transfer: geometryTransfers(processed) });
	restoreGeometryBuffers(geometry, output[0]!);
	expect(geometry.userData).toBe(metadata);
	expect(geometry.getAttribute('nativeBasis').array).toEqual(source.getAttribute('nativeBasis').array);
	expect(geometry.index?.array).toEqual(source.index?.array);
	expect(geometry.boundingBox!.min.toArray()).toEqual([1.5, -.5, -.5]);
	expect(geometry.boundingBox!.max.toArray()).toEqual([2.5, .5, .5]);
	const hit = geometry.boundsTree!.raycastFirst(new Ray(new Vector3(2, 0, 3), new Vector3(0, 0, -1)));
	expect(hit?.distance).toBeCloseTo(2.5);
	expect(source.getAttribute('position').array).toEqual(original);
});

it('preserves interleaved values and integer shader attributes across a worker transfer', () => {
	const geometry = new BufferGeometry();
	const source = new InterleavedBuffer(new Float32Array([1, 2, 3, .25, .5, 4, 5, 6, .75, 1]), 5);
	geometry.setAttribute('position', new InterleavedBufferAttribute(source, 3, 0));
	geometry.setAttribute('uv', new InterleavedBufferAttribute(source, 2, 3));
	const ids = new Uint32BufferAttribute([0xffffffff, 0x80000000], 1);
	ids.gpuType = IntType;
	geometry.setAttribute('nativeId', ids);
	const data = packGeometryBuffers(geometry);
	const moved = structuredClone(data, { transfer: geometryTransfers([data]) });
	restoreGeometryBuffers(geometry, moved);
	expect(geometry.getAttribute('position').array).toEqual(new Float32Array([1, 2, 3, 4, 5, 6]));
	expect(geometry.getAttribute('uv').array).toEqual(new Float32Array([.25, .5, .75, 1]));
	expect(geometry.getAttribute('nativeId').array).toEqual(new Uint32Array([0xffffffff, 0x80000000]));
	expect(geometry.getAttribute('nativeId').gpuType).toBe(IntType);
});
