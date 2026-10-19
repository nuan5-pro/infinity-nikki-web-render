import { Group, Matrix4, type Box3, type Intersection, type Raycaster } from 'three';
import type { RenderContext } from '../runtime/context.js';
import type { AssetLease } from '../resources/leaseCache.js';
import { createTaskQueue } from '../resources/taskQueue.js';
import { FurnitureAssetCache, FurnitureAssetStore, type LoadedFurniture } from './assetStore.js';
import { FurnitureBatch } from './batch.js';
import { decodeFurnitureCatalog } from './manifest.js';
import { validatePaperCustomData, type PaperCustomData } from './customData.js';
import type { FurnitureAssetSelection, FurnitureDB, FurnitureModelConfig } from './types.js';
import { MAX_RENDER_INSTANCES } from '../helpers/instanceCapacity.js';

export interface FurnitureInstance {
	id: string;
	assetId: number;
	matrix: Matrix4;
	customData?: PaperCustomData;
}

export interface FurnitureTask {
	signal?: AbortSignal;
	onProgress?: (progress: { phase: 'loading' | 'preparing' | 'ready'; completed: number; total: number }) => void;
}

export interface FurnitureLayerOptions {
	decoderPath: string;
}

interface InstanceSnapshot {
	id: string;
	assetId: number;
	matrix: Matrix4;
	customData: Uint32Array;
}

interface Entry {
	batch: FurnitureBatch;
	slot: number;
	matrix: Matrix4;
	customData: Uint32Array;
}

interface State {
	store: FurnitureAssetStore;
	batches: Map<number, FurnitureBatch>;
	// Empty batches borrow assets retained by the store until explicit eviction.
	idle: Map<number, FurnitureBatch>;
	leases: Map<number, AssetLease<LoadedFurniture>>;
	records: Map<string, Entry>;
}

interface BatchLease {
	id: number;
	lease: AssetLease<LoadedFurniture>;
}

export function createFurnitureLayer(context: RenderContext, options: FurnitureLayerOptions) {
	if (!options.decoderPath.trim()) throw new Error('Furniture decoderPath is required');

	const decoderPath = options.decoderPath.replace(/\/?$/, '/');
	const root = new Group();
	root.name = 'furniture';
	// Match the native shader and furniture assembly frame.
	root.scale.y = -1;
	context.scene.add(root);

	let catalog: FurnitureDB | undefined;
	let configs = new Map<number, FurnitureModelConfig>();
	let url = '';
	let tiers: FurnitureAssetSelection = { model: 'full', material: 'full' };
	let state: State | undefined;

	const preloads = new Map<number, AssetLease<LoadedFurniture>>();
	const activePreloads = new Map<number, number>();
	const loaded = new Map<number, LoadedFurniture>();

	let generation = 0;
	let disposed = false;
	let configuring = false;
	let active = new AbortController();
	let sequence = Promise.resolve();

	const pending = new Set<AssetLease<LoadedFurniture>>();
	const cache = new FurnitureAssetCache();
	const prepare = createTaskQueue(16);
	const preparedBatches = new WeakSet<FurnitureBatch>();

	const revisions = new Map<string, number>();
	let revision = 0;
	let replacing = false;

	function alive() {
		if (disposed || context.disposed) throw new Error('Furniture layer disposed');
	}

	function changed() {
		context.invalidateShadows();
	}

	function destroy(value: State | undefined, keepStore = false) {
		if (!value) return;

		for (const batch of value.batches.values()) batch.dispose();
		for (const lease of value.leases.values()) lease.release();

		if (!keepStore) {
			for (const batch of value.idle.values()) batch.dispose();
			value.idle.clear();
			value.store.dispose();
		}
	}

	function releasePreloads(keepPending = false) {
		for (const [id, lease] of preloads) {
			if (keepPending && activePreloads.has(id)) continue;
			lease.release();
			preloads.delete(id);
			loaded.delete(id);
		}
	}

	function makeState(selection: FurnitureAssetSelection, reuse?: State): State {
		if (!catalog) throw new Error('Call furniture.setup first');

		return {
			store: reuse?.store ?? new FurnitureAssetStore(catalog, configs, url, selection, context.renderer, cache, decoderPath),
			batches: new Map(),
			idle: reuse?.idle ?? new Map(),
			leases: new Map(),
			records: new Map(),
		};
	}

	function snapshot(items: readonly FurnitureInstance[]): InstanceSnapshot[] {
		if (items.length > MAX_RENDER_INSTANCES) throw new RangeError('Furniture instance budget exceeded');

		const ids = new Set<string>();
		return items.map((item) => {
			if (!item.id || ids.has(item.id)) throw new Error(`Duplicate or empty furniture instance ID: ${item.id}`);

			ids.add(item.id);

			const config = configs.get(item.assetId);
			if (!config) throw new Error(`Unknown furniture asset ${item.assetId}`);

			const values = item.customData ?? config.customData;
			validatePaperCustomData(values, config.componentCount);
			if (!item.matrix.elements.every(Number.isFinite)) throw new Error('Non-finite instance matrix');

			return { ...item, matrix: item.matrix.clone(), customData: Uint32Array.from(values) };
		});
	}

	function writeInstances(target: State, items: InstanceSnapshot[], isCurrent: (id: string) => boolean) {
		for (const item of items) {
			if (!isCurrent(item.id)) continue;
			const batch = target.batches.get(item.assetId)!;
			const old = target.records.get(item.id);
			if (old && old.batch !== batch) removeOne(target, item.id);

			const entry = target.records.get(item.id);
			if (entry) {
				batch.setMatrix(entry.slot, item.matrix);
				batch.data.set(entry.slot, item.customData);
				entry.matrix.copy(item.matrix);
				entry.customData = item.customData;
			} else {
				const slot = batch.add(item.id, item.matrix, item.customData);
				target.records.set(item.id, { batch, slot, matrix: item.matrix, customData: item.customData });
			}
		}
	}

	async function populate(
		target: State,
		items: InstanceSnapshot[],
		task: FurnitureTask,
		signal: AbortSignal,
		isCurrent: (id: string) => boolean = () => true,
	) {
		const check = () => {
			alive();
			signal.throwIfAborted();
			task.signal?.throwIfAborted();
		};

		check();

		const counts = new Map<number, number>();
		for (const item of items) counts.set(item.assetId, (counts.get(item.assetId) ?? 0) + 1);

		const ids = [...counts.keys()].filter(id => !target.batches.has(id));
		let completed = 0;
		let prepared = 0;
		let failed = false;
		const acquired: BatchLease[] = [];
		const abort = () => { for (const { lease } of acquired) lease.release(); };
		signal.addEventListener('abort', abort, { once: true });
		task.signal?.addEventListener('abort', abort, { once: true });
		try {
			const results = await Promise.allSettled(ids.map(async (id) => {
				const lease = target.store.acquire(id);
				acquired.push({ id, lease });
				pending.add(lease);

				const asset = await lease.ready;
				check();

				const capacity = Math.max(32, counts.get(id)!);
				const cached = target.idle.get(id);
				const batch = cached ?? new FurnitureBatch(asset, capacity, context.renderer.capabilities.maxTextureSize);
				target.idle.delete(id);
				target.leases.set(id, lease);
				target.batches.set(id, batch);
				if (cached) cached.reuse(capacity);
				task.onProgress?.({ phase: 'loading', completed: ++completed, total: ids.length });
				await prepare(async () => {
					check();
					if (failed) return;
					const ready = await context.prepare(batch.mesh, () => failed || signal.aborted || !!task.signal?.aborted || disposed);
					check();
					if (!ready) throw new Error('Furniture GPU preparation cancelled');
					preparedBatches.add(batch);
					asset.releaseStaging();
					task.onProgress?.({ phase: 'preparing', completed: ++prepared, total: ids.length });
				});
			}).map(operation => operation.catch(error => {
				failed = true;
				throw error;
			})));
			const failure = results.find((result) => result.status === 'rejected');
			if (failure?.status === 'rejected') throw failure.reason;

			check();

			writeInstances(target, items, isCurrent);
			for (const { id, lease } of acquired) {
				const batch = target.batches.get(id);
				if (batch && !batch.ids.length) {
					batch.dispose();
					target.batches.delete(id);
					target.leases.delete(id);
					lease.release();
				}
			}

			check();
		} catch (error) {
			for (const { id, lease } of acquired) {
				target.batches.get(id)?.dispose();
				target.batches.delete(id);
				target.leases.delete(id);
				lease.release();
			}

			throw error;
		} finally {
			for (const { lease } of acquired) pending.delete(lease);

			signal.removeEventListener('abort', abort);
			task.signal?.removeEventListener('abort', abort);
		}
	}

	function removeOne(target: State, id: string) {
		const entry = target.records.get(id);
		if (!entry) return;

		const moved = entry.batch.remove(entry.slot);
		if (moved !== undefined) target.records.get(moved)!.slot = entry.slot;
		target.records.delete(id);
		if (!entry.batch.ids.length) {
			const assetId = entry.batch.asset.config.id;
			entry.batch.clear();
			target.batches.delete(assetId);
			target.idle.set(assetId, entry.batch);
			target.leases.get(assetId)?.release();
			target.leases.delete(assetId);
		}
	}

	const releaseFrame = context.onBeforeRender(() => {
		for (const batch of state?.batches.values() ?? []) batch.flush();
	});

	async function replace(items: readonly FurnitureInstance[], selection: FurnitureAssetSelection, task: FurnitureTask = {}, preserveLive = false) {
		alive();

		const values = snapshot(items);
		const current = ++generation;
		replacing = true;
		revisions.clear();
		active.abort();
		active = new AbortController();

		const signal = active.signal;
		const reused = state && !state.records.size && selection.model === tiers.model && selection.material === tiers.material
			? state : undefined;
		const candidate = makeState(selection, reused);
		try {
			await populate(candidate, values, task, signal);
			signal.throwIfAborted();
			if (generation !== current) throw new Error('Superseded furniture replacement');

			if (preserveLive) {
				for (const [id, entry] of candidate.records) {
					const live = state?.records.get(id);
					if (!live) {
						removeOne(candidate, id);
						continue;
					}

					entry.matrix.copy(live.matrix);
					entry.customData = live.customData.slice();
					entry.batch.setMatrix(entry.slot, live.matrix);
					entry.batch.data.set(entry.slot, live.customData);
				}
			}

			const previous = state;
			state = candidate;
			tiers = { ...selection };
			releasePreloads();
			for (const batch of candidate.batches.values()) root.add(batch.mesh);

			destroy(previous, previous?.store === candidate.store);
			changed();
			task.onProgress?.({ phase: 'ready', completed: items.length, total: items.length });
		} catch (error) {
			destroy(candidate, candidate.store === state?.store);
			throw error;
		} finally {
			if (generation === current) replacing = false;
		}
	}

	const layer = {
		root,

		async setup(resourceRoot: string, task: FurnitureTask = {}) {
			alive();
			if (catalog || configuring) throw new Error('Furniture layer already configured');

			configuring = true;
			try {
				const signal = task.signal ? AbortSignal.any([active.signal, task.signal]) : active.signal;
				const response = await fetch(`${resourceRoot.replace(/\/$/, '')}/manifest.json`, { signal });
				if (!response.ok) throw new Error(`Furniture manifest HTTP ${response.status}`);

				const manifest = await response.json() as FurnitureDB;
				const rows = decodeFurnitureCatalog(manifest);
				alive();
				task.signal?.throwIfAborted();
				configs = new Map(rows.map((row) => [row.id, row]));
				if (configs.size !== rows.length) throw new Error('Duplicate furniture asset ID');

				catalog = manifest;
				url = resourceRoot;
				state = makeState(tiers);
			} finally { configuring = false; }
		},

		async load(ids: readonly number[], task: FurnitureTask = {}) {
			alive();
			if (!state) throw new Error('Call furniture.setup first');

			const owner = state;
			const current = generation;
			const acquired = new Map<number, AssetLease<LoadedFurniture>>();
			const preparing = new Set<AssetLease<LoadedFurniture>>();
			// Keep ready assets alive until their queued GPU work has drained.
			const abort = () => { for (const lease of acquired.values()) if (!preparing.has(lease)) lease.release(); };
			task.signal?.throwIfAborted();
			task.signal?.addEventListener('abort', abort, { once: true });
			active.signal.addEventListener('abort', abort, { once: true });

			const signal = active.signal;
			const check = () => {
				alive();
				task.signal?.throwIfAborted();
				signal.throwIfAborted();
				if (generation !== current) throw new Error('Superseded furniture preload');
			};
			let completed = 0;
			let prepared = 0;
			const uniqueIds = [...new Set(ids)];
			try {
				const results = await Promise.allSettled(uniqueIds.map(async (id) => {
					const lease = owner.store.acquire(id);
					acquired.set(id, lease);
					activePreloads.set(id, (activePreloads.get(id) ?? 0) + 1);
					pending.add(lease);

					const asset = await lease.ready;
					check();
					preparing.add(lease);

					const previous = preloads.get(id);
					if (previous && !pending.has(previous)) previous.release();
					preloads.set(id, lease);
					loaded.set(id, asset);
					task.onProgress?.({ phase: 'loading', completed: ++completed, total: uniqueIds.length });
					check();
					// Keep the same Paper bindings and shadow materials for later instances.
					let batch = owner.batches.get(id) ?? owner.idle.get(id);
					if (!batch) {
						batch = new FurnitureBatch(asset, 32, context.renderer.capabilities.maxTextureSize);
						owner.idle.set(id, batch);
					}
					if (!preparedBatches.has(batch)) {
						const stale = () => signal.aborted || !!task.signal?.aborted || disposed || generation !== current;
						await prepare(async () => {
							if (stale()) throw new Error('Furniture preload cancelled');
							const ready = await context.prepare(batch.mesh, stale);
							if (!ready || stale()) throw new Error('Furniture preload cancelled');
							preparedBatches.add(batch);
							asset.releaseStaging();
						});
					}
					// Cached batches are checked against the current scene when populated.
					task.onProgress?.({ phase: 'preparing', completed: ++prepared, total: uniqueIds.length });
					check();
				}));
				const failure = results.find((result) => result.status === 'rejected');
				if (failure?.status === 'rejected') throw failure.reason;
			} catch (error) {
				for (const lease of acquired.values()) lease.release();

				for (const id of ids) {
					const lease = preloads.get(id);
					if (lease && acquired.get(id) === lease) {
						preloads.delete(id);
						loaded.delete(id);
					}
				}

				throw error;
			} finally {
				for (const [id, lease] of acquired) {
					pending.delete(lease);
					if (preloads.get(id) !== lease) lease.release();
					const count = activePreloads.get(id)! - 1;
					if (count) activePreloads.set(id, count);
					else activePreloads.delete(id);
				}
				signal.removeEventListener('abort', abort);
				task.signal?.removeEventListener('abort', abort);
			}
		},

		replaceAll(items: readonly FurnitureInstance[], task?: FurnitureTask) {
			const operation = replace(items, tiers, task);
			sequence = operation.catch(() => {});
			return operation;
		},

		upsert(items: readonly FurnitureInstance[], task: FurnitureTask = {}) {
			alive();

			const values = snapshot(items);
			const expected = generation;
			const signal = active.signal;
			const request = ++revision;
			for (const item of values) revisions.set(item.id, request);

			const run = sequence.then(async () => {
				if (generation !== expected || !state) throw new Error('Superseded furniture update');

				const additions = values.filter((item) => revisions.get(item.id) === request && !state!.records.has(item.id)).length;
				if (state.records.size + additions > MAX_RENDER_INSTANCES) throw new RangeError('Furniture instance budget exceeded');

				await populate(state, values, task, signal, (id) => revisions.get(id) === request);
				for (const batch of state.batches.values()) if (!batch.mesh.parent) root.add(batch.mesh);

				changed();
				task.onProgress?.({ phase: 'ready', completed: values.length, total: values.length });
			}).finally(() => {
				for (const item of values) if (revisions.get(item.id) === request) revisions.delete(item.id);
			});
			sequence = run.catch(() => {});
			return run;
		},

		updateMatrices(items: readonly { id: string; matrix: Matrix4 }[]) {
			alive();
			for (const { id, matrix } of items) {
				revisions.delete(id);

				const entry = state?.records.get(id);
				if (!entry) continue;
				if (!matrix.elements.every(Number.isFinite)) throw new Error('Non-finite instance matrix');

				entry.matrix.copy(matrix);
				entry.batch.setMatrix(entry.slot, matrix);
			}

			changed();
		},

		updateDyes(items: readonly { id: string; values: PaperCustomData }[]) {
			alive();
			for (const { id, values } of items) {
				revisions.delete(id);

				const entry = state?.records.get(id);
				if (!entry) continue;
				entry.batch.data.set(entry.slot, values);
				entry.customData = Uint32Array.from(values);
			}

			changed();
		},

		remove(ids: readonly string[]) {
			alive();
			for (const id of ids) {
				revisions.delete(id);
				if (state) removeOne(state, id);
			}

			changed();
		},

		async setTiers(selection: FurnitureAssetSelection, task: FurnitureTask = {}) {
			alive();
			if (!replacing && selection.model === tiers.model && selection.material === tiers.material) return;

			const items = [...state?.records.entries() ?? []].map(([id, entry]) => ({
				id, assetId: entry.batch.asset.config.id, matrix: entry.matrix, customData: entry.customData,
			}));
			const operation = replace(items, selection, task, true);
			sequence = operation.catch(() => {});
			await operation;
		},

		getModelBounds(id: number): Box3 | undefined {
			return (state?.batches.get(id)?.asset ?? state?.idle.get(id)?.asset ?? loaded.get(id))?.data.boundingBox.clone();
		},

		/** Cached furniture types/materials and renderer-wide linked programs; counts, not bytes. */
		getResourceStats() {
			const stats = state?.store.getResourceStats() ?? { models: 0, materials: 0, canClearCache: false };
			const unusedPreloads = [...preloads.keys()].some(id => !activePreloads.has(id) && !state?.batches.has(id));
			return {
				...stats,
				canClearCache: stats.canClearCache || unusedPreloads || cache.hasUnused,
				shaders: context.renderer.info.programs?.length ?? 0,
			};
		},

		clearUnused() {
			alive();
			releasePreloads(true);
			for (const [id, batch] of state?.idle ?? []) {
				if (activePreloads.has(id)) continue;
				batch.dispose();
				state!.idle.delete(id);
			}
			state?.store.clearUnused();
			cache.clearUnused();
		},

		get batches() { return new Map([...state?.batches.entries() ?? []].map(([id, batch]) => [id, batch.mesh])); },

		get availableTiers() {
			const models = [...configs.values()];
			const hasLite = models.length > 0 && models.every(config => config.meshes.every(mesh => mesh.models.lite));
			return { model: hasLite ? ['full', 'lite'] : ['full'], material: ['full', 'lite'] };
		},

		getConfig(id: number) { return configs.get(id); },

		getBatchInstances(id: number): readonly string[] { return state?.batches.get(id)?.ids.slice() ?? []; },

		getInstance(id: string) {
			const entry = state?.records.get(id);
			return entry ? { mesh: entry.batch.mesh, index: entry.slot } : undefined;
		},

		pick(raycaster: Raycaster): Array<Intersection & { id: string }> {
			const hits: Array<Intersection & { id: string }> = [];
			for (const batch of state?.batches.values() ?? []) {
				batch.flush();
				for (const hit of raycaster.intersectObject(batch.mesh, false)) {
					const id = hit.instanceId === undefined ? undefined : batch.ids[hit.instanceId];
					if (id !== undefined) hits.push({ ...hit, id });
				}
			}

			return hits.sort((a, b) => a.distance - b.distance);
		},

		dispose() {
			if (disposed) return;

			disposed = true;
			generation++;
			active.abort();
			for (const lease of pending) lease.release();

			pending.clear();
			revisions.clear();
			releasePreloads();
			releaseFrame();
			releaseContext();
			destroy(state);
			cache.dispose();
			state = undefined;
			root.removeFromParent();
			changed();
		},
	};

	const releaseContext = context.onDispose(layer.dispose);
	return layer;
}

export type FurnitureLayer = ReturnType<typeof createFurnitureLayer>;
