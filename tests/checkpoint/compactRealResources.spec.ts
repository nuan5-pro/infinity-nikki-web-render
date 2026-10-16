import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTexture, HalfFloatType, Texture } from 'three';
import type { FurnitureDB, FurnitureRawReference } from '../../src/furniture/types.js';
import { decodeFurnitureCatalog } from '../../src/furniture/manifest.js';
import { createMaterialAssetData } from '../../src/furniture/assets.js';
import {
	FurnitureResourceCache,
	FurnitureResources,
	fetchFurnitureAsset,
} from '../../src/resources/resources.js';
import { TEXTURE_SLOTS } from '../../src/materials/textureInputs.js';
import { resolveTextureRef } from '../../src/materials/factory.js';
import {
	disposeNNClothResources,
	readFurnitureNNCloth,
} from '../../src/materials/nncloth/nnclothMaterial.js';
import { disposeWaterFxResources } from '../../src/materials/water/waterFxAsset.js';
import { readWaterFX } from '../../src/materials/water/waterFx.js';
import { readEditorMaterialPreview } from '../../src/materials/editorMaterialPreview.js';
import { readNNClothPreview } from '../../src/materials/nncloth/nnclothPreview.js';
import { readFurnitureSurface } from '../../src/materials/surface/surfaceShader.js';
import { readFurnitureGlass } from '../../src/materials/glass/glassShader.js';
import { readFurnitureCloth } from '../../src/materials/cloth/clothShader.js';
import { readFurnitureClothStaticCore } from '../../src/materials/cloth/clothStaticCoreShader.js';
import { readFurnitureLayered } from '../../src/materials/layered/layeredShader.js';
import { readFurnitureJewel } from '../../src/materials/jewel/jewelShader.js';
import { readFurnitureScene } from '../../src/materials/sceneShader.js';
import { readFurnitureEffect } from '../../src/materials/effects/effectShader.js';
import {
	cloneFoliageCycleAtlas,
	disposeFoliageCycleAtlases,
	readFurnitureFoliage,
} from '../../src/materials/foliage/foliageShader.js';
import {
	createRockProjectionCollectionTexture,
	disposeRockProjectionCollections,
} from '../../src/materials/layered/rockProjectionCollectionTexture.js';
import { readFurnitureParallaxCard } from '../../src/materials/effects/parallaxCardShader.js';
import { readFurnitureTranslucentCrystal } from '../../src/materials/glass/translucentCrystalShader.js';

const directory = process.env.FURNITURE_RESOURCE_FIXTURE_DIR;
const catalog = directory
	? (JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as FurnitureDB)
	: null;
let cache = new FurnitureResourceCache();
afterEach(() => {
	cache.dispose();
	cache = new FurnitureResourceCache();
	vi.unstubAllGlobals();
});

function references(value: unknown): FurnitureRawReference[] {
	if (!value || typeof value !== 'object') return [];

	const record = value as Record<string, unknown>;
	if (typeof record.resource === 'string' && record.resource.startsWith('r-')) return [record as unknown as FurnitureRawReference];

	return Object.values(record).flatMap(references);
}

// Actual downloaded container bytes and direct resource ranges are verified.
// Images are transport-only textures here: no pixel decode, GPU, or Draco model decode.
describe.skipIf(!catalog)('actual compact producer resources', () => {
	it('consumes inline material definitions and externally addressed images/native bytes without a material GLTF parser', async () => {
		const decoded = decodeFurnitureCatalog(catalog!);
		const requests = new Map<string, number>();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const relative = decodeURIComponent(url.split('/assets/furniture-v2/')[1]!);
				requests.set(relative, (requests.get(relative) ?? 0) + 1);
				return new Response(readFileSync(join(directory!, relative)));
			}),
		);

		const sourceImages = new Map<Texture, string>();
		vi.spyOn(cache.pixelDecoder, 'decode').mockImplementation(async (rgb, alpha) => {
			for (const bytes of [rgb, alpha]) {
				if (!bytes) continue;

				expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
				expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WEBP');
			}

			return { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) };
		});

		const decode = async (_bytes: Uint8Array<ArrayBuffer>, mimeType: string) => {
			expect(['image/webp', 'image/png', 'image/jpeg']).toContain(mimeType);

			const texture = new Texture();
			texture.image = { width: 1, height: 1 };
			sourceImages.set(texture, mimeType);
			return texture;
		};

		const readers: Record<string, (value: unknown) => unknown> = {
			editorPreview: readEditorMaterialPreview,
			nnclothPreview: readNNClothPreview,
			surface: readFurnitureSurface,
			glass: readFurnitureGlass,
			cloth: readFurnitureCloth,
			clothStaticCore: readFurnitureClothStaticCore,
			layered: readFurnitureLayered,
			jewel: readFurnitureJewel,
			scene: readFurnitureScene,
			effect: readFurnitureEffect,
			foliage: readFurnitureFoliage,
			parallaxCard: readFurnitureParallaxCard,
			translucentCrystal: readFurnitureTranslucentCrystal,
			nncloth: readFurnitureNNCloth,
			waterFx: readWaterFX,
		};

		const models = new Set<string>();
		for (const item of decoded)
			for (const mesh of item.meshes) {
				for (const model of [mesh.models.full, mesh.models.lite]) {
					if (!model || models.has(model.path)) continue;
					models.add(model.path);

					const bytes = await fetchFurnitureAsset(model, new AbortController().signal, '/assets/furniture-v2/');
					const view = new DataView(bytes);
					expect(view.getUint32(0, true)).toBe(0x46546c67);

					const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, view.getUint32(12, true))));
					expect(json.extras.furnitureV2).toEqual({ kind: 'model', version: 2 });
					expect(json.images).toBeUndefined();
					expect(json.materials).toHaveLength(mesh.slots.length);
					for (let slot = 0; slot < mesh.slots.length; slot++) {
						expect(json.materials[slot].extras.furnitureV2.slot).toBe(`m${slot}`);
						expect(json.materials[slot].name).toBe(catalog!.materials[mesh.slots[slot]!]!.name);
					}
				}
			}

		let typed = 0;
		for (const quality of ['full', 'lite'] as const) {
			const resources = new FurnitureResources(catalog!, '/assets/furniture-v2/', cache, decode);
			try {
				for (const definition of Object.values(catalog!.materials)) {
					for (const [key, reader] of Object.entries(readers))
						if (definition.extras?.[key] !== undefined) {
							expect(reader(definition.extras[key]), `${definition.name}: compact ${key}`).not.toBeNull();
						}

					const asset = await createMaterialAssetData(definition, resources, quality);
					try {
						const atlas = asset.material.userData.foliage?.home?.cycle?.atlas;
						if (atlas) {
							expect(atlas.rgba16f).toBeUndefined();
							expect(atlas.byteLength).toBe(atlas.width * atlas.height * 8);

							const texture = cloneFoliageCycleAtlas(atlas) as DataTexture;
							expect(texture.type).toBe(HalfFloatType);
							expect(texture.image.data).toBeInstanceOf(Uint16Array);
							expect(texture.image.data!.length).toBe(atlas.width * atlas.height * 4);
							texture.dispose();
						}

						const collection = asset.material.userData.layered?.projection?.editor?.collection?.payload;
						if (collection) {
							expect(collection.manifestBytes).toBeUndefined();
							expect(collection.manifest).toBeUndefined();

							const texture = createRockProjectionCollectionTexture(collection);
							expect(texture.mipmaps).toHaveLength(10);
							expect(texture.mipmaps.reduce((sum, mip) => sum + (mip.data as Uint8Array).byteLength, 0)).toBe(174776);

							const groups = new Set(collection.mips.map((mip: { native: FurnitureRawReference }) => mip.native.resource));
							expect(groups.size).toBe(1);
							for (const group of groups)
								expect(catalog!.rawResources[group as string]!.bytes).toBe(174760);

							texture.dispose();
						}

						for (const blob of references(definition.extras)) {
							expect((await resources.read(blob)).byteLength).toBe(blob.byteLength);
							typed++;
						}

						for (const entry of asset.materialRegistry.values())
							for (const role of TEXTURE_SLOTS)
								for (const ref of entry[role].values()) {
									expect(await resolveTextureRef(ref)).toBeInstanceOf(Texture);
								}
					} finally {
						asset.dispose();
					}
				}
			} finally {
				disposeNNClothResources(resources);
				disposeWaterFxResources(resources);
				disposeFoliageCycleAtlases(resources);
				disposeRockProjectionCollections(resources);
				resources.dispose();
			}
		}

		expect(models.size).toBeGreaterThan(0);
		for (const [path, count] of requests) if (path.startsWith('textures/')) expect(count).toBe(1);

		if (Object.keys(catalog!.rawResources).length) expect(typed).toBeGreaterThan(0);
	}, 60_000);
});
