import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	InstancedMesh,
	BoxGeometry,
	MeshBasicMaterial,
	Scene,
	PerspectiveCamera,
	Texture,
	type Material,
	type WebGLRenderer,
} from 'three';
import { createGroupPreparation } from '../../src/runtime/groupPreparation.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function setupPipeline(
	counts: number[],
	ready: (material: Material) => boolean = () => true,
	taskMs = 0,
	stale: (index: number) => boolean = () => false,
) {
	const frames = new Map<number, FrameRequestCallback>();
	let id = 0;
	let time = 0;
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		frames.set(++id, callback);
		return id;
	});
	vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
	vi.spyOn(performance, 'now').mockImplementation(() => time);
	const scene = new Scene();
	const camera = new PerspectiveCamera();
	const materials = counts.map((count) => Array.from({ length: count }, () => {
		const material = new MeshBasicMaterial();
		material.customProgramCacheKey = vi.fn(() => 'stable');
		return material;
	}));
	const meshes = materials.map((values) => new InstancedMesh(new BoxGeometry(), values, 1));
	scene.add(...meshes);
	const properties = new Map();
	let target: unknown = null;
	const renderer = {
		toneMapping: 3,
		outputColorSpace: 'srgb',
		shadowMap: { enabled: false, type: 1 },
		domElement: new EventTarget(),
		getRenderTarget: () => target,
		setRenderTarget: (value: unknown) => { target = value; },
		properties: { get: (material: Material) => properties.get(material) },
		getContext: () => ({
			isContextLost: () => false,
			LINK_STATUS: 2,
			getExtension: () => ({ COMPLETION_STATUS_KHR: 1 }),
			getProgramParameter: (program: { material: Material }, parameter: number) => parameter === 2 || ready(program.material),
		}),
		compile: vi.fn((object: InstancedMesh) => {
			time += taskMs;
			const material = object.material as Material;
			properties.set(material, {
				programs: new Map([['main', { program: { material }, getUniforms: () => ({ seq: [] }) }]]),
				uniforms: {},
			});
		}),
		compileAsync: vi.fn(async () => {}),
		initTexture: vi.fn(),
	} as unknown as WebGLRenderer;
	const preparation = createGroupPreparation(renderer, () => ({ scene, camera }), () => {});
	const results = meshes.map((mesh, index) => preparation.prepare(mesh, () => stale(index)));
	return {
		materials, meshes, renderer, preparation, results, frames,
		elapse(ms: number) { time += ms; },
		async frame() {
			const callbacks = [...frames.values()];
			frames.clear();
			expect(callbacks).toHaveLength(1);
			callbacks[0]!(time);
			await Promise.resolve();
			await Promise.resolve();
		},
		dispose() {
			preparation.dispose();
			for (const mesh of meshes) mesh.geometry.dispose();
			for (const values of materials) for (const material of values) material.dispose();
		},
	};
}

describe('candidate preparation handoff', () => {
	it('settles all stale candidates before touching the renderer or draining GPU work', async () => {
		let stale = false;
		const state = setupPipeline([2], () => true, 0, () => stale);
		const textures = state.materials[0]!.map((material) => material.map = new Texture());
		try {
			await state.frame();
			expect(state.renderer.compile).toHaveBeenCalledTimes(2);
			const context = vi.spyOn(state.renderer, 'getContext');
			const target = vi.spyOn(state.renderer, 'setRenderTarget');
			stale = true;
			await state.frame();
			expect(await state.results[0]).toBe(false);
			expect(context).not.toHaveBeenCalled();
			expect(target).not.toHaveBeenCalled();
			expect(state.renderer.initTexture).not.toHaveBeenCalled();
			expect(state.renderer.compileAsync).not.toHaveBeenCalled();
			expect(state.frames.size).toBe(0);
		} finally {
			state.dispose();
			textures.forEach((texture) => texture.dispose());
		}
	});

	it('settles stale peers before a live upload exhausts the frame budget', async () => {
		let stale = false;
		const state = setupPipeline([1, 1], () => true, 0, (index) => index === 1 && stale);
		const textures = state.materials.map(([material]) => material!.map = new Texture());
		const cancelled = vi.fn();
		void state.results[1]!.then(cancelled);
		try {
			await state.frame();
			stale = true;
			vi.mocked(state.renderer.initTexture).mockImplementation(() => state.elapse(8));
			await state.frame();
			expect(cancelled).toHaveBeenCalledExactlyOnceWith(false);
			expect(state.renderer.initTexture).toHaveBeenCalledExactlyOnceWith(textures[0]);
			await state.frame();
			expect(await Promise.all(state.results)).toEqual([true, false]);
			expect(state.renderer.initTexture).toHaveBeenCalledTimes(1);
		} finally {
			state.dispose();
			textures.forEach((texture) => texture.dispose());
		}
	});

	it('fills a bounded sliding window fairly across candidates instead of waiting for their first material', async () => {
		const state = setupPipeline([20, 20, 20], () => false);
		try {
			await state.frame();
			expect(vi.mocked(state.renderer.compile).mock.calls.map(([mesh]) => (mesh as InstancedMesh).material)).toEqual([
				state.materials[0]![0], state.materials[1]![0], state.materials[2]![0],
				state.materials[0]![1], state.materials[1]![1], state.materials[2]![1],
				state.materials[0]![2], state.materials[1]![2],
			]);
			for (let i = 0; i < 3; i++) await state.frame();
			expect(state.renderer.compile).toHaveBeenCalledTimes(8);
			expect(state.renderer.compileAsync).not.toHaveBeenCalled();
		} finally {
			state.dispose();
		}
		expect(await Promise.all(state.results)).toEqual([false, false, false]);
	});

	it('advances the unresolved window past a slow first program', async () => {
		const state = setupPipeline([48], (material) => material !== blocked);
		const blocked = state.materials[0]![0]!;
		const settled = vi.fn();
		void state.results[0]!.then(settled);
		try {
			for (let i = 0; i < 6; i++) await state.frame();
			expect(vi.mocked(state.renderer.compile).mock.calls.length).toBeGreaterThan(16);
			expect(vi.mocked(state.renderer.compile).mock.calls.filter(([mesh]) => (mesh as InstancedMesh).material === blocked)).toHaveLength(1);
			expect(settled).not.toHaveBeenCalled();
		} finally {
			state.dispose();
		}
		expect(await state.results[0]).toBe(false);
	});

	it('does not rescan a completed material prefix on every frame of a large candidate', async () => {
		const count = 96;
		const state = setupPipeline([count]);
		const groups = vi.spyOn(state.meshes[0]!.geometry.groups, 'find');
		try {
			for (let i = 0; i < 40 && state.frames.size; i++) await state.frame();
			expect(state.frames.size).toBe(0);
			expect(await state.results[0]).toBe(true);
			expect(state.renderer.compile).toHaveBeenCalledTimes(count);
			expect(vi.mocked(state.materials[0]![0]!.customProgramCacheKey).mock.calls.length).toBeLessThan(40);
			expect(state.materials[0]!.reduce((calls, material) => calls + vi.mocked(material.customProgramCacheKey).mock.calls.length, 0)).toBeLessThan(count * 40);
			expect(groups).not.toHaveBeenCalled();
		} finally {
			state.dispose();
		}
	});

	it('yields to the shared CPU budget and resumes with the next candidate', async () => {
		const state = setupPipeline([20, 20], () => false, 2);
		try {
			await state.frame();
			expect(state.renderer.compile).toHaveBeenCalledTimes(3);
			await state.frame();
			const compiled = vi.mocked(state.renderer.compile).mock.calls.map(([mesh]) => (mesh as InstancedMesh).material);
			expect(compiled).toHaveLength(6);
			for (const materials of state.materials)
				expect(compiled.filter((material) => materials.includes(material as MeshBasicMaterial))).toHaveLength(3);
		} finally {
			state.dispose();
		}
		await Promise.all(state.results);
	});

	it('hands off cached candidates even while all compilation slots are occupied', async () => {
		const state = setupPipeline([1, 8], (material) => material === cached);
		const cached = state.materials[0]![0]!;
		try {
			for (let i = 0; i < 3; i++) await state.frame();
			expect(await state.results[0]).toBe(true);
			expect(state.renderer.compile).toHaveBeenCalledTimes(9);
			const progress = vi.fn();
			const ready = state.preparation.prepareScene(() => false, progress);
			await state.frame();
			expect(progress.mock.calls).toEqual([[0, 2], [1, 2]]);
			expect(state.renderer.compile).toHaveBeenCalledTimes(9);
			state.dispose();
			expect(await ready).toBe(false);
		} finally {
			state.dispose();
		}
		await Promise.all(state.results);
	});

	it('revalidates an earlier completed material before handing off the final window', async () => {
		let allowLast = false;
		let changed = false;
		let allowFirst = false;
		const state = setupPipeline([12], (material) =>
			(material !== last || allowLast) && (material !== first || !changed || allowFirst));
		const first = state.materials[0]![0]!;
		const last = state.materials[0]![11]!;
		const settled = vi.fn();
		void state.results[0]!.then(settled);
		try {
			for (let i = 0; i < 4; i++) await state.frame();
			first.onBeforeCompile = () => {};
			changed = allowLast = true;
			for (let i = 0; i < 3; i++) await state.frame();
			expect(vi.mocked(state.renderer.compile).mock.calls.filter(([mesh]) => (mesh as InstancedMesh).material === first)).toHaveLength(2);
			expect(settled).not.toHaveBeenCalled();
			allowFirst = true;
			for (let i = 0; i < 4 && state.frames.size; i++) await state.frame();
			expect(await state.results[0]).toBe(true);
			expect(state.renderer.compile).toHaveBeenCalledTimes(13);
		} finally {
			state.dispose();
		}
	});

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
					programs: new Map([['main', { program: {}, getUniforms: () => ({ seq: [] }) }]]),
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
		scene.add(...meshes);
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
				expect(vi.mocked(renderer.compile).mock.calls.length - compiles).toBeLessThanOrEqual(8);
				expect(vi.mocked(renderer.initTexture).mock.calls.length - uploads).toBeLessThanOrEqual(1);
				expect(scan.mock.calls.length - scans).toBe(1);
			}

			expect(await Promise.all(results)).toEqual([true, true, true]);
			expect(renderer.compile).toHaveBeenCalledTimes(3);
			expect(renderer.compileAsync).toHaveBeenCalledTimes(3);
			expect(renderer.initTexture).toHaveBeenCalledTimes(3);
			const scans = scan.mock.calls.length;
			const progress = vi.fn();
			const sceneReady = preparation.prepareScene(() => false, progress);
			// One discovery traversal, not one full-scene readiness scan per batch.
			expect(scan.mock.calls.length - scans).toBe(1);
			const callbacks = [...frames.values()];
			frames.clear();
			callbacks[0]!(100);
			expect(await sceneReady).toBe(true);
			expect(progress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
			expect(renderer.compile).toHaveBeenCalledTimes(3);
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
