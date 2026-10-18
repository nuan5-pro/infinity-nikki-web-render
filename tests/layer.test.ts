import { afterEach, expect, it, vi } from 'vitest';
import { Box3, BoxGeometry, Matrix4, MeshBasicMaterial, Scene, Vector3 } from 'three';
import type { FurnitureModelConfig } from '../src/furniture/types.js';
import type { RenderContext } from '../src/runtime/context.js';

const deferred = vi.hoisted(() => ({ prepare: undefined as undefined | (() => Promise<boolean>) }));
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
			return { ready: Promise.resolve({ config: this.configs.get(id)!, data: {
				geometry: this.geometry, mergedMaterial: this.material, plainMaterials: [this.material],
				boundingBox: new Box3(new Vector3(-.5, -.5, -.5), new Vector3(.5, .5, .5)),
			} }), release: vi.fn() };
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

		onBeforeRender: () => () => {},

		onDispose: () => () => {},

		prepare: () => deferred.prepare?.() ?? Promise.resolve(true),

		disposed: false,
	} as unknown as RenderContext;
}

afterEach(() => {
	vi.unstubAllGlobals();
	deferred.prepare = undefined;
});

it('updates and removes individual slots without replacing untouched batches', async () => {
	vi.stubGlobal('fetch', async () => ({ ok: true,

		json: async () => manifest }));

	const layer = createFurnitureLayer(context(), { decoderPath: '/draco/' });
	await layer.setup('/assets/');
	await layer.replaceAll(Array.from({ length: 1000 }, (_, index) => ({
		id: String(index), assetId: 1170000001, matrix: new Matrix4().makeTranslation(index, 0, 0),
	})));

	const mesh = layer.getInstance('0')!.mesh;
	layer.updateMatrices([{ id: '400', matrix: new Matrix4().makeTranslation(2000, 0, 0) }]);
	layer.updateDyes([{ id: '400', values: [26, 158] }]);
	layer.remove(['400']);
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
