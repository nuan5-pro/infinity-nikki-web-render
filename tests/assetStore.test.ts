import { expect, it, vi } from 'vitest';
import { BoxGeometry, Float32BufferAttribute, MeshStandardMaterial, type WebGLRenderer } from 'three';
import { FurnitureAssetCache, FurnitureAssetStore } from '../src/furniture/assetStore.js';
import type { GeometryData } from '../src/furniture/geometry.js';
import * as prepared from '../src/furniture/prepared.js';
import type { FurnitureDB, FurnitureModelConfig } from '../src/furniture/types.js';
import { FurnitureResources } from '../src/resources/resources.js';

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
