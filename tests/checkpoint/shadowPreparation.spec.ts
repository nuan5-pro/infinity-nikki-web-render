import { afterEach, expect, it, vi } from 'vitest';
import { BoxGeometry, DirectionalLight, HemisphereLight, Mesh, MeshDepthMaterial, PerspectiveCamera, Scene, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { prepareShadowPrograms } from '../../src/runtime/shadowPreparation.js';

afterEach(() => vi.unstubAllGlobals());

function setup() {
	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
	const scene = new Scene();
	const camera = new PerspectiveCamera();
	const sun = new DirectionalLight();
	sun.castShadow = true;
	scene.add(sun);
	const material = new MeshDepthMaterial();
	const mesh = new Mesh(new BoxGeometry(), material);
	const programs: object[] = [];
	const previous = new WebGLRenderTarget();
	const shadow = new WebGLRenderTarget();
	let target = previous;
	let complete = false;
	const draw = vi.fn();
	const gl = { LINK_STATUS: 2, getExtension: () => ({ COMPLETION_STATUS_KHR: 1 }),
		getProgramParameter: vi.fn((_program, field) => field === 2 || complete), isContextLost: () => false };
	const renderer = {
		info: { programs }, renderBufferDirect: draw,
		compile: vi.fn(() => programs.push({ program: {}, getUniforms: () => ({ seq: [] }) })),
		getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
		setRenderTarget: (next: WebGLRenderTarget) => { target = next; },
		getContext: () => gl,
		shadowMap: { enabled: true, needsUpdate: false, render: vi.fn(() => {
			renderer.setRenderTarget(shadow);
			renderer.renderBufferDirect(sun.shadow.camera, null, mesh.geometry, material, mesh, null);
		}) },
	} as unknown as WebGLRenderer;
	return { renderer, scene, camera, sun, mesh, material, draw, previous,
		complete() { complete = true; frames.shift()!(0); },
		dispose() { mesh.geometry.dispose(); material.dispose(); previous.dispose(); shadow.dispose(); },
	};
}

it('submits actual shadow recipes without drawing and waits before releasing the scene', async () => {
	const state = setup();
	try {
		const { renderer, scene, camera, sun, draw, material, mesh } = state;
		const fill = new HemisphereLight();
		scene.add(fill);
		const task = prepareShadowPrograms(renderer, scene, camera, () => false);
		expect(renderer.shadowMap.render).toHaveBeenCalledWith([sun], scene, camera);
		expect(renderer.renderBufferDirect).toBe(draw);
		expect(renderer.getRenderTarget()).toBe(state.previous);
		expect(renderer.shadowMap.needsUpdate).toBe(true);
		expect(draw).not.toHaveBeenCalled();
		const carrier = vi.mocked(renderer.compile).mock.calls[0]![0] as Mesh;
		expect(carrier.material).toBe(material);
		expect(carrier.geometry).toBe(mesh.geometry);
		const compilationScene = vi.mocked(renderer.compile).mock.calls[0]![2]!;
		expect(Object.getPrototypeOf(compilationScene)).toBe(scene);
		expect(compilationScene.children).toEqual([sun, fill]);
		expect(fill.parent).toBe(scene);
		state.complete();
		expect(await task).toBe(true);
	} finally { state.dispose(); }
});

it('cancels pending shadow compilation without publishing readiness', async () => {
	const state = setup();
	let stale = false;
	try {
		const task = prepareShadowPrograms(state.renderer, state.scene, state.camera, () => stale);
		stale = true;
		state.complete();
		expect(await task).toBe(false);
	} finally { state.dispose(); }
});

it('restores the draw hook and target when depth shader submission fails', async () => {
	const state = setup();
	try {
		vi.mocked(state.renderer.compile).mockImplementationOnce(() => { throw new Error('depth failed'); });
		await expect(prepareShadowPrograms(state.renderer, state.scene, state.camera, () => false)).rejects.toThrow('depth failed');
		expect(state.renderer.renderBufferDirect).toBe(state.draw);
		expect(state.renderer.getRenderTarget()).toBe(state.previous);
	} finally { state.dispose(); }
});
