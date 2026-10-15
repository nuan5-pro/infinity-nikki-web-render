import {
	Color,
	AdditiveBlending,
	DoubleSide,
	MeshStandardMaterial,
	MeshBasicMaterial,
	MultiplyBlending,
	Vector2,
	Material,
	type MeshStandardMaterialParameters,
	Texture,
} from 'three';
import type { FurnitureMaterialDefinition, ModelAssetProfile } from '../furniture/types.js';
import type { FurnitureResources } from '../resources/resources.js';
import { applySurfaceShader, readFurnitureSurface } from './surface/surfaceShader.js';
import { applyTranslucentHbcShader } from './glass/translucentHbcShader.js';
import { applyHomeSurfaceFeatures } from './surface/homeSurfaceFeatures.js';
import { applyTriplanarHbcShader } from './surface/triplanarHbcShader.js';
import { applySurfaceExtraShader, readFurnitureSurfaceExtra } from './surface/surfaceExtraShader.js';
import { createGlassMaterial, readFurnitureGlass } from './glass/glassShader.js';
import { createJewelMaterial, readFurnitureJewel } from './jewel/jewelShader.js';
import { readFurnitureTranslucentCrystal } from './glass/translucentCrystalShader.js';
import { createDeferredTranslucentCrystalPreviewMaterial } from './glass/translucentCrystalPreview.js';
import { readFurnitureParallaxCard } from './effects/parallaxCardShader.js';
import { createDeferredParallaxCardPreviewMaterial } from './effects/parallaxCardPreview.js';
import { createParallaxStarMaterial, readFurnitureParallaxStar } from './effects/parallaxStarShader.js';
import { createLightmassBodyMaterial, type LightmassBody } from './surface/lightmassBodyShader.js';
import { createLightmassCurrentMaterial, readLightmassCurrent } from './surface/lightmassCurrentShader.js';
import { createFXPBRMaterial, readFurnitureFXPBR } from './effects/fxPbrShader.js';
import { createWaterMaterial, readFurnitureWater } from './water/waterShader.js';
import { applyWaterGlintDetail, readFurnitureWaterGlintDetail } from './water/waterGlintDetailShader.js';
import {
	createStaticEffectCarrierMaterial,
	readFurnitureStaticEffectCarrier,
} from './effects/staticEffectCarrier.js';
import { createInkPreviewMaterial, readFurnitureInkPreview } from './effects/inkPreviewShader.js';
import {
	createLiquidVolumeStaticMaterial,
	readFurnitureLiquidVolumeStatic,
} from './glass/liquidVolumeStaticShader.js';
import {
	createClothStaticCoreMaterial,
	readFurnitureClothStaticCore,
} from './cloth/clothStaticCoreShader.js';
import { createCrystalPreviewMaterial, readFurnitureCrystalPreview } from './glass/crystalPreviewShader.js';
import { readFurnitureDiamondBillboardCurrent } from './effects/diamondBillboardCurrentShader.js';
import { createDeferredDiamondBillboardCurrentMaterial } from './effects/diamondBillboardCurrentPreview.js';
import { readFurnitureAnimalMaskedCurrent } from './effects/animalMaskedCurrentShader.js';
import { createDeferredAnimalMaskedCurrentMaterial } from './effects/animalMaskedCurrentPreview.js';
import { createFoliageMaterial, readFurnitureFoliage } from './foliage/foliageShader.js';
import { createEffectMaterial, readFurnitureEffect } from './effects/effectShader.js';
import { createSceneMaterial, readFurnitureScene } from './sceneShader.js';
import { createFoamMaterial, readFurnitureFoam } from './effects/foamShader.js';
import { createClothMaterial, readFurnitureCloth } from './cloth/clothShader.js';
import { createLongFeatherMaterial, readFurnitureLongFeather } from './cloth/longFeatherShader.js';
import { createMirrorMaterial, readFurnitureMirror } from './glass/mirrorShader.js';
import { readFurnitureCharacterJewel } from './jewel/characterJewelShader.js';
import { createDeferredCharacterJewelPreviewMaterial } from './jewel/characterJewelPreview.js';
import { readFurnitureIntStaticMeshCurrent } from './surface/intStaticMeshCurrentShader.js';
import { createDeferredIntStaticMeshCurrentMaterial } from './surface/intStaticMeshCurrentPreview.js';
import { readFurnitureSceneJewelCurrent } from './jewel/jewelCurrentShader.js';
import { createDeferredSceneJewelCurrentMaterial } from './jewel/jewelCurrentPreview.js';
import {
	createSphereBillboardCurrentMaterial,
	readFurnitureSphereBillboardCurrent,
} from './effects/sphereBillboardCurrentShader.js';
import { readFurnitureABSFXCurrent } from './effects/absFxCurrentShader.js';
import { createDeferredABSFXCurrentMaterial } from './effects/absFxCurrentPreview.js';
import {
	createAnimalSimpleTransMaterial,
	readFurnitureAnimalSimpleTrans,
} from './effects/animalSimpleTransShader.js';
import { createOpalPreviewMaterial, readFurnitureOpalPreview } from './jewel/opalPreviewShader.js';
import {
	createNNClothUA2PreviewMaterial,
	readFurnitureNNClothUA2Preview,
} from './nncloth/nnclothUA2PreviewShader.js';
import { createWaterSmallPropMaterial, readFurnitureWaterSmallProp } from './water/waterSmallPropShader.js';
import { createLEDSignPreviewMaterial, readFurnitureLEDSignPreview } from './effects/ledSignPreviewShader.js';
import {
	createTranslucentLaceMaterial,
	readFurnitureTranslucentLace,
	translucentLaceNormalSigns,
} from './glass/translucentLaceShader.js';
import { createLayeredMaterial, readFurnitureLayered } from './layered/layeredShader.js';
import { createCabinetStaticMaterial, readFurnitureCabinetStatic } from './surface/cabinetStaticShader.js';
import { createNNClothMaterial } from './nncloth/nnclothMaterial.js';
import { createNNClothPreviewMaterial, readNNClothPreview } from './nncloth/nnclothPreview.js';
import { createEditorMaterialPreview, readEditorMaterialPreview } from './editorMaterialPreview.js';
import { createWaterFxResourceMaterial } from './water/waterFxAsset.js';
import { type WaterFxMaterialOptions } from './water/waterFxMaterial.js';
import {
	cloneTextureInput,
	readTextureInputs,
	sameTextureBinding,
	TEXTURE_SLOTS,
	type TextureSlot,
} from './textureInputs.js';
import { applyEnvironmentLighting } from '../runtime/environmentLighting.js';

const standardTextureSlots = [
	'map',
	'normalMap',
	'roughnessMap',
	'metalnessMap',
	'aoMap',
	'emissiveMap',
] as const;

type StandardTextureSlot = (typeof standardTextureSlots)[number];

type StandardTextures = Partial<Record<StandardTextureSlot, Texture | null>>;

/** Share pending image decoding and cache successful results. */
export interface TextureRef {
	_cache?: Texture;
	_loading?: Promise<Texture>;
	_disposed?: boolean;
	resource: string;
	resources: FurnitureResources;
	quality: ModelAssetProfile;
	standardSlots?: StandardTextureSlot[];
}

/** Lazy image variants grouped by native texture role. */
export type MaterialRegistryEntry = Record<TextureSlot, Map<number, TextureRef>>;

/** Material names map to their native texture variants. */
export type MaterialRegistry = Map<string, MaterialRegistryEntry>;

interface ResolvedMaterialTextures {
	slots: Partial<Record<TextureSlot, Texture | null>>;
	standardBindings?: Array<{ role: TextureSlot; slot: StandardTextureSlot; binding: Texture }>;
	standardMaps?: StandardTextures;
	diffuse: Texture | null;
	mask: Texture | null;
	normal: Texture | null;
	orm: Texture | null;
	tint: Texture | null;
}

export interface TextureSourceSummary {
	textureReferences: number;
}

function getOrCreateRegistryEntry(registry: MaterialRegistry, baseName: string): MaterialRegistryEntry {
	let entry = registry.get(baseName);
	if (!entry) {
		entry = {
			D: new Map(),
			M: new Map(),
			N: new Map(),
			O: new Map(),
			T: new Map(),
			D1: new Map(),
			N1: new Map(),
			O1: new Map(),
			D2: new Map(),
			N2: new Map(),
			O2: new Map(),
			B: new Map(),
			S: new Map(),
			C: new Map(),
			T1: new Map(),
		};
		registry.set(baseName, entry);
	}

	return entry;
}

export function resolveMaterialBaseName(mat: Material): string | null {
	if (!readTextureInputs(mat.userData)) return null;
	if (!mat.name.trim()) throw new Error('Material textureInputs requires a stable source material name');

	return mat.name;
}

/** Reuse pending decoding across concurrent image requests. */
export async function resolveTextureRef(ref: TextureRef): Promise<Texture> {
	if (ref._disposed) throw new Error('[Furniture] Material image reference disposed');
	if (ref._cache) return ref._cache;
	if (ref._loading) return ref._loading;

	const texturePromise = ref.resources.image(ref.resource, ref.quality);

	ref._loading = texturePromise
		.then((texture) => {
			if (ref._disposed) throw new Error('[Furniture] Material reference disposed during image decoding');

			ref._cache = texture;
			ref._loading = undefined;
			return ref._cache;
		})
		.catch((error) => {
			ref._loading = undefined;
			delete ref._cache;
			throw error;
		});

	return ref._loading;
}

function extractTexture(mat: Material, type: 'D' | 'N' | 'O'): Texture | null {
	if (type === 'D' && (mat as any).isMeshBasicMaterial) return (mat as any).map ?? null;
	if (!(mat as any).isMeshStandardMaterial) return null;

	const stdMat = mat as MeshStandardMaterial;
	switch (type) {
	case 'D':
		return stdMat.map ?? null;
	case 'N':
		return stdMat.normalMap ?? null;
	case 'O':
		return stdMat.roughnessMap ?? stdMat.metalnessMap ?? null;
	}
}

/** Standard TextureInfo maps are constructed directly from the current inline definition. */
function getSourceMaterialTextures(sourceMat: Material): ResolvedMaterialTextures {
	return {
		slots: {},
		diffuse: extractTexture(sourceMat, 'D'),
		mask: null,
		normal: extractTexture(sourceMat, 'N'),
		orm: extractTexture(sourceMat, 'O'),
		tint: null,
	};
}

function hasResolvedTextures(textures: ResolvedMaterialTextures): boolean {
	return !!(
		textures.diffuse ||
		textures.mask ||
		textures.normal ||
		textures.orm ||
		textures.tint ||
		Object.values(textures.slots).some(Boolean)
	);
}

/** Native array selection clamps within the complete declared slice table. */
function getTextureVariantRef(
	entry: MaterialRegistryEntry | undefined,
	type: keyof MaterialRegistryEntry,
	variantIdx: number,
	sourceMat: Material,
): TextureRef | undefined {
	if (!entry || !entry[type].size) return undefined;

	const depth = sourceMat.userData.arrayDepths?.[type] ?? entry[type].size;
	if (
		!Number.isSafeInteger(depth) ||
		depth !== entry[type].size ||
		!Number.isSafeInteger(variantIdx)
	) throw new Error('[Furniture] Invalid declared texture slice domain');

	return entry[type].get(Math.max(0, Math.min(depth - 1, variantIdx)));
}

/** Assemble fixed inputs and complete native arrays once per material owner. */
async function resolveMaterialTextures({
	sourceMat,
	registryEntry,
}: {
	sourceMat: Material;
	registryEntry?: MaterialRegistryEntry;
}): Promise<ResolvedMaterialTextures> {
	const inputs = readTextureInputs(sourceMat.userData);
	if (!inputs) return getSourceMaterialTextures(sourceMat);

	const slots: Partial<Record<TextureSlot, Texture | null>> = {};
	const standardBindings: NonNullable<ResolvedMaterialTextures['standardBindings']> = [];
	const ua2 = readFurnitureNNClothUA2Preview(sourceMat.userData.nnclothUA2Preview);
	if (sourceMat.userData.nnclothUA2Preview && !ua2) throw new Error(`[ModelManager] ${sourceMat.name}: invalid NNCloth UA2 contract`);

	await Promise.all(
		Object.entries(inputs).map(async ([key, input]) => {
			const role = key as TextureSlot;
			if (input.paperLayer) {
				const entries = registryEntry?.[role];
				const refs = input.images.map((name, index) => {
					const ref = entries?.get(index);
					if (!ref || ref.resource !== name) throw new Error(`[Furniture] Missing native ${role} array layer ${index}`);

					return ref;
				});
				const first = refs[0]!;
				if (refs.some((ref) => ref.resources !== first.resources || ref.quality !== first.quality)) throw new Error('[Furniture] Array layers require one resource owner and quality');

				const array = input.paperArray?.[first.quality];
				if (!array || array.depth !== input.images.length) throw new Error(`[Furniture] ${role} requires producer-prepared native array`);

				slots[role] = await first.resources.paperArray(array);
				for (const slot of first.standardSlots ?? []) {
					const binding = (sourceMat as Material & StandardTextures)[slot];
					if (binding) standardBindings.push({ role, slot, binding });
				}

				return;
			}

			if (
				(sourceMat.userData.sphereBillboardCurrent && role === 'B') ||
				(ua2 && (role === 'B' || role === 'C'))
			) {
				const depth = ua2 ? ua2.textures[role]?.depth : sourceMat.userData.arrayDepths?.B;
				const entries = registryEntry?.[role];
				if (
					!entries ||
					!Number.isSafeInteger(depth) ||
					depth !== input.images.length ||
					entries.size !== depth
				) throw new Error(`[ModelManager] ${sourceMat.name}: complete native ${role} array required`);

				const refs = input.images.map((name, index) => {
					const ref = entries.get(index);
					if (!ref || ref.resource !== name) throw new Error(`[ModelManager] ${sourceMat.name}: missing ${role} array layer ${index}`);

					return ref;
				});
				const first = refs[0]!;
				if (
					refs.some((ref) => ref.resources !== first.resources || ref.quality !== first.quality)
				) throw new Error('[Furniture] Array layers require one resource owner and quality');

				slots[role] = await first.resources.arrayImage(refs.map((ref) => ref.resource), first.quality);
				return;
			}

			const ref = getTextureVariantRef(registryEntry, role, 0, sourceMat);
			if (!ref || !input.images.includes(ref.resource)) throw new Error(
				`[ModelManager] ${sourceMat.name}: missing declared native texture input ${role}`,
			);

			const texture = await resolveTextureRef(ref);
			slots[role] = texture;
			for (const slot of ref.standardSlots ?? []) {
				const binding = (sourceMat as Material & StandardTextures)[slot];
				if (binding) standardBindings.push({ role, slot, binding });
			}
		}),
	);
	return {
		slots,
		standardBindings,
		diffuse: slots.D ?? null,
		mask: slots.M ?? null,
		normal: slots.N ?? null,
		orm: slots.O ?? null,
		tint: slots.T ?? null,
	};
}

/** Bind material-owned samplers before selecting the native shader. */
function createModelMaterial(textures: ResolvedMaterialTextures, source: Material): Material {
	// Cabinet owns its source-role clones and native sampling contracts. Avoid
	// cloning every input twice through the generic textureInputs wrapper.
	if (
		source.userData.clothStaticCore ||
		source.userData.liquidVolumeStatic ||
		source.userData.animalMaskedCurrent ||
		source.userData.diamondBillboardCurrent ||
		source.userData.crystalPreview ||
		source.userData.inkPreview ||
		source.userData.waterGlintDetail ||
		source.userData.ledSignPreview ||
		source.userData.waterSmallProp ||
		source.userData.nnclothUA2Preview ||
		source.userData.opalPreview ||
		source.userData.animalSimpleTrans ||
		source.userData.cabinetStatic ||
		source.userData.parallaxCard ||
		source.userData.characterJewel ||
		source.userData.intStaticMeshCurrent ||
		source.userData.sceneJewelCurrent ||
		source.userData.sphereBillboardCurrent ||
		source.userData.absFxCurrent
	) return createModelMaterialFromInputs(textures, source);

	const inputs = readTextureInputs(source.userData);
	const owned: Texture[] = [];
	const slots = { ...textures.slots };
	const standardMaps: StandardTextures = {};
	try {
		for (const [key, texture] of Object.entries(slots)) {
			const role = key as TextureSlot;
			if (!texture) continue;
			const input = inputs?.[role];
			if (!input) throw new Error(`[Furniture] Undeclared texture role ${role}`);

			const bindings = textures.standardBindings?.filter((binding) => binding.role === role) ?? [];
			const first = bindings[0]?.binding;
			// One native role cannot represent conflicting per-map samplers/UVs.
			// Inherit only a unique/equivalent state; explicit native inputs still win.
			const shared =
				first && bindings.every(({ binding }) => sameTextureBinding(first, binding))
					? first
					: undefined;
			const clone = cloneTextureInput(texture, input, shared);
			slots[role] = clone;
			owned.push(clone);

			const standardClones: Array<{ binding: Texture; texture: Texture }> = shared
				? [{ binding: shared, texture: clone }]
				: [];
			for (const { slot, binding } of bindings) {
				let matched = standardClones.find((entry) => sameTextureBinding(entry.binding, binding));
				if (!matched) {
					matched = { binding, texture: cloneTextureInput(texture, input, binding) };
					standardClones.push(matched);
					owned.push(matched.texture);
				}

				standardMaps[slot] = matched.texture;
			}
		}

		const material = createModelMaterialFromInputs(
			{
				slots,
				standardMaps,
				diffuse: slots.D ?? textures.diffuse,
				mask: slots.M ?? textures.mask,
				normal: slots.N ?? textures.normal,
				orm: slots.O ?? textures.orm,
				tint: slots.T ?? textures.tint,
			},
			source,
		);
		material.addEventListener('dispose', () => owned.forEach((texture) => texture.dispose()));
		return material;
	} catch (error) {
		owned.forEach((texture) => texture.dispose());
		throw error;
	}
}

function readLightmassBody(value: unknown): LightmassBody | null {
	if (!value || typeof value !== 'object') return null;

	const c = value as LightmassBody;
	if (c.family !== 'lightmass-body' || c.version !== 1) return null;

	for (const key of [
		'diffuseOcc',
		'specOcc',
		'roughBias',
		'materialAO',
		'uvScale',
		'normalUvScale',
		'normalIntensity',
	] as const) {
		if (!Number.isFinite(c[key])) return null;
	}

	for (const [key, size] of [
		['tint', 3],
		['occColor', 3],
		['primitive33', 4],
		['ao', 2],
		['roughness', 2],
		['metalness', 2],
	] as const) {
		if (!Array.isArray(c[key]) || c[key].length !== size || !c[key].every(Number.isFinite)) return null;
	}

	if (
		![c.srgb, c.mipmaps].every(
			(values) =>
				Array.isArray(values) &&
				values.length === 3 &&
				values.every((item) => typeof item === 'boolean'),
		)
	) return null;

	return c;
}

function createModelMaterialFromInputs(textures: ResolvedMaterialTextures, source: Material): Material {
	const crystalPreview = readFurnitureCrystalPreview(source.userData.crystalPreview);
	if (source.userData.crystalPreview && !crystalPreview) throw new Error(`[ModelManager] ${source.name}: invalid CrystalPreview contract`);

	if (crystalPreview) {
		const material = createCrystalPreviewMaterial(crystalPreview, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, crystalPreview };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const inkPreview = readFurnitureInkPreview(source.userData.inkPreview);
	if (source.userData.inkPreview && !inkPreview) throw new Error(`[ModelManager] ${source.name}: invalid InkPreview contract`);

	if (inkPreview) {
		const material = createInkPreviewMaterial(inkPreview, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, inkPreview };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const clothStatic = readFurnitureClothStaticCore(source.userData.clothStaticCore);
	if (source.userData.clothStaticCore && !clothStatic) throw new Error(`[ModelManager] ${source.name}: invalid ClothStaticCore contract`);

	if (clothStatic) {
		const material = createClothStaticCoreMaterial(clothStatic, textures.slots, source);
		material.name = source.name;
		material.userData = { ...source.userData, ...material.userData, clothStaticCore: clothStatic };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const liquid = readFurnitureLiquidVolumeStatic(source.userData.liquidVolumeStatic);
	if (source.userData.liquidVolumeStatic && !liquid) throw new Error(`[ModelManager] ${source.name}: invalid LiquidVolumeStatic contract`);

	if (liquid) {
		const material = createLiquidVolumeStaticMaterial(liquid, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, ...material.userData, liquidVolumeStatic: liquid };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const staticCarrier = readFurnitureStaticEffectCarrier(source.userData.staticEffectCarrier);
	if (source.userData.staticEffectCarrier && !staticCarrier) throw new Error(`[ModelManager] ${source.name}: invalid StaticEffectCarrier contract`);

	if (staticCarrier) {
		const material = createStaticEffectCarrierMaterial(staticCarrier);
		material.name = source.name;
		material.userData = { ...source.userData, staticEffectCarrier: staticCarrier };
		return material;
	}

	const ledSignPreview = readFurnitureLEDSignPreview(source.userData.ledSignPreview);
	if (source.userData.ledSignPreview && !ledSignPreview) throw new Error(`[ModelManager] ${source.name}: invalid LEDSign contract`);

	if (ledSignPreview) {
		const material = createLEDSignPreviewMaterial(ledSignPreview, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, ledSignPreview };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const waterSmallProp = readFurnitureWaterSmallProp(source.userData.waterSmallProp);
	if (source.userData.waterSmallProp && !waterSmallProp) throw new Error(`[ModelManager] ${source.name}: invalid WaterSmallProp contract`);

	if (waterSmallProp) {
		const material = createWaterSmallPropMaterial(waterSmallProp, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, waterSmallProp };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const ua2 = readFurnitureNNClothUA2Preview(source.userData.nnclothUA2Preview);
	if (source.userData.nnclothUA2Preview && !ua2) throw new Error(`[ModelManager] ${source.name}: invalid NNCloth UA2 contract`);

	if (ua2) {
		const material = createNNClothUA2PreviewMaterial(ua2, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, nnclothUA2Preview: ua2 };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const opal = readFurnitureOpalPreview(source.userData.opalPreview);
	if (source.userData.opalPreview && !opal) throw new Error(`[ModelManager] ${source.name}: invalid Opal14 contract`);

	if (opal) {
		const material = createOpalPreviewMaterial(opal, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, opalPreview: opal };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const animal = readFurnitureAnimalSimpleTrans(source.userData.animalSimpleTrans);
	if (source.userData.animalSimpleTrans && !animal) throw new Error(`[ModelManager] ${source.name}: invalid AnimalSimpleTrans contract`);

	if (animal) {
		const material = createAnimalSimpleTransMaterial(animal, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, animalSimpleTrans: animal };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const animalMasked = readFurnitureAnimalMaskedCurrent(source.userData.animalMaskedCurrent);
	if (source.userData.animalMaskedCurrent && !animalMasked) throw new Error(`[ModelManager] ${source.name}: invalid AnimalMasked contract`);

	if (animalMasked) {
		const material = createDeferredAnimalMaskedCurrentMaterial(animalMasked, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, ...material.userData };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const diamond = readFurnitureDiamondBillboardCurrent(source.userData.diamondBillboardCurrent);
	if (source.userData.diamondBillboardCurrent && !diamond) throw new Error(`[ModelManager] ${source.name}: invalid DiamondBillboard contract`);

	if (diamond) {
		const material = createDeferredDiamondBillboardCurrentMaterial(diamond, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, ...material.userData };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const sphere = readFurnitureSphereBillboardCurrent(source.userData.sphereBillboardCurrent);
	if (source.userData.sphereBillboardCurrent && !sphere) throw new Error(`[ModelManager] ${source.name}: invalid SphereBillboard preview contract`);

	if (sphere) {
		const material = createSphereBillboardCurrentMaterial(sphere, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, ...material.userData };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const sceneJewel = readFurnitureSceneJewelCurrent(source.userData.sceneJewelCurrent);
	if (source.userData.sceneJewelCurrent && !sceneJewel) throw new Error(`[ModelManager] ${source.name}: invalid scene Jewel contract`);

	if (sceneJewel) {
		const material = createDeferredSceneJewelCurrentMaterial(sceneJewel, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, sceneJewelCurrent: sceneJewel };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const absFx = readFurnitureABSFXCurrent(source.userData.absFxCurrent);
	if (source.userData.absFxCurrent && !absFx) throw new Error(`[ModelManager] ${source.name}: invalid ABS FX contract`);

	if (absFx) {
		const material = createDeferredABSFXCurrentMaterial(absFx, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, absFxCurrent: absFx };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const intStatic = readFurnitureIntStaticMeshCurrent(source.userData.intStaticMeshCurrent);
	if (source.userData.intStaticMeshCurrent && !intStatic) throw new Error(`[ModelManager] ${source.name}: invalid IntStaticMesh contract`);

	if (intStatic) {
		const material = createDeferredIntStaticMeshCurrentMaterial(intStatic, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, intStaticMeshCurrent: intStatic };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const character = readFurnitureCharacterJewel(source.userData.characterJewel);
	if (source.userData.characterJewel && !character) throw new Error(`[ModelManager] ${source.name}: invalid CharacterJewel contract`);

	if (character) {
		const material = createDeferredCharacterJewelPreviewMaterial(character, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, characterJewel: character };
		material.visible = source.visible;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const editorPreview = readEditorMaterialPreview(source.userData.editorPreview);
	if (source.userData.editorPreview && !editorPreview) throw new Error(`[ModelManager] ${source.name}: invalid editor material preview`);
	if (editorPreview) return createEditorMaterialPreview(editorPreview, textures.slots, source);

	const nnPreview = readNNClothPreview(source.userData.nnclothPreview);
	if (source.userData.nnclothPreview && !nnPreview) throw new Error(`[ModelManager] ${source.name}: invalid NNCloth editor preview`);
	if (nnPreview) return createNNClothPreviewMaterial(nnPreview, textures.slots, source);

	const cabinet = readFurnitureCabinetStatic(source.userData.cabinetStatic);
	if (source.userData.cabinetStatic && !cabinet) throw new Error(`[ModelManager] ${source.name}: invalid CabinetStatic contract`);

	if (cabinet) {
		const inputs = readTextureInputs(source.userData);
		for (const [role, texture] of Object.entries(cabinet.textures)) {
			if (
				texture.encoding === 'native-rg' &&
				inputs?.[role as TextureSlot]?.normalEncoding !== 'native-rg'
			) throw new Error(`[ModelManager] ${source.name}: CabinetStatic ${role} requires preserved native RG transport`);
		}

		return createCabinetStaticMaterial(cabinet, textures.slots, source);
	}

	const card = readFurnitureParallaxCard(source.userData.parallaxCard);
	if (source.userData.parallaxCard && !card) throw new Error(`[ModelManager] ${source.name}: invalid ParallaxCard contract`);

	if (card) {
		const material = createDeferredParallaxCardPreviewMaterial(card, textures.slots);
		material.name = source.name;
		material.userData = { ...source.userData, parallaxCard: card };
		material.side = source.side;
		material.visible = source.visible;
		material.depthTest = source.depthTest;
		material.colorWrite = source.colorWrite;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const crystal = readFurnitureTranslucentCrystal(source.userData.translucentCrystal);
	if (source.userData.translucentCrystal && !crystal) throw new Error(`[ModelManager] ${source.name}: invalid TranslucentCrystal contract`);

	if (crystal) {
		const material = createDeferredTranslucentCrystalPreviewMaterial(crystal, textures.slots);
		// Source identity/side/proof table survive material replacement. Native blend
		// and coverage are owned by the Crystal factory, not legacy presentation.
		material.name = source.name;
		material.userData = { ...source.userData, translucentCrystal: crystal };
		material.side = source.side;
		material.visible = source.visible;
		material.depthTest = source.depthTest;
		material.colorWrite = source.colorWrite;
		material.toneMapped = source.toneMapped;
		return material;
	}

	const fxPbr = readFurnitureFXPBR(source.userData.fxPbr);
	if (source.userData.fxPbr && !fxPbr) throw new Error(`[ModelManager] ${source.name}: invalid FXPBR contract`);

	if (fxPbr) {
		if (!(source instanceof MeshStandardMaterial)) throw new Error(`[ModelManager] ${source.name}: FXPBR requires source Standard material`);

		const material = createFXPBRMaterial(fxPbr, textures.diffuse, textures.normal, textures.orm, source);
		copyMaterialPresentation(material, source);
		material.color.setRGB(1, 1, 1);
		material.transparent = false;
		material.depthWrite = true;
		material.opacity = 1;
		material.alphaTest = 0;
		return material;
	}

	const currentBody = readLightmassCurrent(source.userData.lightmassCurrent);
	if (source.userData.lightmassCurrent && !currentBody) throw new Error(`[ModelManager] ${source.name}: invalid current Lightmass contract`);

	if (currentBody) {
		if (
			!textures.diffuse ||
			!textures.normal ||
			!textures.orm ||
			!(source instanceof MeshStandardMaterial)
		) throw new Error(`[ModelManager] ${source.name}: current Lightmass requires actual D/N/O and Standard material`);

		return createLightmassCurrentMaterial(currentBody, textures.diffuse, textures.normal, textures.orm, source);
	}

	const body = readLightmassBody(source.userData.lightmassBody);
	if (source.userData.lightmassBody && !body) throw new Error(`[ModelManager] ${source.name}: invalid LightmassBody contract`);

	if (body) {
		if (
			!textures.diffuse ||
			!textures.normal ||
			!textures.orm ||
			!(source instanceof MeshStandardMaterial)
		) throw new Error(`[ModelManager] ${source.name}: LightmassBody requires D/N/O and original Standard material`);

		return createLightmassBodyMaterial(body, textures.diffuse, textures.normal, textures.orm, source);
	}

	const parallax = readFurnitureParallaxStar(source.userData.parallaxStar);
	if (source.userData.parallaxStar && !parallax) throw new Error(`[ModelManager] ${source.name}: invalid ParallaxStar contract`);

	if (parallax) {
		const material = createParallaxStarMaterial(parallax, textures.slots);
		copyMaterialPresentation(material, source);
		material.color.setRGB(1, 1, 1);
		material.opacity = 1;
		material.transparent = true;
		material.depthWrite = false;
		material.alphaTest = 0;
		return material;
	}

	const jewel = readFurnitureJewel(source.userData.jewel);
	if (source.userData.jewel && !jewel) throw new Error(`[ModelManager] ${source.name}: invalid jewel contract`);

	if (jewel) {
		const material = createJewelMaterial(jewel, textures.slots);
		copyMaterialPresentation(material, source);
		material.color.setRGB(1, 1, 1);
		material.opacity = 1;
		material.transparent = false;
		material.depthWrite = true;
		material.alphaTest = jewel.blend === 'masked' ? jewel.alphaCutoff : 0;
		return material;
	}

	const layered = readFurnitureLayered(source.userData.layered);
	if (source.userData.layered && !layered) throw new Error(`[ModelManager] ${source.name}: invalid layered material contract`);
	if (layered) return createLayeredMaterial(layered, textures.slots, source);

	const cloth = readFurnitureCloth(source.userData.cloth);
	if (source.userData.cloth && !cloth) throw new Error(`[ModelManager] ${source.name}: invalid Cloth contract`);
	if (cloth) return createClothMaterial(cloth, textures.diffuse, textures.normal, textures.orm, textures.tint, source);

	const mirror = readFurnitureMirror(source.userData.mirror);
	if (source.userData.mirror && !mirror) throw new Error(`[ModelManager] ${source.name}: invalid Mirror contract`);

	if (mirror) {
		const material = createMirrorMaterial(mirror, textures.slots, source);
		copyMaterialPresentation(material, source);
		return material;
	}

	const feather = readFurnitureLongFeather(source.userData.longFeather);
	if (source.userData.longFeather && !feather) throw new Error(`[ModelManager] ${source.name}: invalid LongFeather contract`);

	if (feather) {
		if (readTextureInputs(source.userData)?.N?.normalEncoding !== 'native-rg') throw new Error(
			`[ModelManager] ${source.name}: LongFeather requires preserved native RG transport`,
		);

		return createLongFeatherMaterial(feather, textures.slots, source);
	}

	const lace = readFurnitureTranslucentLace(source.userData.translucentLace);
	if (source.userData.translucentLace && !lace) throw new Error(`[ModelManager] ${source.name}: invalid translucent lace contract`);

	if (lace) {
		if (!textures.diffuse || !textures.normal || !textures.tint) throw new Error(`[ModelManager] ${source.name}: translucent lace requires native D/N/T`);

		const inputs = readTextureInputs(source.userData);
		if (inputs?.N?.normalEncoding !== 'native-rg' || inputs?.T?.normalEncoding !== 'native-rg') throw new Error(
			`[ModelManager] ${source.name}: translucent lace requires preserved native R/G transport`,
		);

		const signs = translucentLaceNormalSigns(source);
		return createTranslucentLaceMaterial(
			lace,
			{
				albedo: textures.diffuse,
				normal: textures.normal,
				detailNormal: textures.tint,
				normalSigns: signs,
				detailNormalSigns: signs,
			},
			source,
		);
	}

	const foam = readFurnitureFoam(source.userData.foam);
	if (source.userData.foam && !foam) throw new Error(`[ModelManager] ${source.name}: invalid Foam contract`);

	if (foam) {
		const material = createFoamMaterial(foam, textures.diffuse, textures.normal, textures.orm, textures.tint);
		copyMaterialPresentation(material, source);
		material.color.setRGB(1, 1, 1);
		material.opacity = 1;
		material.vertexColors = false;
		material.transparent = foam.mode === 'surface';
		material.depthWrite = foam.mode !== 'surface';
		material.alphaTest = foam.mode === 'surface' ? 0 : foam.cutoff;
		if (material instanceof MeshStandardMaterial) {
			material.emissive.setRGB(...foam.emission);
			material.emissiveIntensity = 1;
			material.emissiveMap = null;
		}

		return material;
	}

	const scene = readFurnitureScene(source.userData.scene);
	if (source.userData.scene && !scene) throw new Error(`[ModelManager] ${source.name}: invalid Scene contract`);

	if (scene) {
		if (!textures.diffuse || !textures.normal || !textures.orm) throw new Error(`[ModelManager] ${source.name}: captured scene core requires D/N/O textures`);

		return createSceneMaterial(scene, textures.diffuse, textures.normal, textures.orm, source, textures.tint, textures.slots.N1 ?? null);
	}

	const effect = readFurnitureEffect(source.userData.effect);
	if (source.userData.effect && !effect) throw new Error(`[ModelManager] ${source.name}: invalid Effect contract`);

	if (effect) {
		const material = createEffectMaterial(
			effect,
			textures.diffuse,
			textures.orm,
			textures.tint,
			textures.slots.D1 ?? null,
			textures.slots.D2 ?? null,
		);
		const color = material.color.clone();
		const opacity = material.opacity;
		const blending = material.blending;
		copyMaterialPresentation(material, source);
		material.color.copy(color);
		material.opacity = opacity;
		material.blending = blending;
		material.vertexColors = false;
		material.transparent = true;
		material.alphaTest = 0;
		material.depthWrite = false;
		return material;
	}

	const foliage = readFurnitureFoliage(source.userData.foliage);
	if (source.userData.foliage && !foliage) throw new Error(`[ModelManager] ${source.name}: invalid Foliage contract`);
	if (foliage && (!textures.diffuse || !textures.orm)) throw new Error(`[ModelManager] ${source.name}: Foliage requires D/O inputs`);

	if (foliage && textures.diffuse && textures.orm) {
		const material = createFoliageMaterial(
			foliage,
			textures.diffuse,
			textures.normal,
			textures.orm,
			textures.tint,
			textures.slots.S ?? null,
			{
				glow: textures.slots.B ?? null,
				glowMask: textures.slots.M ?? null,
				normalEncoding: readTextureInputs(source.userData)?.N?.normalEncoding,
			},
		);
		const opacity = material.opacity;
		const alphaTest = material.alphaTest;
		copyMaterialPresentation(material, source);
		material.color.setRGB(1, 1, 1);
		material.vertexColors = false;
		material.side = DoubleSide;
		material.transparent = false;
		material.opacity = opacity;
		material.alphaTest = alphaTest;
		material.depthWrite = true;
		material.emissiveMap = null;
		return material;
	}

	const water = readFurnitureWater(source.userData.water);
	if (source.userData.water && !water) throw new Error(`[ModelManager] ${source.name}: invalid Water contract`);

	const glintDetail = readFurnitureWaterGlintDetail(source.userData.waterGlintDetail);
	if (source.userData.waterGlintDetail && (!glintDetail || !water || water.core !== 'glint')) throw new Error(`[ModelManager] ${source.name}: invalid WaterGlintDetail contract`);

	if (water) {
		const material = createWaterMaterial(
			water,
			textures.diffuse,
			textures.normal,
			source,
			glintDetail ? null : textures.orm,
			glintDetail ? null : textures.tint,
			textures.slots.D1 ?? null,
			textures.slots.N1 ?? null,
		);
		if (glintDetail) applyWaterGlintDetail(material, glintDetail, textures.slots);
		return material;
	}

	const glass = readFurnitureGlass(source.userData.glass);
	if (source.userData.glass && !glass) throw new Error(`[ModelManager] ${source.name}: invalid Glass contract`);

	if (glass) {
		const material = createGlassMaterial(glass, textures.diffuse, textures.orm);
		copyMaterialPresentation(material, source);
		material.color.setRGB(...glass.color);
		material.opacity =
			glass.colorMode === 'stained-window-preview'
				? glass.baseBlend
				: Math.max(0, Math.min(1, glass.opacity));
		material.transparent = glass.colorMode !== 'stained-home-opaque';
		material.depthWrite = glass.colorMode === 'stained-home-opaque';
		return material;
	}

	const surfaceExtra = readFurnitureSurfaceExtra(source.userData.surfaceExtra);
	if (source.userData.surfaceExtra && !surfaceExtra) throw new Error(`[ModelManager] ${source.name}: invalid SurfaceExtra contract`);

	const surface = surfaceExtra?.core ?? readFurnitureSurface(source.userData.surface);
	if (source.userData.surface && !surface) throw new Error(`[ModelManager] ${source.name}: invalid Surface contract`);

	const render = source.userData.render as
		| { unlit?: boolean; packed?: string; blend?: string }
		| undefined;
	const material = source as MeshStandardMaterial;
	const usePackedPbr = !!textures.orm && (!!surface || render?.packed === 'orm');

	const params: MeshStandardMaterialParameters = {
		roughness: material.isMeshStandardMaterial ? material.roughness : 1,
		metalness: usePackedPbr
			? material.isMeshStandardMaterial
				? material.metalness
				: 1
			: material.isMeshStandardMaterial && material.metalnessMap
				? material.metalness
				: 0,
		normalScale: new Vector2(1, 1),
		aoMapIntensity: material.isMeshStandardMaterial ? material.aoMapIntensity : 1,
	};

	if (textures.diffuse) params.map = textures.diffuse;
	if (textures.normal) params.normalMap = textures.normal;
	if (usePackedPbr) {
		params.roughnessMap = textures.orm;
		params.metalnessMap = textures.orm;
		params.aoMap = textures.orm;
	} else if (material.isMeshStandardMaterial) {
		// Standard glTF maps have declared semantics; O extras without a producer
		// contract do not. Preserve the former without guessing the latter's channels.
		params.roughnessMap = material.roughnessMap;
		params.metalnessMap = material.metalnessMap;
		params.aoMap = material.aoMap;
	}

	const mat =
		(render?.unlit || source instanceof MeshBasicMaterial) && !surface
			? new MeshBasicMaterial({ map: textures.diffuse })
			: new MeshStandardMaterial(params);
	copyMaterialPresentation(mat, source);

	// Native consumers above retain their own UV/sampling contracts. Only the
	// standard glTF pass rebinds images through the original per-map state.
	if (!surface) {
		for (const slot of standardTextureSlots) {
			if (!(slot in mat)) continue;
			const binding = textures.standardMaps?.[slot] ?? (source as Material & StandardTextures)[slot];
			if (binding) (mat as Material & StandardTextures)[slot] = binding;
		}
	}

	if (surface && mat instanceof MeshStandardMaterial) {
		mat.color.setRGB(...surface.color);
		if (surface.translucent)
			applyTranslucentHbcShader(mat, surface, textures.orm, textures.tint, textures.slots.N1 ?? null);
		else if (surface.triplanar) applyTriplanarHbcShader(mat, surface, textures.orm, textures.tint);
		else if (surfaceExtra)
			applySurfaceExtraShader(
				mat,
				surfaceExtra,
				textures.orm,
				textures.tint,
				textures.slots.N1 ?? null,
				textures.slots.T1 ?? null,
				textures.slots.O1 ?? null,
			);
		else {
			applySurfaceShader(mat, surface, textures.orm, textures.tint);
			applyHomeSurfaceFeatures(mat, surface, textures.slots.N1 ?? null, 0);
		}
	} else if (readTextureInputs(source.userData)?.T?.usage === 'palette') {
		mat.dispose();
		throw new Error(`[Furniture] ${source.name}: palette input requires a declared material consumer`);
	}

	switch (render?.blend) {
	case 'additive':
		mat.transparent = true;
		mat.depthWrite = false;
		mat.blending = AdditiveBlending;
		break;
	case 'modulate':
		mat.transparent = true;
		mat.depthWrite = false;
		mat.blending = MultiplyBlending;
		break;
	}

	return mat;
}

function copyMaterialPresentation(target: Material, source: Material): void {
	target.name = source.name;
	target.userData = { ...source.userData };
	target.side = source.side;
	target.transparent = source.transparent;
	target.opacity = source.opacity;
	target.alphaTest = source.alphaTest;
	target.depthWrite = source.depthWrite;
	target.depthTest = source.depthTest;
	target.colorWrite = source.colorWrite;
	target.toneMapped = source.toneMapped;
	target.premultipliedAlpha = source.premultipliedAlpha;
	target.blending = source.blending;
	target.visible = source.visible;

	const targetColor = (target as Material & { color?: Color }).color;
	const sourceColor = (source as Material & { color?: Color }).color;
	if (targetColor?.isColor && sourceColor?.isColor) targetColor.copy(sourceColor);

	if ((target as any).isMeshStandardMaterial && (source as any).isMeshStandardMaterial) {
		const targetMat = target as MeshStandardMaterial;
		const sourceMat = source as MeshStandardMaterial;
		// GLTFLoader chooses this sign from the geometry's explicit/derivative TBN.
		// Rebuilding a material for plain or dyed variants must not reset that choice.
		targetMat.normalScale.copy(sourceMat.normalScale);
		targetMat.normalMapType = sourceMat.normalMapType;
		targetMat.flatShading = sourceMat.flatShading;
		targetMat.emissive.copy(sourceMat.emissive);
		targetMat.emissiveIntensity = sourceMat.emissiveIntensity;
		targetMat.emissiveMap = sourceMat.emissiveMap;
	}
}

function prepareModelMaterial(material: Material): Material {
	// Furniture UV transforms are authored during construction; dye edits rebuild
	// their sampler bindings. Precompute once instead of on every material draw.
	for (const value of Object.values(material)) {
		if (value instanceof Texture && value.matrixAutoUpdate) {
			value.updateMatrix();
			value.matrixAutoUpdate = false;
		}
	}

	return applyEnvironmentLighting(material);
}

export async function buildDefaultPlainMaterial(sourceMat: Material, baseName: string | null, registry: MaterialRegistry): Promise<Material> {
	if (
		sourceMat.userData.nncloth &&
		(sourceMat.userData.nnclothPreview || sourceMat.userData.editorPreview)
	) throw new Error('[ModelManager] native and editor NNCloth contracts conflict');
	if (sourceMat.userData.nncloth) return createNNClothMaterial(sourceMat);

	if (sourceMat.userData.waterFx) {
		const options = sourceMat.userData.waterFxMaterialOptions as WaterFxMaterialOptions | undefined;
		if (!options) throw new Error('[ModelManager][X6FX] native per-slot geometry/component admission missing');

		return createWaterFxResourceMaterial(sourceMat, options);
	}

	const hasProfile = [
		'clothStaticCore',
		'liquidVolumeStatic',
		'animalMaskedCurrent',
		'diamondBillboardCurrent',
		'crystalPreview',
		'inkPreview',
		'staticEffectCarrier',
		'ledSignPreview',
		'waterSmallProp',
		'nnclothUA2Preview',
		'opalPreview',
		'animalSimpleTrans',
		'editorPreview',
		'nnclothPreview',
		'parallaxCard',
		'cabinetStatic',
		'translucentCrystal',
		'translucentLace',
		'fxPbr',
		'surfaceExtra',
		'lightmassBody',
		'lightmassCurrent',
		'parallaxStar',
		'jewel',
		'characterJewel',
		'intStaticMeshCurrent',
		'sceneJewelCurrent',
		'sphereBillboardCurrent',
		'absFxCurrent',
		'layered',
		'cloth',
		'longFeather',
		'mirror',
		'foam',
		'scene',
		'surface',
		'glass',
		'water',
		'foliage',
		'effect',
		'render',
	].some((key) => sourceMat.userData[key] !== undefined);
	if (!baseName && !hasProfile) return prepareModelMaterial(sourceMat);

	const resolvedTextures = await resolveMaterialTextures({
		sourceMat,
		registryEntry: baseName ? registry.get(baseName) : undefined,
	});

	if (!hasResolvedTextures(resolvedTextures) && !hasProfile) return prepareModelMaterial(sourceMat);

	const resolvedMat = createModelMaterial(resolvedTextures, sourceMat);
	return prepareModelMaterial(resolvedMat);
}

const sourceOrigins = new WeakMap<Material, Material>();

function isReusableStandardSource(source: Material): boolean {
	return (
		source instanceof MeshStandardMaterial &&
		Object.getPrototypeOf(source) === MeshStandardMaterial.prototype &&
		!source.transparent &&
		source.userData.render !== undefined &&
		Object.keys(source.userData).every((key) => key === 'render' || key === 'textureInputs') &&
		source.onBeforeCompile === Material.prototype.onBeforeCompile &&
		source.onBeforeRender === Material.prototype.onBeforeRender &&
		source.customProgramCacheKey === Material.prototype.customProgramCacheKey
	);
}

function sameStandardSource(a: Material, b: Material): boolean {
	const left = a as unknown as Record<string, any>;
	const right = b as unknown as Record<string, any>;
	const keys = Object.keys(left).filter((key) => key !== 'uuid' && key !== '_listeners');
	if (
		keys.length !==
		Object.keys(right).filter((key) => key !== 'uuid' && key !== '_listeners').length
	) return false;

	return keys.every((key) => {
		if (!Object.prototype.hasOwnProperty.call(right, key)) return false;

		const x = left[key];
		const y = right[key];
		if (x === y) return true;
		if (key === 'userData' || key === 'defines') return JSON.stringify(x) === JSON.stringify(y);

		return (
			x && y && x.constructor === y.constructor && typeof x.equals === 'function' && x.equals(y)
		);
	});
}

/** Item-local reuse preserves source identity, all presentation/sampler state and
 * the original slot array. Native consumers and per-slot callbacks stay separate. */
export function createPlainMaterialBuilder(registry: MaterialRegistry) {
	const cache = new WeakMap<
		Material,
		{ source: Material; baseName: string | null; ready: Promise<Material> }[]
	>();
	return (source: Material, baseName: string | null): Promise<Material> => {
		const origin = sourceOrigins.get(source) ?? source;
		if (!isReusableStandardSource(source) || !isReusableStandardSource(origin)) return buildDefaultPlainMaterial(source, baseName, registry);

		const entries = cache.get(origin) ?? [];
		const existing = entries.find((entry) => entry.baseName === baseName && sameStandardSource(entry.source, source));
		if (existing) return existing.ready;

		const ready = buildDefaultPlainMaterial(source, baseName, registry);
		entries.push({ source, baseName, ready });
		cache.set(origin, entries);
		return ready;
	};
}

/** Clone the inline material template while keeping item admission local. */
export function cloneSourceMaterialForItem(source: Material): Material {
	const cloned = source.clone();
	cloned.userData = { ...(source.userData as Record<string, unknown>) };
	sourceOrigins.set(cloned, sourceOrigins.get(source) ?? source);
	return cloned;
}

/** Merge definition-qualified material names while preserving aliases. */
export function mergeMaterialRegistry(target: MaterialRegistry, source: MaterialRegistry): void {
	for (const [baseName, sourceEntry] of source.entries()) {
		const targetEntry = getOrCreateRegistryEntry(target, baseName);
		for (const type of TEXTURE_SLOTS) {
			for (const [variantIdx, ref] of sourceEntry[type].entries()) {
				const existingRef = targetEntry[type].get(variantIdx);
				if (!existingRef) {
					targetEntry[type].set(variantIdx, ref);
				}
			}
		}
	}
}

/** Registry borrows decoder sources; their resource owner releases them after all item materials. */
export function disposeMaterialRegistry(registry: MaterialRegistry): void {
	for (const entry of registry.values()) {
		for (const type of TEXTURE_SLOTS) {
			for (const ref of entry[type].values()) {
				ref._disposed = true;
				delete ref._cache;
				ref._loading = undefined;
			}
		}
	}
}

/** Create lazy image references in the producer's declared layer order. */
export function buildMaterialRegistryFromDefinition(
	definition: FurnitureMaterialDefinition,
	resources: FurnitureResources,
	quality: ModelAssetProfile,
): MaterialRegistry {
	const materialRegistry: MaterialRegistry = new Map();

	const inputs = readTextureInputs(definition.extras ?? {});
	if (!inputs) return materialRegistry;

	const baseName = definition.name;
	if (!baseName?.trim()) throw new Error('Material textureInputs requires a stable source material name');
	// A declared textureless material still needs an entry when its mesh is dyed.
	const entry = getOrCreateRegistryEntry(materialRegistry, baseName);

	const standardInfos = {
		map: definition.pbrMetallicRoughness?.baseColorTexture,
		normalMap: definition.normalTexture,
		roughnessMap: definition.pbrMetallicRoughness?.metallicRoughnessTexture,
		metalnessMap: definition.pbrMetallicRoughness?.metallicRoughnessTexture,
		aoMap: definition.occlusionTexture,
		emissiveMap: definition.emissiveTexture,
	};

	const standardRoles = new Map<StandardTextureSlot, TextureSlot>();
	for (const slot of standardTextureSlots) {
		const info = standardInfos[slot];
		if (!info) continue;
		const matches = Object.entries(inputs).filter(([, input]) => input.images.includes(info.resource));
		// Multiple native roles may alias one image. Without a unique owner keep
		// the standard map unchanged, rather than selecting an arbitrary role.
		if (matches.length === 1) standardRoles.set(slot, matches[0]![0] as TextureSlot);
	}

	for (const [key, input] of Object.entries(inputs)) {
		const type = key as TextureSlot;
		const standardSlots = standardTextureSlots.filter((slot) => standardRoles.get(slot) === type);
		input.images.forEach((resource, variantIdx) => {
			if (!/^t-[a-f0-9]{16}$/.test(resource)) throw new Error(`[Furniture] Invalid image resource ID ${resource}`);

			entry[type].set(variantIdx, { resource, resources, quality, standardSlots });
		});
	}

	return materialRegistry;
}

export function summarizeRegistryTextureSources(materialRegistry: MaterialRegistry): TextureSourceSummary {
	let textureReferences = 0;

	for (const entry of materialRegistry.values()) {
		for (const type of TEXTURE_SLOTS) {
			textureReferences += entry[type].size;
		}
	}

	return { textureReferences };
}
