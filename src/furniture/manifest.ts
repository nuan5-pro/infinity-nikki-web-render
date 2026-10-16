import type {
	FurnitureAsset,
	FurnitureAssetSelection,
	FurnitureDB,
	FurnitureMeshConfig,
	FurnitureModelConfig,
	FurniturePackedResource,
} from './types.js';
import { readTextureInputs } from '../materials/textureInputs.js';
import { validatePaperCustomData } from './customData.js';

export async function loadFurnitureModels(root: string, signal?: AbortSignal): Promise<FurnitureModelConfig[]> {
	const response = await fetch(`${root.replace(/\/$/, '')}/manifest.json`, { signal });
	if (!response.ok) throw new Error(`Furniture manifest HTTP ${response.status}`);

	return decodeFurnitureCatalog(await response.json());
}

export function furnitureAssetDigest(asset: FurnitureAsset): string {
	const match = /-([a-f0-9]{16})\.(glb|webp|png|jpg|bin)$/.exec(asset.path);
	if (
		!match ||
		!Number.isSafeInteger(asset.bytes) ||
		asset.bytes <= 0 ||
		asset.path.includes('..') ||
		!/^(models-(full|lite)|textures)\/[^/\\]+$/.test(asset.path)
	) throw new Error(`[Furniture] Invalid immutable resource: ${asset.path}`);

	return match[1]!;
}

export function furnitureAssetKey(asset: FurnitureAsset): string {
	return `${furnitureAssetDigest(asset)}:${asset.bytes}`;
}

export function furnitureAssetUrl(baseUrl: string, asset: FurnitureAsset): string {
	furnitureAssetDigest(asset);
	return `${baseUrl.replace(/\/$/, '')}/${asset.path.split('/').map(encodeURIComponent).join('/')}`;
}

export function furnitureBundleAsset(id: string, bytes: number): FurnitureAsset {
	if (!/^b-[a-f0-9]{16}$/.test(id) || !Number.isSafeInteger(bytes) || bytes < 16) throw new Error(`[Furniture] Invalid bundle ${id}`);

	return { path: `textures/${id}.bin`, bytes };
}

export function validatePackedResource(resource: FurniturePackedResource, bundles: FurnitureDB['bundles']): FurnitureAsset {
	const bytes = bundles[resource.bundle];
	if (
		!Number.isSafeInteger(bytes) ||
		!/^[a-f0-9]{64}$/.test(resource.sha256) ||
		!Number.isSafeInteger(resource.byteOffset) ||
		!Number.isSafeInteger(resource.bytes) ||
		resource.byteOffset < 16 ||
		resource.byteOffset % 4 !== 0 ||
		resource.bytes <= 0 ||
		resource.byteOffset > bytes! - resource.bytes
	) throw new Error('[Furniture] Invalid bundle member range or identity');

	return furnitureBundleAsset(resource.bundle, bytes!);
}

function tuple(values: number[] | undefined, fallback: number[], size: number, label: string): number[] {
	const result = values ?? fallback;
	if (!Array.isArray(result) || result.length !== size || !result.every(Number.isFinite)) throw new Error(`[Furniture] Invalid ${label}`);

	return result;
}

function validateCatalogResources(data: FurnitureDB): void {
	for (const [id, bytes] of Object.entries(data.bundles)) {
		furnitureBundleAsset(id, bytes);
	}

	const members = new Map<string, FurniturePackedResource>();
	const ranges = new Map<string, FurniturePackedResource[]>();

	const registerMember = (resource: FurniturePackedResource) => {
		validatePackedResource(resource, data.bundles);

		const previous = members.get(resource.sha256);
		if (previous) {
			if (
				previous.bundle !== resource.bundle ||
				previous.byteOffset !== resource.byteOffset ||
				previous.bytes !== resource.bytes
			) throw new Error('[Furniture] Content has multiple bundle owners');

			return;
		}

		members.set(resource.sha256, resource);

		const list = ranges.get(resource.bundle) ?? [];
		list.push(resource);
		ranges.set(resource.bundle, list);
	};

	for (const [id, resource] of Object.entries(data.rawResources)) {
		registerMember(resource);
		if (id !== `r-${resource.sha256.slice(0, 16)}`) throw new Error(`[Furniture] Invalid raw resource ${id}`);
	}

	for (const [id, resource] of Object.entries(data.textures)) {
		if (
			!/^t-[a-f0-9]{16}$/.test(id) ||
			!['image/webp', 'image/png', 'image/jpeg'].includes(resource.mimeType)
		) throw new Error(`[Furniture] Invalid image resource ${id}`);

		for (const quality of ['full', 'lite'] as const) registerMember(resource[quality]);

		if (resource.encoding !== undefined && resource.encoding !== 'rgb-alpha') throw new Error(`[Furniture] Invalid image encoding ${id}`);
		if (resource.encoding === 'rgb-alpha' && resource.mimeType !== 'image/webp') throw new Error(`[Furniture] Split images must use WebP: ${id}`);

		if (resource.alpha) {
			if (
				resource.encoding !== 'rgb-alpha' ||
				typeof resource.alpha !== 'object' ||
				Array.isArray(resource.alpha)
			) throw new Error(`[Furniture] Invalid split alpha ${id}`);

			for (const [quality, alpha] of Object.entries(resource.alpha)) {
				if (quality !== 'full' && quality !== 'lite') throw new Error(`[Furniture] Invalid alpha quality ${id}`);

				registerMember(alpha);
				if (alpha.bundle !== resource[quality].bundle) throw new Error(`[Furniture] Split RGB/alpha must share one bundle: ${id}/${quality}`);
			}
		}
	}

	for (const list of ranges.values()) {
		list.sort((a, b) => a.byteOffset - b.byteOffset);
		for (let i = 1; i < list.length; i++) {
			const previous = list[i - 1]!;
			if (list[i]!.byteOffset < previous.byteOffset + previous.bytes) throw new Error('[Furniture] Bundle member ranges overlap');
		}
	}
}

function validateCatalogMaterials(data: FurnitureDB): void {
	for (const [id, material] of Object.entries(data.materials)) {
		if (!/^m-[a-f0-9]{16}$/.test(id) || 'images' in material) throw new Error(`[Furniture] Invalid material ${id}`);

		for (const input of Object.values(readTextureInputs(material.extras ?? {}) ?? {})) {
			for (const resource of input.images) {
				if (!data.textures[resource]) throw new Error(`[Furniture] Missing image ${resource}`);
				if (input.paperLayer && data.textures[resource]!.encoding !== 'rgb-alpha') throw new Error(`[Furniture] Paper layer requires split images: ${resource}`);
			}
		}
	}
}

function decodeFurniture(item: FurnitureDB['furniture'][number], data: FurnitureDB): FurnitureModelConfig {
	if (!Number.isSafeInteger(item.componentCount) || item.componentCount < 1) throw new Error('[Furniture] Invalid source component count');

	validatePaperCustomData(item.customData, item.componentCount);
	if (!item.colorings || typeof item.colorings !== 'object') throw new Error('[Furniture] Missing color mappings');

	for (const schemes of Object.values(item.colorings)) {
		for (const values of Object.values(schemes)) {
			const seen = new Set<number>();
			for (const [index, raw] of values) {
				if (
					!Number.isInteger(index) ||
					index < 0 ||
					index >= item.componentCount ||
					seen.has(index)
				) throw new Error('[Furniture] Invalid coloring source index');

				validatePaperCustomData([raw], 1);
				seen.add(index);
			}
		}
	}

	if (item.lightPreview !== undefined && item.lightPreview !== 'home-object-light-off') throw new Error('[Furniture] Invalid light preview state');

	for (const [key, asset] of Object.entries(item.prepared ?? {})) {
		if (
			!/^(full|lite):(full|lite)$/.test(key) ||
			!asset.path.startsWith('models-') ||
			!asset.path.endsWith('.bin')
		) throw new Error('[Furniture] Invalid prepared geometry profile');

		furnitureAssetDigest(asset);
	}

	const offset = tuple(item.root_offset, data.defaults.furniture.root_offset, 3, 'root_offset');
	const sources = new Set<number>();
	return {
		id: item.id + 1170000000,
		componentCount: item.componentCount,
		customData: [...item.customData],
		colorings: item.colorings,
		assembled: item.assembled ?? data.defaults.furniture.assembled,
		lightPreview: item.lightPreview,
		prepared: item.prepared,
		root_offset: { x: offset[0]!, y: offset[1]!, z: offset[2]! },
		meshes: item.meshes.map((mesh) => {
			if (
				!Number.isInteger(mesh.sourceIndex) ||
				mesh.sourceIndex < 0 ||
				mesh.sourceIndex >= item.componentCount ||
				sources.has(mesh.sourceIndex)
			) throw new Error('[Furniture] Invalid mesh source index');

			sources.add(mesh.sourceIndex);
			furnitureAssetDigest(mesh.models.full);
			if (mesh.models.lite) furnitureAssetDigest(mesh.models.lite);
			for (const id of mesh.slots)
				if (!data.materials[id]) throw new Error(`[Furniture] Missing material ${id}`);

			const rotation = tuple(mesh.rotation, data.defaults.mesh.rotation, 4, 'rotation xyzw');
			const scale = tuple(mesh.scale, data.defaults.mesh.scale, 3, 'scale xyz');
			const trans = tuple(mesh.trans, data.defaults.mesh.trans, 3, 'trans xyz');
			return {
				sourceIndex: mesh.sourceIndex,
				models: mesh.models,
				slots: mesh.slots,
				rotation: { x: rotation[0]!, y: rotation[1]!, z: rotation[2]!, w: rotation[3]! },
				scale: { x: scale[0]!, y: scale[1]!, z: scale[2]! },
				trans: { x: trans[0]!, y: trans[1]!, z: trans[2]! },
			};
		}),
	};
}

export function decodeFurnitureCatalog(data: FurnitureDB): FurnitureModelConfig[] {
	if (
		data.schemaVersion !== 5 ||
		!data.defaults ||
		!data.materials ||
		!data.textures ||
		!data.rawResources ||
		!data.bundles ||
		!Array.isArray(data.furniture)
	) throw new Error('[Furniture] schemaVersion 5 manifest is required');

	validateCatalogResources(data);
	validateCatalogMaterials(data);
	return data.furniture.map((item) => decodeFurniture(item, data));
}

export function resolveFurnitureModel(mesh: FurnitureMeshConfig, selection: FurnitureAssetSelection): FurnitureAsset {
	const asset = mesh.models[selection.model];
	if (!asset) throw new Error(`[Furniture] Geometry ${selection.model} is unavailable; no quality fallback`);

	furnitureAssetDigest(asset);
	return asset;
}
