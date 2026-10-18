import { afterEach, expect, it, vi } from 'vitest';
import { Box3, BoxGeometry, Matrix4, MeshBasicMaterial, Scene, Vector3 } from 'three';
import type { FurnitureModelConfig } from '../src/furniture/types.js';
import type { RenderContext } from '../src/runtime/context.js';

const deferred = vi.hoisted(() => ({
	prepare: undefined as undefined | (() => Promise<boolean>),
	load: undefined as undefined | ((id: number) => Promise<void>),
	release: vi.fn(),
}));
vi.mock('../src/furniture/assetStore.js', () => ({
	FurnitureAssetCache: class {
		dispose() {}
		clearUnused() {}
	},
	FurnitureAssetStore: class {
		configs: Map<number, FurnitureModelConfig>;
		geometry = new BoxGeometry();
		material = new MeshBasicMaterial();

		constructor(_catalog: unknown, configs: Map<number, FurnitureModelConfig>) { this.configs = configs; }

		acquire(id: number) {
			return { ready: (deferred.load?.(id) ?? Promise.resolve()).then(() => ({ config: this.configs.get(id)!, data: {
				geometry: this.geometry, mergedMaterial: this.material, plainMaterials: [this.material],
				boundingBox: new Box3(new Vector3(-.5, -.5, -.5), new Vector3(.5, .5, .5)),
			} })), release: vi.fn(() => deferred.release(id)) };
		}

		dispose() {
			this.geometry.dispose();
			this.material.dispose();
		}

		clearUnused() {}
	},
}));
import { createFurnitureLayer } from '../src/furniture/layer.js';

const manifest = { schemaVersion: 5, defaults: {
	mesh: { rotation: [0, 0, 0, 1], scale: [1, 1, 1], trans: [0, 0, 0] },
	furniture: { root_offset: [0, 0, 0], assembled: false },
}, materials: {}, textures: {}, rawResources: {}, bundles: {}, furniture: [{
	id: 1, componentCount: 2, customData: [0, 0], colorings: {}, meshes: [],
}] };

function context() {
	return { scene: new Scene(), renderer: { shadowMap: {}, capabilities: { maxTextureSize: 4096 } },
		invalidate: vi.fn(),
		invalidateShadows: vi.fn(),

		onBeforeRender: () => () => {},

		onDispose: () => () => {},

		prepare: () => deferred.prepare?.() ?? Promise.resolve(true),

		disposed: false,
	} as unknown as RenderContext;
}

afterEach(() => {
	vi.unstubAllGlobals();
	deferred.prepare = undefined;
	deferred.load = undefined;
	deferred.release.mockClear();
});

it('updates and removes individual slots without replacing untouched batches', async () => {
	vi.stubGlobal('fetch', async () => ({ ok: true,

		json: async () => manifest }));

	const render = context();
	const layer = createFurnitureLayer(render, { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	await layer.replaceAll(Array.from({ length: 1000 }, (_, index) => ({
		id: String(index), assetId: 1170000001, matrix: new Matrix4().makeTranslation(index, 0, 0),
	})));

	const mesh = layer.getInstance('0')!.mesh;
	vi.mocked(render.invalidateShadows).mockClear();
	layer.updateMatrices([{ id: '400', matrix: new Matrix4().makeTranslation(2000, 0, 0) }]);
	expect(render.invalidateShadows).toHaveBeenCalledOnce();
	vi.mocked(render.invalidateShadows).mockClear();
	layer.updateDyes([{ id: '400', values: [26, 158] }]);
	expect(render.invalidateShadows).toHaveBeenCalledOnce();
	vi.mocked(render.invalidateShadows).mockClear();
	layer.remove(['400']);
	expect(render.invalidateShadows).toHaveBeenCalledOnce();
	expect(layer.getInstance('999')?.index).toBe(400);
	expect(layer.getInstance('400')).toBeUndefined();
	expect(layer.getInstance('0')?.mesh).toBe(mesh);
	expect(mesh.count).toBe(999);
	layer.dispose();
	expect(layer.root.parent).toBeNull();
});

it('keeps the live scene intact when a candidate replacement is cancelled', async () => {
	vi.stubGlobal('fetch', async () => ({ ok: true,

		json: async () => manifest }));

	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	await layer.replaceAll([{ id: 'old', assetId: 1170000001, matrix: new Matrix4() }]);

	const mesh = layer.getInstance('old')!.mesh;
	let finish!: (value: boolean) => void;
	deferred.prepare = () => new Promise((resolve) => { finish = resolve; });

	const controller = new AbortController();
	const replacement = layer.replaceAll([{ id: 'new', assetId: 1170000001, matrix: new Matrix4() }], { signal: controller.signal });
	const rejected = expect(replacement).rejects.toThrow();
	await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
	controller.abort();
	finish(false);
	await rejected;
	expect(layer.getInstance('old')?.mesh).toBe(mesh);
	expect(layer.getInstance('new')).toBeUndefined();
	layer.dispose();
});

it('retains edits and removals made while a tier candidate is preparing', async () => {
	vi.stubGlobal('fetch', async () => ({ ok: true,

		json: async () => manifest }));

	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	await layer.replaceAll(['a', 'b'].map(id => ({ id, assetId: 1170000001, matrix: new Matrix4() })));

	let finish!: (value: boolean) => void;
	deferred.prepare = () => new Promise(resolve => { finish = resolve; });

	const switching = layer.setTiers({ model: 'full', material: 'lite' });
	await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
	layer.updateMatrices([{ id: 'a', matrix: new Matrix4().makeTranslation(42, 0, 0) }]);
	layer.updateDyes([{ id: 'a', values: [26, 158] }]);
	layer.remove(['b']);
	finish(true);
	await switching;

	const instance = layer.getInstance('a')!;
	const matrix = new Matrix4();
	instance.mesh.getMatrixAt(instance.index, matrix);
	expect(matrix.elements[12]).toBe(42);
	expect(layer.getInstance('b')).toBeUndefined();
	expect(instance.mesh.count).toBe(1);
	layer.dispose();
});

it('does not resurrect an ID removed during an asynchronous upsert', async () => {
	vi.stubGlobal('fetch', async () => ({ ok: true,

		json: async () => manifest }));

	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');

	let finish!: (value: boolean) => void;
	deferred.prepare = () => new Promise(resolve => { finish = resolve; });

	const pending = layer.upsert([{ id: 'a', assetId: 1170000001, matrix: new Matrix4() }]);
	await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
	layer.remove(['a']);
	finish(true);
	await pending;
	expect(layer.getInstance('a')).toBeUndefined();
	layer.dispose();
});

it('preserves live batches when preparation progress cancels an upsert', async () => {
	const data = structuredClone(manifest);
	data.furniture.push({ ...data.furniture[0]!, id: 2 });
	vi.stubGlobal('fetch', async () => ({ ok: true,

		json: async () => data }));

	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	await layer.replaceAll([{ id: 'old', assetId: 1170000001, matrix: new Matrix4() }]);

	const before = layer.getInstance('old')!;
	const controller = new AbortController();
	await expect(layer.upsert([
		{ id: 'old', assetId: 1170000001, matrix: new Matrix4().makeTranslation(42, 0, 0) },
		{ id: 'new', assetId: 1170000002, matrix: new Matrix4() },
	], {
		signal: controller.signal,

		onProgress: ({ phase }) => { if (phase === 'preparing') controller.abort(); },
	})).rejects.toThrow();

	const matrix = new Matrix4();
	before.mesh.getMatrixAt(before.index, matrix);
	expect(matrix.elements[12]).toBe(0);
	expect(layer.getInstance('old')!.mesh).toBe(before.mesh);
	expect(layer.getInstance('new')).toBeUndefined();
	expect(layer.batches.size).toBe(1);
	layer.dispose();
});

it('reuses empty batches and shadow materials across scheme switches until cache eviction', async () => {
	const data = structuredClone(manifest);
	data.furniture.push({ ...data.furniture[0]!, id: 2 });
	vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => data }));
	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	await layer.replaceAll([{ id: 'a', assetId: 1170000001, matrix: new Matrix4().makeTranslation(1000, 0, 0) }]);
	const mesh = layer.getInstance('a')!.mesh;
	const depth = mesh.customDepthMaterial!;
	const released = vi.fn();
	depth.addEventListener('dispose', released);

	layer.remove(['a']);
	expect(layer.batches.size).toBe(0);
	expect(mesh.parent).toBeNull();
	expect(mesh.count).toBe(0);
	expect(released).not.toHaveBeenCalled();
	await layer.replaceAll([{ id: 'b', assetId: 1170000002, matrix: new Matrix4() }]);
	layer.remove(['b']);
	await layer.replaceAll([{ id: 'a2', assetId: 1170000001, matrix: new Matrix4().makeTranslation(-10, 0, 0), customData: [26, 158] }]);

	expect(layer.getInstance('a2')!.mesh).toBe(mesh);
	expect(mesh.customDepthMaterial).toBe(depth);
	expect(mesh.boundingBox!.max.x).toBeCloseTo(-9.5);
	expect(layer.getInstance('a')).toBeUndefined();
	expect(layer.getInstance('b')).toBeUndefined();
	expect(released).not.toHaveBeenCalled();

	layer.remove(['a2']);
	layer.clearUnused();
	expect(released).toHaveBeenCalledOnce();
	await layer.replaceAll([{ id: 'a3', assetId: 1170000001, matrix: new Matrix4() }]);
	expect(layer.getInstance('a3')!.mesh).not.toBe(mesh);
	layer.dispose();
});

it('settles every queued preparation before releasing a failed candidate', async () => {
	const data = structuredClone(manifest);
	data.furniture.push({ ...data.furniture[0]!, id: 2 });
	vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => data }));
	const finishes: Array<(ready: boolean) => void> = [];
	deferred.prepare = () => new Promise(resolve => { finishes.push(resolve); });
	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	const controller = new AbortController();
	let settled = false;
	const pending = layer.replaceAll([
		{ id: 'a', assetId: 1170000001, matrix: new Matrix4() },
		{ id: 'b', assetId: 1170000002, matrix: new Matrix4() },
	], { signal: controller.signal });
	void pending.then(() => { settled = true; }, () => { settled = true; });
	await vi.waitFor(() => expect(finishes).toHaveLength(2));
	controller.abort();
	finishes[0]!(false);
	await Promise.resolve();
	await Promise.resolve();
	expect(settled).toBe(false);
	finishes[1]!(false);
	await expect(pending).rejects.toThrow();
	expect(layer.batches.size).toBe(0);
	layer.dispose();
});

it('uploads the full color reset when a cached batch has pending partial color updates', async () => {
	vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => manifest }));
	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	await layer.replaceAll(['a', 'b'].map(id => ({ id, assetId: 1170000001, matrix: new Matrix4() })));
	const mesh = layer.getInstance('a')!.mesh;
	const colors = mesh.instanceColor!;
	colors.array.fill(0.25);
	colors.addUpdateRange(0, 3);
	colors.needsUpdate = true;

	layer.remove(['a', 'b']);
	await layer.replaceAll(['c', 'd'].map(id => ({ id, assetId: 1170000001, matrix: new Matrix4() })));
	expect(layer.getInstance('c')!.mesh).toBe(mesh);
	expect(colors.array.every(value => value === 1)).toBe(true);
	// A later single-instance edit must not hide the reset of the other slots.
	colors.addUpdateRange(0, 3);
	expect(colors.updateRanges).toContainEqual({ start: 0, count: colors.array.length });
	layer.dispose();
});

it.each(['replace', 'preload'])('prepares a ready asset while another is still loading (%s)', async (operation) => {
	const data = structuredClone(manifest);
	data.furniture.push({ ...data.furniture[0]!, id: 2 });
	vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => data }));
	let finishLoad!: () => void;
	const slow = new Promise<void>(resolve => { finishLoad = resolve; });
	deferred.load = id => id === 1170000002 ? slow : Promise.resolve();
	const render = context();
	const prepare = vi.spyOn(render, 'prepare');
	const layer = createFurnitureLayer(render, { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	const items = [1, 2].map(id => ({ id: String(id), assetId: 1170000000 + id, matrix: new Matrix4() }));
	const progress: Array<{ phase: string; completed: number }> = [];
	const task = { onProgress: (value: { phase: string; completed: number }) => { progress.push(value); } };
	const pending = operation === 'replace' ? layer.replaceAll(items, task) : layer.load(items.map(item => item.assetId), task);
	await vi.waitFor(() => expect(progress).toContainEqual(expect.objectContaining({ phase: 'preparing', completed: 1 })));
	expect(prepare).toHaveBeenCalledTimes(1);
	expect(layer.root.children).toHaveLength(0);
	expect(layer.getInstance('1')).toBeUndefined();
	const warmed = prepare.mock.calls[0]![0];
	finishLoad();
	await pending;
	expect(progress.map(value => `${value.phase}:${value.completed}`).slice(0, 4)).toEqual([
		'loading:1', 'preparing:1', 'loading:2', 'preparing:2',
	]);
	if (operation === 'preload') {
		expect(layer.root.children).toHaveLength(0);
		await layer.load(items.map(item => item.assetId));
		expect(prepare).toHaveBeenCalledTimes(2);
		await layer.replaceAll(items);
	}
	expect(layer.getInstance('1')!.mesh).toBe(warmed);
	expect(layer.root.children).toHaveLength(2);
	layer.dispose();
});

it('bounds concurrent preload preparation and cancels queued work before admission', async () => {
	const data = structuredClone(manifest);
	data.furniture = Array.from({ length: 20 }, (_, index) => ({ ...data.furniture[0]!, id: index + 1 }));
	vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => data }));
	const finishes: Array<(ready: boolean) => void> = [];
	deferred.prepare = () => new Promise(resolve => { finishes.push(resolve); });
	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	const controller = new AbortController();
	const pending = layer.load(data.furniture.map(item => 1170000000 + item.id), { signal: controller.signal });
	const rejected = expect(pending).rejects.toThrow('cancelled');
	await vi.waitFor(() => expect(finishes).toHaveLength(16));
	finishes[0]!(true);
	await vi.waitFor(() => expect(finishes).toHaveLength(17));
	controller.abort();
	finishes.slice(1).forEach(finish => finish(false));
	await rejected;
	expect(finishes).toHaveLength(17);
	expect(layer.root.children).toHaveLength(0);
	layer.clearUnused();
	layer.dispose();
});

it.each(['loading', 'preparing'])('rejects a preload cancelled by its %s progress callback', async (phase) => {
	vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => manifest }));
	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	const controller = new AbortController();
	await expect(layer.load([1170000001], {
		signal: controller.signal,
		onProgress: progress => { if (progress.phase === phase) controller.abort(new Error('stop preload')); },
	})).rejects.toThrow('stop preload');
	layer.clearUnused();
	layer.dispose();
});

it('keeps preloads alive during cache eviction until GPU cancellation has drained', async () => {
	vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => manifest }));
	let finish!: (ready: boolean) => void;
	deferred.prepare = () => new Promise(resolve => { finish = resolve; });
	const render = context();
	const prepare = vi.spyOn(render, 'prepare');
	const layer = createFurnitureLayer(render, { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	const controller = new AbortController();
	const loading = layer.load([1170000001], { signal: controller.signal });
	const rejected = expect(loading).rejects.toThrow('cancelled');
	await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
	const dispose = vi.spyOn(prepare.mock.calls[0]![0], 'dispose');
	layer.clearUnused();
	expect(dispose).not.toHaveBeenCalled();
	expect(deferred.release).not.toHaveBeenCalled();
	controller.abort();
	layer.clearUnused();
	expect(dispose).not.toHaveBeenCalled();
	expect(deferred.release).not.toHaveBeenCalled();
	finish(false);
	await rejected;
	expect(deferred.release).toHaveBeenCalledWith(1170000001);
	layer.clearUnused();
	expect(dispose).toHaveBeenCalledOnce();
	layer.dispose();
});

it('retains a shared preload while an earlier caller is still preparing it', async () => {
	vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => manifest }));
	const finishes: Array<(ready: boolean) => void> = [];
	deferred.prepare = () => new Promise(resolve => { finishes.push(resolve); });
	const render = context();
	const prepare = vi.spyOn(render, 'prepare');
	const layer = createFurnitureLayer(render, { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	const first = layer.load([1170000001]);
	await vi.waitFor(() => expect(finishes).toHaveLength(1));
	const second = layer.load([1170000001]);
	await vi.waitFor(() => expect(finishes).toHaveLength(2));
	const mesh = prepare.mock.calls[0]![0];
	expect(prepare.mock.calls[1]![0]).toBe(mesh);
	const dispose = vi.spyOn(mesh, 'dispose');
	finishes[1]!(true);
	await second;
	layer.clearUnused();
	expect(dispose).not.toHaveBeenCalled();
	expect(deferred.release).not.toHaveBeenCalled();
	finishes[0]!(true);
	await first;
	layer.clearUnused();
	expect(dispose).toHaveBeenCalledOnce();
	layer.dispose();
});
