import { afterEach, expect, it, vi } from 'vitest';
import { Scene, type WebGLRenderer } from 'three';
import { createMaterialClock, installMaterialClock, materialTime } from '../src/runtime/materialClock.js';
import { createRenderContext } from '../src/runtime/context.js';
import { getEditorMaterialPreviewContext } from '../src/materials/jewel/characterJewelPreview.js';

vi.mock('../src/runtime/groupPreparation.js', () => ({ createGroupPreparation: () => ({ prepare: vi.fn(), dispose: vi.fn() }) }));
vi.mock('../src/materials/nncloth/nnclothRendererContext.js', () => ({ installNNClothRendererContext: () => () => {} }));

afterEach(() => { vi.unstubAllGlobals(); });

it('preserves standalone running time and resumes from the paused instant without jumping', () => {
	let time = 10;
	const clock = createMaterialClock(() => time);
	expect(clock.read()).toBe(10);
	time = 13;
	expect(clock.read()).toBe(13);
	expect(clock.setEnabled(false)).toBe(true);
	time = 1000;
	expect(clock.read()).toBe(13);
	expect(clock.setEnabled(true)).toBe(true);
	expect(clock.read()).toBe(13);
	time = 1004;
	expect(clock.read()).toBe(17);
	expect(clock.setEnabled(true)).toBe(false);
	time = 1005;
	expect(clock.read()).toBe(18);
});

it('starts an explicitly static preview at zero and scopes its clock to the renderer', () => {
	let time = 100;
	const clock = createMaterialClock(() => time, false);
	const renderer = {} as WebGLRenderer;
	const release = installMaterialClock(renderer, clock);
	expect(materialTime(renderer)).toBe(0);
	time = 200;
	expect(materialTime(renderer)).toBe(0);
	clock.setEnabled(true);
	time = 203;
	expect(materialTime(renderer)).toBe(3);
	vi.stubGlobal('performance', { now: () => 60000 });
	expect(materialTime({} as WebGLRenderer)).toBe(60);
	release();
	expect(materialTime(renderer)).toBe(60);
});

it('pauses automatic requests while preserving loading and interaction invalidation', () => {
	let time = 100;
	const queued: FrameRequestCallback[] = [];
	const request = vi.fn((callback: FrameRequestCallback) => queued.push(callback));
	vi.stubGlobal('requestAnimationFrame', request);
	vi.stubGlobal('cancelAnimationFrame', vi.fn());
	const renderer = { shadowMap: {} } as WebGLRenderer;
	const scene = new Scene();
	const invalidate = vi.fn();
	const context = createRenderContext({
		renderer, scene, getCamera: () => undefined, invalidate, materialAnimation: false, clock: () => time,
		lighting: () => ({ primaryColor: [1, 1, 1], primaryDirection: [0, 0, -1], tod: { minute: 720, sunDirectionWorld: [0, 0, 1], swapLightFactor: -1 } }),
	});
	const preview = getEditorMaterialPreviewContext(renderer, scene);
	try {
		preview.draw();
		expect(request).not.toHaveBeenCalled();
		expect(preview.clock()).toBe(0);
		expect(materialTime(renderer)).toBe(0);
		context.invalidate();
		context.invalidateShadows();
		expect(invalidate).toHaveBeenCalledTimes(2);
		context.setMaterialAnimation(true);
		expect(invalidate).toHaveBeenCalledTimes(3);
		time = 102;
		expect(preview.clock()).toBe(2);
		preview.draw();
		expect(request).toHaveBeenCalledOnce();
		context.setMaterialAnimation(false);
		expect(invalidate).toHaveBeenCalledTimes(4);
		time = 500;
		queued[0]!(0);
		expect(invalidate).toHaveBeenCalledTimes(4);
		expect(preview.clock()).toBe(2);
		context.setMaterialAnimation(true);
		expect(preview.clock()).toBe(2);
		time = 501;
		expect(preview.clock()).toBe(3);
	} finally {
		context.dispose();
	}
});
