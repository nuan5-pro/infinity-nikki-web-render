import type { WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { AssetLeaseCache, type AssetLease } from '../resources/leaseCache.js';
import { FurnitureResourceCache, FurnitureResources } from '../resources/resources.js';
import { createTaskQueue } from '../resources/taskQueue.js';
import { resolveFurnitureModel, furnitureAssetKey } from './manifest.js';
import {
	assembleMeshAsset,
	createMaterialAssetData,
	createModelAssetData,
	loadGLBAsset,
	type MaterialAssetData,
	type ModelAssetData,
} from './assets.js';
import { processGeometryForItem, type GeometryData } from './geometry.js';
import { preparedGeometryInput, restorePreparedGeometry } from './prepared.js';
import { applyHomeObjectLightDefault } from './lightDefault.js';
import { disposeNNClothResources } from '../materials/nncloth/nnclothMaterial.js';
import { disposeWaterFxResources } from '../materials/water/waterFxAsset.js';
import { disposeFoliageCycleAtlases } from '../materials/foliage/foliageShader.js';
import { disposeRockProjectionCollections } from '../materials/layered/rockProjectionCollectionTexture.js';
import type { FurnitureAssetSelection, FurnitureDB, FurnitureModelConfig } from './types.js';

export interface LoadedFurniture {
	config: FurnitureModelConfig
	data: GeometryData
	dispose(): void
}

export class FurnitureAssetCache {
	readonly resources = new FurnitureResourceCache();
	readonly models = new AssetLeaseCache<ModelAssetData>((asset) => asset.dispose(), true);
	private decoders = new Map<string, { loader: GLTFLoader; draco: DRACOLoader; pending: number }>();
	private disposed = false;

	clearUnused(): void {
		this.models.clearUnused();
		this.resources.clearUnused();
	}

	async load(root: string, decoderPath: string, asset: Parameters<typeof loadGLBAsset>[1], signal: AbortSignal) {
		if (this.disposed) throw new Error('Furniture asset cache disposed');

		const path = decoderPath;
		let owner = this.decoders.get(path);
		if (!owner) {
			const draco = new DRACOLoader().setDecoderPath(path);
			owner = { draco, loader: new GLTFLoader().setDRACOLoader(draco), pending: 0 };
			this.decoders.set(path, owner);
		}

		owner.pending++;
		try {
			return createModelAssetData(await loadGLBAsset(owner.loader, asset, signal, root));
		} finally {
			owner.pending--;
			// Draco worker termination does not reject its parse promises. Let submitted
			// parses settle, then release the owner even if its last consumer cancelled.
			if (this.disposed && !owner.pending) owner.draco.dispose();
		}
	}

	dispose() {
		if (this.disposed) return;

		this.disposed = true;
		this.models.clear();
		this.resources.dispose();
		for (const owner of this.decoders.values()) if (!owner.pending) owner.draco.dispose();

		this.decoders.clear();
	}
}

export class FurnitureAssetStore {
	private furniture = new AssetLeaseCache<LoadedFurniture>((asset) => asset.dispose(), true);
	private loadModel = createTaskQueue(6);
	private build = createTaskQueue(4);
	private disposed = false;

	private catalog: FurnitureDB;
	private configs: Map<number, FurnitureModelConfig>;
	private root: string;
	readonly tiers: FurnitureAssetSelection;
	private renderer: WebGLRenderer;
	private cache: FurnitureAssetCache;
	private decoderPath: string;

	constructor(
		catalog: FurnitureDB,
		configs: Map<number, FurnitureModelConfig>,
		root: string,
		tiers: FurnitureAssetSelection,
		renderer: WebGLRenderer,
		cache: FurnitureAssetCache,
		decoderPath: string,
	) {
		this.catalog = catalog;
		this.configs = configs;
		this.root = root;
		this.tiers = tiers;
		this.renderer = renderer;
		this.cache = cache;
		this.decoderPath = decoderPath;
	}

	acquire(id: number): AssetLease<LoadedFurniture> {
		if (this.disposed) throw new Error('Furniture asset store disposed');

		const config = this.configs.get(id);
		if (!config) throw new Error(`Furniture ${id} is absent from the manifest`);

		return this.furniture.acquire(String(id), (signal) => this.build(async () => {
			signal.throwIfAborted();

			const resources = new FurnitureResources(this.catalog, this.root, this.cache.resources);
			resources.renderer = this.renderer;

			const modelLeases = new Map<string, AssetLease<ModelAssetData>>();
			const materials = new Map<string, Promise<MaterialAssetData>>();
			const owned = new Set<MaterialAssetData>();
			let data: GeometryData | undefined;
			let disposed = false;

			const dispose = () => {
				if (disposed) return;

				disposed = true;
				signal.removeEventListener('abort', dispose);
				if (data) {
					data.geometry.dispose();
					for (const material of new Set(data.plainMaterials)) material.dispose();
				}

				for (const material of owned) material.dispose();

				for (const lease of modelLeases.values()) lease.release();

				disposeNNClothResources(resources);
				disposeWaterFxResources(resources);
				disposeFoliageCycleAtlases(resources);
				disposeRockProjectionCollections(resources);
				resources.dispose();
			};

			signal.addEventListener('abort', dispose, { once: true });

			const getMaterial = (key: string): Promise<MaterialAssetData> => {
				let pending = materials.get(key);
				if (!pending) {
					const definition = this.catalog.materials[key];
					if (!definition) throw new Error(`Missing material ${key}`);

					pending = createMaterialAssetData(definition, resources, this.tiers.material).then((asset) => {
						if (disposed) {
							asset.dispose();
							throw new Error('Material load cancelled');
						}

						owned.add(asset);
						return asset;
					});
					materials.set(key, pending);
				}

				return pending;
			};

			try {
				const prepared = config.prepared?.[`${this.tiers.model}:${this.tiers.material}`];
				data = prepared
					? await restorePreparedGeometry(await resources.readAsset(prepared),
						await preparedGeometryInput(config, this.tiers, this.catalog), getMaterial)
					: await processGeometryForItem(id, config, this.tiers, async (mesh) => {
						signal.throwIfAborted();

						const asset = resolveFurnitureModel(mesh, this.tiers);
						const key = furnitureAssetKey(asset);
						let lease = modelLeases.get(key);
						if (!lease) {
							lease = this.cache.models.acquire(key, (signal) => this.loadModel(async () => {
								signal.throwIfAborted();
								return this.cache.load(this.root, this.decoderPath, asset, signal);
							}));
							modelLeases.set(key, lease);
						}

						const [model, entries] = await Promise.all([
							lease.ready,
							Promise.all([...new Set(mesh.slots)].map(async (key) => [key, await getMaterial(key)] as const)),
						]);
						signal.throwIfAborted();
						return assembleMeshAsset(model, mesh, new Map(entries));
					});
				if (!data) throw new Error(`Furniture ${id} has no renderable geometry`);
				if (!data.geometry.hasAttribute('nuanSourceMesh')) throw new Error('Prepared geometry lacks original component indices');

				if (disposed) {
					data.geometry.dispose();
					for (const material of new Set(data.plainMaterials)) material.dispose();

					throw new Error('Geometry load cancelled');
				}

				applyHomeObjectLightDefault(config, data.plainMaterials, data.meshBaseNames, data.slotMeshIndices);
				return { config, data, dispose };
			} catch (error) {
				dispose();
				throw error;
			}
		}));
	}

	clearUnused(): void { this.furniture.clearUnused(); }

	dispose(): void {
		if (this.disposed) return;

		this.disposed = true;
		this.furniture.clear();
	}
}
