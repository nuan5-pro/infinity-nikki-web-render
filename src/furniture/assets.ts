import {
	Matrix4,
	Mesh,
	MeshStandardMaterial,
	TangentSpaceNormalMap,
	type BufferGeometry,
	type Material,
} from 'three';
import { type GLTF, type GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type {
	FurnitureAsset,
	FurnitureMaterialDefinition,
	FurnitureMeshConfig,
	ModelAssetProfile,
} from './types.js';
import {
	buildMaterialRegistryFromDefinition,
	disposeMaterialRegistry,
	resolveMaterialBaseName,
	cloneSourceMaterialForItem,
	type MaterialRegistry,
} from '../materials/factory.js';
import { assertNNClothMaterialAdmission, bindNNClothResources } from '../materials/nncloth/nnclothMaterial.js';
import { assertWaterFxMaterialAdmission, bindWaterFxResources } from '../materials/water/waterFxAsset.js';
import { createSourceMaterial } from '../materials/definition.js';
import { fetchFurnitureAsset, type FurnitureResources } from '../resources/resources.js';
import { furnitureAssetKey } from './manifest.js';
import { bindFoliageCycleAtlas, readFurnitureFoliage } from '../materials/foliage/foliageShader.js';
import { bindRockProjectionCollection } from '../materials/layered/rockProjectionCollectionTexture.js';
import { readFurnitureLayered } from '../materials/layered/layeredShader.js';

interface ModelMeshEntry {
	geometry: BufferGeometry
	localMatrix: Matrix4
	slot: number
	name: string
	admission: Record<string, unknown>
}

export interface ModelAssetData {
	meshEntries: ModelMeshEntry[]
	dispose(): void
}

export interface MaterialAssetData {
	material: Material
	materialRegistry: MaterialRegistry
	dispose(): void
}

export interface MeshAssetEntry {
	geometry: BufferGeometry
	material: Material
	localMatrix: Matrix4
	baseName: string | null
}

export interface MeshAssetData {
	meshEntries: MeshAssetEntry[]
	materialRegistry: MaterialRegistry
	dispose(): void
}

export function buildModelAssetCacheKey(asset: FurnitureAsset): string {
	return furnitureAssetKey(asset);
}

export function createModelAssetData(result: GLTF): ModelAssetData {
	const meshEntries: ModelMeshEntry[] = [];
	const geometries = new Set<BufferGeometry>();
	const placeholders = new Set<Material>();
	result.scene.traverse((child) => {
		if (!(child as Mesh).isMesh) return;

		const mesh = child as Mesh;
		geometries.add(mesh.geometry);
		for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
			placeholders.add(material);
	});

	const dispose = () => {
		for (const geometry of geometries) geometry.dispose();

		for (const material of placeholders) material.dispose();
	};

	try {
		const metadata = result.parser.json.extras?.furnitureV2;
		if (
			metadata?.version !== 2 ||
			metadata.kind !== 'model' ||
			result.parser.json.images?.length ||
			result.parser.json.textures?.length
		) throw new Error('[Furniture] Expected material-free geometry GLB');

		result.scene.updateMatrixWorld(true);
		result.scene.traverse((child) => {
			if (!(child as Mesh).isMesh) return;

			const mesh = child as Mesh;
			if (Array.isArray(mesh.material)) throw new Error('[Furniture] Primitive must select one local placeholder');

			const binding = mesh.material.userData.furnitureV2;
			if (
				!binding ||
				!/^m\d+$/.test(binding.slot) ||
				!binding.admission ||
				typeof binding.admission !== 'object'
			) throw new Error('[Furniture] Missing local slot/admission');

			const slot = Number(binding.slot.slice(1));
			const association = result.parser.associations.get(mesh) as
				| { meshes?: number; primitives?: number }
				| undefined;
			if (
				association?.meshes !== undefined &&
				association.primitives !== undefined &&
				result.parser.json.meshes[association.meshes].primitives[association.primitives]
					.material !== slot
			) throw new Error('[Furniture] Primitive slot requires its local material index');

			meshEntries.push({
				geometry: mesh.geometry,
				localMatrix: mesh.matrixWorld.clone(),
				slot,
				name: mesh.material.name,
				admission: binding.admission,
			});
		});
		return { meshEntries, dispose };
	} catch (error) {
		dispose();
		throw error;
	}
}

export async function createMaterialAssetData(
	definition: FurnitureMaterialDefinition,
	resources: FurnitureResources,
	quality: ModelAssetProfile,
): Promise<MaterialAssetData> {
	const materialRegistry = buildMaterialRegistryFromDefinition(definition, resources, quality);
	const material = await createSourceMaterial(definition, resources, quality);
	try {
		bindNNClothResources(material, resources);
		bindWaterFxResources(material, resources);

		const foliage = readFurnitureFoliage(material.userData.foliage);
		if (foliage?.home?.cycle) await bindFoliageCycleAtlas(foliage.home.cycle.atlas, resources);
		const layered = readFurnitureLayered(material.userData.layered);
		if (layered?.projection?.editor)
			await bindRockProjectionCollection(layered.projection.editor.collection.payload, resources);

		return {
			material,
			materialRegistry,

			dispose: () => {
				disposeMaterialRegistry(materialRegistry);
				material.dispose();
			},
		};
	} catch (error) {
		material.dispose();
		throw error;
	}
}

export function finalizeMaterialForGeometry(material: Material, geometry: BufferGeometry): void {
	if (!(material instanceof MeshStandardMaterial)) return;

	material.vertexColors = geometry.hasAttribute('color');
	material.flatShading = !geometry.hasAttribute('normal');
	if (!geometry.hasAttribute('tangent') && material.normalMapType === TangentSpaceNormalMap) {
		material.normalScale.y *= -1;
		if ('clearcoatNormalScale' in material) (material.clearcoatNormalScale as { y: number }).y *= -1;
	}
}

export function assembleMeshAsset(model: ModelAssetData, config: FurnitureMeshConfig, materials: Map<string, MaterialAssetData>): MeshAssetData {
	const materialRegistry: MaterialRegistry = new Map();
	const meshEntries: MeshAssetEntry[] = [];
	try {
		for (const entry of model.meshEntries) {
			const id = config.slots[entry.slot];
			const asset = id ? materials.get(id) : undefined;
			if (!id || !asset || asset.material.name !== entry.name) throw new Error(`[Furniture] Local slot ${entry.slot} source name mismatch`);

			const source = cloneSourceMaterialForItem(asset.material);
			meshEntries.push({
				geometry: entry.geometry,
				localMatrix: entry.localMatrix,
				material: source,
				baseName: null,
			});
			for (const key of Object.keys(entry.admission))
				if (key in source.userData) throw new Error(`[Furniture] Conflicting geometry/material ownership: ${key}`);

			source.userData = { ...source.userData, ...entry.admission };
			finalizeMaterialForGeometry(source, entry.geometry);
			assertNNClothMaterialAdmission(source);
			assertWaterFxMaterialAdmission(source);

			const base = resolveMaterialBaseName(source);
			const baseName = base ? `${id}:${base}` : null;
			meshEntries[meshEntries.length - 1]!.baseName = baseName;
			if (base && baseName) {
				const registry = asset.materialRegistry.get(base);
				if (registry) materialRegistry.set(baseName, registry);
			}
		}
	} catch (error) {
		for (const entry of meshEntries) entry.material.dispose();

		throw error;
	}

	return {
		meshEntries,
		materialRegistry,

		dispose: () => {
			for (const entry of meshEntries) entry.material.dispose();
		},
	};
}

export async function loadGLBAsset(loader: GLTFLoader, asset: FurnitureAsset, signal: AbortSignal, root: string): Promise<GLTF> {
	const buffer = await fetchFurnitureAsset(asset, signal, root);
	if (signal.aborted) throw new Error('[Furniture] Model parse lease expired');

	return loader.parseAsync(buffer, '');
}
