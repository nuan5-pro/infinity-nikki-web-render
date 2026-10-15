import { DirectionalLight, PerspectiveCamera, Vector2, type WebGLRenderer } from 'three';
import { expect, it } from 'vitest';
import { createNNClothPreviewView, updateNNClothPreviewView } from '../src/materials/nncloth/nnclothPreviewABI.js';
import { createNNClothGeometryABI, type NNClothSourceCollections } from '../src/materials/nncloth/nnclothGeometryABI.js';

const renderer = {
	getDrawingBufferSize: (size: Vector2) => size.set(800, 600),
} as WebGLRenderer;

it('writes camera, light and time registers with fixed editor defaults', () => {
	const view = createNNClothPreviewView();
	const camera = new PerspectiveCamera(60, 4 / 3, 1, 10000);
	camera.position.set(10, 20, 30);
	const light = new DirectionalLight(0xffffff, Math.PI);
	light.color.setRGB(0.2, 0.4, 0.8);
	light.position.set(0, 0, 10);
	updateNNClothPreviewView(view, renderer, camera, light, 12.5);
	expect(view[110]!.toArray()).toEqual([-20, 10, 30, 0]);
	expect(view[136]!.toArray()).toEqual([800, 600, 1 / 800, 1 / 600]);
	expect(view[143]!.z).toBe(1);
	expect(view[146]!.toArray()).toEqual([0, 0, 0, 1]);
	expect(view[150]!.z).toBe(12.5);
	expect(view[151]!.x).toBe(0);
	expect(view[160]!.toArray()).toEqual([0, 1, 0, 0]);
	for (const [index, expected] of [0.2, 0.4, 0.8].entries())
		expect(view[154]!.getComponent(index)).toBeCloseTo(expected);

	updateNNClothPreviewView(view, renderer, camera, null, 20);
	expect(view[150]!.z).toBe(20);
	expect(view[154]!.toArray()).toEqual([0, 0, 0, 0]);
	expect(view[155]!.toArray()).toEqual([0, 0, 0, 0]);
});

it('rejects invalid View buffers, clocks and out-of-range camera positions', () => {
	const view = createNNClothPreviewView();
	const camera = new PerspectiveCamera();
	expect(() => updateNNClothPreviewView(view.slice(1), renderer, camera, null, 0)).toThrow('View buffer');
	expect(() => updateNNClothPreviewView(view, renderer, camera, null, NaN)).toThrow('time');
	camera.position.x = 2097152;
	expect(() => updateNNClothPreviewView(view, renderer, camera, null, 0)).toThrow('camera outside');
});

it('builds geometry inputs from collection values and component custom data', () => {
	const collections: NNClothSourceCollections = {
		tod: Array.from({ length: 31 }, () => [0, 0, 0, 0]),
		weather: Array.from({ length: 40 }, () => [0, 0, 0, 0]),
	};
	const words = { '0': 1, '316': 0, '317': 0 };
	const empty = createNNClothGeometryABI(collections, words, undefined, { customPrimitiveData: [] });
	expect(empty.mode).toBe('geometry');
	expect(empty.uniforms.nnCustomData2!.value).toBe(0);
	const overridden = createNNClothGeometryABI(collections, words, undefined, { customPrimitiveData: [0, 0, 2] });
	expect(overridden.uniforms.nnCustomData2!.value).toBe(2);
	expect(() => createNNClothGeometryABI(collections, words, undefined, { customPrimitiveData: [NaN] })).toThrow('custom-data');
	expect(() => createNNClothGeometryABI({ ...collections, tod: [] }, words, undefined, { customPrimitiveData: [] })).toThrow('collections');
});
