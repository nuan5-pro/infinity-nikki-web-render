import { expect, it, vi } from 'vitest';
import { BoxGeometry, Float32BufferAttribute, MeshStandardMaterial, type WebGLRenderer } from 'three';
import { FurnitureAssetCache, FurnitureAssetStore } from '../src/furniture/assetStore.js';
import type { GeometryData } from '../src/furniture/geometry.js';
import * as geometryModule from '../src/furniture/geometry.js';
import * as prepared from '../src/furniture/prepared.js';
import type { FurnitureDB, FurnitureModelConfig } from '../src/furniture/types.js';
import { FurnitureResources } from '../src/resources/resources.js';

it('releases source models after assembly while preserving concurrent leases and warm cache reuse', async () => {
	const cache = new FurnitureAssetCache();
	const model = { meshEntries: [], dispose: vi.fn() };
	const load = vi.spyOn(cache, 'load').mockResolvedValue(model);
	const configs = [1, 2].map(id => ({ id, meshes: [{
		models: { full: { path: 'models-full/shared-0123456789abcdef.glb', bytes: 1 } }, slots: [],
	}] }) as FurnitureModelConfig);
	const store = new FurnitureAssetStore({} as FurnitureDB, new Map(configs.map(config => [config.id, config])), '/',
		{ model: 'full', material: 'full' }, {} as WebGLRenderer, cache, '/draco/');
	const finish = new Map<number, () => void>();
	const assembled = new Map<number, GeometryData>();
	vi.spyOn(geometryModule, 'processGeometryForItem').mockImplementation(async (id, config, selection, getMesh) => {
		const mesh = await getMesh(config.meshes[0]!, selection);
		await new Promise<void>(resolve => { finish.set(id, resolve); });
		mesh?.dispose();
		const geometry = new BoxGeometry();
		geometry.setAttribute('nuanSourceMesh', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count), 1));
		const data = { geometry, plainMaterials: [] } as unknown as GeometryData;
		assembled.set(id, data);
		return data;
	});
	try {
		const first = store.acquire(1);
		const second = store.acquire(2);
		await vi.waitFor(() => expect(finish.size).toBe(2));
		finish.get(1)!();
		const asset = await first.ready;
		cache.clearUnused();
		expect(model.dispose).not.toHaveBeenCalled();
		expect(cache.models.hasUnused).toBe(false);

		finish.get(2)!();
		await second.ready;
		expect(cache.models.hasUnused).toBe(true);
		const warm = cache.models.acquire('0123456789abcdef:1', signal => cache.load('/', '/draco/', configs[0]!.meshes[0]!.models.full!, signal));
		expect(await warm.ready).toBe(model);
		expect(load).toHaveBeenCalledOnce();
		warm.release();
		const disposeFinal = vi.spyOn(asset.data.geometry, 'dispose');
		cache.clearUnused();
		expect(model.dispose).toHaveBeenCalledOnce();
		expect(disposeFinal).not.toHaveBeenCalled();
		expect(asset.data).toBe(assembled.get(1));
		first.release();
		second.release();
	} finally {
		store.dispose();
		cache.dispose();
		vi.restoreAllMocks();
	}
});

it('disposes prepared geometry that finishes restoring after its last consumer cancels', async () => {
	const cache = new FurnitureAssetCache();
	const config = { id: 1, prepared: { 'full:full': { path: 'prepared.bin', bytes: 1 } } } as FurnitureModelConfig;
	const store = new FurnitureAssetStore({} as FurnitureDB, new Map([[1, config]]), '/',
		{ model: 'full', material: 'full' }, {} as WebGLRenderer, cache, '/draco/');
	const geometry = new BoxGeometry();
	geometry.setAttribute('nuanSourceMesh', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count), 1));
	const material = new MeshStandardMaterial();
	const disposeGeometry = vi.spyOn(geometry, 'dispose');
	const disposeMaterial = vi.spyOn(material, 'dispose');
	const process = vi.spyOn(cache.geometry, 'prepare');
	let complete!: (data: GeometryData) => void;
	let started!: () => void;
	const restoring = new Promise<void>(resolve => { started = resolve; });
	vi.spyOn(FurnitureResources.prototype, 'readAsset').mockResolvedValue(new ArrayBuffer(0));
	vi.spyOn(prepared, 'preparedGeometryInput').mockResolvedValue('input');
	vi.spyOn(prepared, 'restorePreparedGeometry').mockImplementation(() => {
		started();
		return new Promise(resolve => { complete = resolve; });
	});
	try {
		const lease = store.acquire(1);
		const rejected = expect(lease.ready).rejects.toThrow('Geometry load cancelled');
		await restoring;
		lease.release();
		complete({ geometry, plainMaterials: [material] } as GeometryData);
		await rejected;
		expect(process).not.toHaveBeenCalled();
		expect(disposeGeometry).toHaveBeenCalledOnce();
		expect(disposeMaterial).toHaveBeenCalledOnce();
	} finally {
		store.dispose();
		cache.dispose();
		vi.restoreAllMocks();
	}
});
