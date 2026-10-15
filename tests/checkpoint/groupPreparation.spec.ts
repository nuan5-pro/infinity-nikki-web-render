import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	InstancedMesh,
	BoxGeometry,
	MeshBasicMaterial,
	Scene,
	PerspectiveCamera,
	Texture,
	type WebGLRenderer,
} from 'three';
import { createGroupPreparation } from '../../src/runtime/groupPreparation.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('candidate preparation handoff', () => {
	it('shares a single frame budget and light scan across three concurrent candidates', async () => {
		const frames = new Map<number, FrameRequestCallback>();
		let id = 0;
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			frames.set(++id, callback);
			return id;
		});
		vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
		vi.spyOn(performance, 'now').mockReturnValue(0);

		const scene = new Scene();
		const camera = new PerspectiveCamera();
		const scan = vi.spyOn(scene, 'traverseVisible');
		const properties = new Map();
		let target: unknown = null;

		const renderer = {
			toneMapping: 3,
			outputColorSpace: 'srgb',
			shadowMap: { enabled: false, type: 1 },
			domElement: new EventTarget(),

			getRenderTarget: () => target,

			setRenderTarget: (value: unknown) => {
				target = value;
			},

			properties: { get: (material: unknown) => properties.get(material) },

			getContext: () => ({
				isContextLost: () => false,

				LINK_STATUS: 2,

				getExtension: () => ({ COMPLETION_STATUS_KHR: 1 }),

				getProgramParameter: () => true,
			}),

			compile: vi.fn((object: InstancedMesh) => {
				const material = object.material as MeshBasicMaterial;
				properties.set(material, {
					programs: new Map([['main', { program: {} }]]),
					uniforms: { map: { value: material.map } },
				});
			}),
			compileAsync: vi.fn(async () => {}),
			initTexture: vi.fn(),
		} as unknown as WebGLRenderer;

		const preparation = createGroupPreparation(renderer, () => ({ scene, camera }), () => {});
		const meshes = Array.from({ length: 3 }, () => {
			const map = new Texture({ width: 2048, height: 1024 });
			return new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial({ map }), 1);
		});
		const results = meshes.map((mesh) => preparation.prepare(mesh, () => false));
		try {
			for (let frame = 0; frame < 6 && frames.size; frame++) {
				expect(frames.size).toBe(1);

				const callbacks = [...frames.values()];
				frames.clear();

				const compiles = vi.mocked(renderer.compile).mock.calls.length;
				const uploads = vi.mocked(renderer.initTexture).mock.calls.length;
				const scans = scan.mock.calls.length;
				callbacks[0]!(frame * 16);
				await Promise.resolve();
				await Promise.resolve();
				expect(vi.mocked(renderer.compile).mock.calls.length - compiles).toBeLessThanOrEqual(2);
				expect(vi.mocked(renderer.initTexture).mock.calls.length - uploads).toBeLessThanOrEqual(1);
				expect(scan.mock.calls.length - scans).toBe(1);
			}

			expect(await Promise.all(results)).toEqual([true, true, true]);
			expect(renderer.compile).toHaveBeenCalledTimes(3);
			expect(renderer.compileAsync).toHaveBeenCalledTimes(3);
			expect(renderer.initTexture).toHaveBeenCalledTimes(3);
			expect(frames.size).toBe(0);
			expect(await preparation.prepare(meshes[0]!, () => false)).toBe(true);
			expect(frames.size).toBe(0);
			expect(renderer.compile).toHaveBeenCalledTimes(3);
			expect(renderer.initTexture).toHaveBeenCalledTimes(3);
		} finally {
			preparation.dispose();
			for (const mesh of meshes) {
				mesh.geometry.dispose()
				;
				(mesh.material as MeshBasicMaterial).dispose();
			}
		}

		expect(await preparation.prepare(meshes[0]!, () => false)).toBe(false);
	});

	it('settles pending candidates on owner disposal and rejects stale work before scheduling', async () => {
		const frame = vi.fn(() => 1);
		vi.stubGlobal('requestAnimationFrame', frame);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());

		const renderer = { domElement: new EventTarget(), shadowMap: {} } as WebGLRenderer;
		const preparation = createGroupPreparation(renderer, () => ({ scene: new Scene(), camera: undefined }), () => {});
		const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 1);
		expect(await preparation.prepare(mesh, () => true)).toBe(false);
		expect(frame).not.toHaveBeenCalled();

		const pending = preparation.prepare(mesh, () => false);
		preparation.dispose();
		expect(await pending).toBe(false);
		mesh.geometry.dispose()
		;
		(mesh.material as MeshBasicMaterial).dispose();
	});
});
