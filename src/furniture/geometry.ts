import {
	Box3,
	Float32BufferAttribute,
	Matrix4,
	MeshStandardMaterial,
	Quaternion,
	TangentSpaceNormalMap,
	Vector3,
	type BufferGeometry,
	type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type {
	FurnitureModelConfig,
	FurnitureAssetSelection,
	FurnitureMeshConfig,
} from './types.js';
import type { MeshAssetData } from './assets.js';
import {
	createPlainMaterialBuilder,
	cloneSourceMaterialForItem,
	mergeMaterialRegistry,
	type MaterialRegistry,
} from '../materials/factory.js';
import { readFurnitureSurface, SURFACE_EMISSION_ATTRIBUTE } from '../materials/surface/surfaceShader.js';
import { homeWallBasis } from '../materials/surface/homeSurfaceFeatures.js';
import { readFurnitureSurfaceExtra, surfaceExtraUVChannels } from '../materials/surface/surfaceExtraShader.js';
import {
	readFurnitureFoliage,
	FOLIAGE_ALPHA_ATTRIBUTE,
	FOLIAGE_RED_ATTRIBUTE,
	FOLIAGE_GRADIENT_ATTRIBUTE,
	FOLIAGE_SPECULAR_UV_ATTRIBUTE,
} from '../materials/foliage/foliageShader.js';
import { EFFECT_UV1_ATTRIBUTE, readFurnitureEffect } from '../materials/effects/effectShader.js';
import {
	BOTTLE_POSITION_ATTRIBUTE,
	readFurnitureGlass,
	setBottleLiquidCoordinates,
} from '../materials/glass/glassShader.js';
import { FOAM_MASK_ATTRIBUTE, readFurnitureFoam } from '../materials/effects/foamShader.js';
import { readFurnitureCloth } from '../materials/cloth/clothShader.js';
import { readFurnitureClothStaticCore } from '../materials/cloth/clothStaticCoreShader.js';
import { readFurnitureLongFeather, validateLongFeatherGeometry } from '../materials/cloth/longFeatherShader.js';
import { readFurnitureMirror, validateMirrorGeometry } from '../materials/glass/mirrorShader.js';
import { readFurnitureLayered } from '../materials/layered/layeredShader.js';
import {
	ROCK_PROJECTION_RAW_ATTRIBUTES,
	transformRockProjectionRawBasis,
} from '../materials/layered/rockProjectionRawBasis.js';
import { readFurnitureJewel } from '../materials/jewel/jewelShader.js';
import {
	JEWEL_HEIGHT_ATTRIBUTE,
	mergeJewelGeometryProofs,
	restoreJewelGeometryProof,
} from '../materials/jewel/jewelGeometry.js';
import {
	JEWELRY_MASKED_ATTRIBUTES,
	restoreJewelryMaskedGeometry,
	transformJewelryMaskedGeometry,
	mergeJewelryMaskedGeometry,
} from '../materials/jewel/jewelryMaskedGeometry.js';
import { readFurnitureTranslucentCrystal } from '../materials/glass/translucentCrystalShader.js';
import {
	mergeTranslucentCrystalGeometryProofs,
	restoreTranslucentCrystalGeometryProof,
} from '../materials/glass/translucentCrystalGeometry.js';
import { readFurnitureParallaxCard } from '../materials/effects/parallaxCardShader.js';
import {
	mergeParallaxCardGeometryProofs,
	restoreParallaxCardGeometryProof,
	transformParallaxCardGeometryProof,
} from '../materials/effects/parallaxCardGeometry.js';
import {
	PARALLAX_CARD_BASIS_V2_ATTRIBUTES,
	restoreParallaxCardBasisV2,
	mergeParallaxCardBasisV2,
	transformParallaxCardBasisV2,
} from '../materials/effects/parallaxCardBasisV2.js';
import {
	CURRENT_PARALLAX_CARD_ATTRIBUTES,
	restoreCurrentParallaxCardGeometry,
	transformCurrentParallaxCardGeometry,
} from '../materials/effects/parallaxCardCurrentGeometry.js';
import { readFurnitureCharacterJewel } from '../materials/jewel/characterJewelShader.js';
import {
	CHARACTER_JEWEL_ATTRIBUTES,
	restoreCharacterJewelGeometry,
	transformCharacterJewelGeometry,
} from '../materials/jewel/characterJewelGeometry.js';
import { readFurnitureIntStaticMeshCurrent } from '../materials/surface/intStaticMeshCurrentShader.js';
import {
	INT_STATIC_MESH_CURRENT_ATTRIBUTES,
	restoreIntStaticMeshCurrentGeometry,
	transformIntStaticMeshCurrentGeometry,
} from '../materials/surface/intStaticMeshCurrentGeometry.js';
import { readFurnitureSceneJewelCurrent } from '../materials/jewel/jewelCurrentShader.js';
import {
	SCENE_JEWEL_CURRENT_ATTRIBUTES,
	restoreSceneJewelCurrentGeometry,
	transformSceneJewelCurrentGeometry,
} from '../materials/jewel/jewelCurrentGeometry.js';
import { readFurnitureSphereBillboardCurrent } from '../materials/effects/sphereBillboardCurrentShader.js';
import {
	SPHERE_BILLBOARD_CURRENT_ATTRIBUTES,
	restoreSphereBillboardCurrentGeometry,
	transformSphereBillboardCurrentGeometry,
} from '../materials/effects/sphereBillboardCurrentGeometry.js';
import { readFurnitureABSFXCurrent } from '../materials/effects/absFxCurrentShader.js';
import { readFurnitureAnimalSimpleTrans } from '../materials/effects/animalSimpleTransShader.js';
import {
	OPAL_PREVIEW_HEIGHT,
	readFurnitureOpalPreview,
	setOpalPreviewCoordinates,
} from '../materials/jewel/opalPreviewShader.js';
import { readFurnitureNNClothUA2Preview } from '../materials/nncloth/nnclothUA2PreviewShader.js';
import { readFurnitureWaterSmallProp } from '../materials/water/waterSmallPropShader.js';
import { readFurnitureWaterGlintDetail } from '../materials/water/waterGlintDetailShader.js';
import { readFurnitureInkPreview } from '../materials/effects/inkPreviewShader.js';
import { readFurnitureLiquidVolumeStatic } from '../materials/glass/liquidVolumeStaticShader.js';
import { readFurnitureCrystalPreview } from '../materials/glass/crystalPreviewShader.js';
import { readFurnitureDiamondBillboardCurrent } from '../materials/effects/diamondBillboardCurrentShader.js';
import {
	DIAMOND_BILLBOARD_CURRENT_ATTRIBUTES,
	restoreDiamondBillboardCurrentGeometry,
	transformDiamondBillboardCurrentGeometry,
} from '../materials/effects/diamondBillboardCurrentGeometry.js';
import { readFurnitureAnimalMaskedCurrent } from '../materials/effects/animalMaskedCurrentShader.js';
import {
	ANIMAL_MASKED_CURRENT_ATTRIBUTES,
	restoreAnimalMaskedCurrentGeometry,
	transformAnimalMaskedCurrentGeometry,
} from '../materials/effects/animalMaskedCurrentGeometry.js';
import { readFurnitureLEDSignPreview } from '../materials/effects/ledSignPreviewShader.js';
import {
	ABS_FX_CURRENT_ATTRIBUTES,
	restoreABSFXCurrentGeometry,
	transformABSFXCurrentGeometry,
} from '../materials/effects/absFxCurrentGeometry.js';
import { readFurnitureParallaxStar } from '../materials/effects/parallaxStarShader.js';
import { readFurnitureWater } from '../materials/water/waterShader.js';
import { assertWaterSLWGeometry } from '../materials/water/waterSLW.js';
import { readFurnitureScene } from '../materials/sceneShader.js';
import { assertCabinetStaticGeometry, readFurnitureCabinetStatic } from '../materials/surface/cabinetStaticShader.js';
import {
	NN_CLOTH_SOURCE_POSITION,
	NN_CLOTH_SOURCE_NORMAL,
	NN_CLOTH_SOURCE_TANGENT,
	NN_CLOTH_WORLD_NORMAL,
	NN_CLOTH_WORLD_TANGENT,
	assertNNClothSourceGeometry,
	transformNNClothWorldBasis,
	restoreNNClothSourceGeometry,
} from '../materials/nncloth/nnclothGeometry.js';
import { assertNNClothBoundsFrame, type NNClothBoundsFrame } from '../materials/nncloth/nnclothBounds.js';
import { readWaterFX } from '../materials/water/waterFx.js';
import {
	restoreWaterFxGeometry,
	padWaterFxMergeAttributes,
	mergeWaterFxDomains,
} from '../materials/water/waterFxGeometry.js';
import { type WaterFxMaterialOptions } from '../materials/water/waterFxMaterial.js';

const LAYER_COLOR_ATTRIBUTE = 'ueLayerColor';
const FOLIAGE_CYCLE_ATTRIBUTE = 'foliageCycleU';

export interface GeometryData {
	geometry: BufferGeometry
	plainMaterials: Material[]
	meshBaseNames: (string | null)[]
	slotMeshIndices: number[]
	mergedMaterial: Material | Material[]
	materialRegistry: MaterialRegistry
	boundingBox: Box3
	meshMaterialCounts: number[]
}

/** The offline compiler observes the same final geometry and source bindings
 * that runtime material construction uses, before temporary sources retire. */
export interface GeometryPreparationSnapshot {
	geometry: BufferGeometry
	sourceMaterials: Material[]
	meshBaseNames: (string | null)[]
	slotMeshIndices: number[]
	meshMaterialCounts: number[]
}

/** Preserve shared attributes and pad material-specific streams with neutral values. */
function normalizeGeometryAttributes(geometries: BufferGeometry[]): void {
	if (geometries.length <= 1) return;

	const attributeSets = geometries.map((geom) => new Set(Object.keys(geom.attributes)));
	const commonAttributes = new Set(attributeSets[0]);

	for (let index = 1; index < attributeSets.length; index++) {
		const currentSet = attributeSets[index]!;
		for (const attr of commonAttributes) {
			if (!currentSet.has(attr)) commonAttributes.delete(attr);
		}
	}

	const unionAttributes = new Set<string>();
	if (geometries.some((geometry) => geometry.hasAttribute(OPAL_PREVIEW_HEIGHT)))
		unionAttributes.add(OPAL_PREVIEW_HEIGHT);

	for (const attrSet of attributeSets) {
		for (const attr of attrSet) {
			if (
				ANIMAL_MASKED_CURRENT_ATTRIBUTES.includes(attr) ||
				DIAMOND_BILLBOARD_CURRENT_ATTRIBUTES.includes(attr) ||
				JEWELRY_MASKED_ATTRIBUTES.includes(attr) ||
				ROCK_PROJECTION_RAW_ATTRIBUTES.includes(attr) ||
				PARALLAX_CARD_BASIS_V2_ATTRIBUTES.includes(attr) ||
				CURRENT_PARALLAX_CARD_ATTRIBUTES.some((name) => name === attr) ||
				CHARACTER_JEWEL_ATTRIBUTES.includes(attr) ||
				INT_STATIC_MESH_CURRENT_ATTRIBUTES.includes(attr) ||
				SCENE_JEWEL_CURRENT_ATTRIBUTES.includes(attr) ||
				SPHERE_BILLBOARD_CURRENT_ATTRIBUTES.includes(attr) ||
				ABS_FX_CURRENT_ATTRIBUTES.includes(attr) ||
				attr === 'color' ||
				attr.startsWith('color_') ||
				['uv1', 'uv2', 'uv3'].includes(attr) ||
				[
					LAYER_COLOR_ATTRIBUTE,
					'ueLongFeatherColor',
					FOLIAGE_RED_ATTRIBUTE,
					FOLIAGE_GRADIENT_ATTRIBUTE,
					FOLIAGE_SPECULAR_UV_ATTRIBUTE,
					FOLIAGE_CYCLE_ATTRIBUTE,
					JEWEL_HEIGHT_ATTRIBUTE,
					NN_CLOTH_SOURCE_POSITION,
					NN_CLOTH_SOURCE_NORMAL,
					NN_CLOTH_SOURCE_TANGENT,
					NN_CLOTH_WORLD_NORMAL,
					NN_CLOTH_WORLD_TANGENT,
				].includes(attr) ||
				attr === EFFECT_UV1_ATTRIBUTE ||
				attr === BOTTLE_POSITION_ATTRIBUTE ||
				attr === SURFACE_EMISSION_ATTRIBUTE ||
				attr === FOLIAGE_ALPHA_ATTRIBUTE ||
				attr === FOAM_MASK_ATTRIBUTE
			) {
				unionAttributes.add(attr);
			}
		}
	}

	for (const geom of geometries) {
		const attrs = Object.keys(geom.attributes);

		for (const attr of attrs) {
			if (!commonAttributes.has(attr) && !unionAttributes.has(attr)) {
				geom.deleteAttribute(attr);
			}
		}

		for (const unionAttr of unionAttributes) {
			if (geom.attributes[unionAttr]) continue;

			const vertexCount = geom.attributes.position?.count;
			if (!vertexCount) continue;

			let referenceAttr = null;
			for (const refGeom of geometries) {
				if (refGeom.attributes[unionAttr]) {
					referenceAttr = refGeom.attributes[unionAttr];
					break;
				}
			}

			if (!referenceAttr) continue;

			const itemSize = referenceAttr.itemSize;
			const normalized = referenceAttr.normalized;
			const ArrayType = referenceAttr.array.constructor as any;
			const dataArray = new ArrayType(vertexCount * itemSize);

			const isColorAttr =
				unionAttr === 'color' ||
				unionAttr.startsWith('color_') ||
				unionAttr === FOLIAGE_ALPHA_ATTRIBUTE ||
				unionAttr === FOAM_MASK_ATTRIBUTE;
			const fillValue = isColorAttr ? (ArrayType === Float32Array ? 1.0 : 255) : 0;
			for (let index = 0; index < dataArray.length; index++) {
				dataArray[index] = fillValue;
			}

			const BufferAttrType = referenceAttr.constructor as any;
			geom.setAttribute(unionAttr, new BufferAttrType(dataArray, itemSize, normalized));
		}
	}
}

/** Restore front-face winding after mirror baking. */
function reverseGeometryWinding(geometry: BufferGeometry): void {
	const index = geometry.getIndex();

	if (index) {
		const array = index.array;
		for (let cursor = 0; cursor < array.length; cursor += 3) {
			const second = array[cursor + 1];
			array[cursor + 1] = array[cursor + 2]!;
			array[cursor + 2] = second!;
		}

		index.needsUpdate = true;
		return;
	}

	for (const attribute of Object.values(geometry.attributes)) {
		for (let vertexIndex = 0; vertexIndex < attribute.count; vertexIndex += 3) {
			for (let componentIndex = 0; componentIndex < attribute.itemSize; componentIndex++) {
				const second = attribute.getComponent(vertexIndex + 1, componentIndex);
				const third = attribute.getComponent(vertexIndex + 2, componentIndex);
				attribute.setComponent(vertexIndex + 1, componentIndex, third);
				attribute.setComponent(vertexIndex + 2, componentIndex, second);
			}
		}

		attribute.needsUpdate = true;
	}
}

/** Bake transforms without changing the authored normal-map basis. */
export function applyGeometryTransform(geometry: BufferGeometry, matrix: Matrix4): void {
	transformJewelryMaskedGeometry(geometry, matrix);
	transformParallaxCardGeometryProof(geometry, matrix);
	transformParallaxCardBasisV2(geometry, matrix);
	transformCurrentParallaxCardGeometry(geometry, matrix);
	transformCharacterJewelGeometry(geometry, matrix);
	transformIntStaticMeshCurrentGeometry(geometry, matrix);
	transformSceneJewelCurrentGeometry(geometry, matrix);
	transformSphereBillboardCurrentGeometry(geometry, matrix);
	transformDiamondBillboardCurrentGeometry(geometry, matrix);
	transformAnimalMaskedCurrentGeometry(geometry, matrix);
	transformABSFXCurrentGeometry(geometry, matrix);
	transformNNClothWorldBasis(geometry, matrix);
	transformRockProjectionRawBasis(geometry, matrix);

	const boundsFrame = geometry.userData.nnclothBoundsFrame as NNClothBoundsFrame | undefined;
	if (boundsFrame) {
		assertNNClothBoundsFrame(boundsFrame);
		geometry.userData.nnclothBoundsFrame = {
			...boundsFrame,
			nativeToGeometry: matrix
				.clone()
				.multiply(new Matrix4().fromArray(boundsFrame.nativeToGeometry))
				.toArray(),
		};
	}

	geometry.applyMatrix4(matrix);
	if (matrix.determinant() >= 0) return;

	reverseGeometryWinding(geometry);

	// Three.js transforms tangent.xyz only; B = cross(N, T) * w needs the mirror sign too.
	const tangent = geometry.getAttribute('tangent');
	if (!tangent) return;

	for (let index = 0; index < tangent.count; index++) {
		tangent.setW(index, -tangent.getW(index));
	}

	tangent.needsUpdate = true;
}

/** Transform and merge admitted geometry sections with catalog-local material slots. */
export async function processGeometryForItem(
	itemId: number,
	config: FurnitureModelConfig,
	selection: FurnitureAssetSelection,
	getMeshAsset: (
		mesh: FurnitureMeshConfig,
		selection: FurnitureAssetSelection,
	) => Promise<MeshAssetData | null>,
	capture?: (snapshot: GeometryPreparationSnapshot) => void,
): Promise<GeometryData | undefined> {
	const allGeometries: BufferGeometry[] = [];
	const sourceMaterials: Material[] = [];

	const ownedGeometries = new Set<BufferGeometry>();
	const ownedMaterials = new Set<Material>();
	let retainedGeometry: BufferGeometry | undefined;
	const retainedMaterials = new Set<Material>();

	const meshBaseNames: (string | null)[] = [];
	const slotMeshIndices: number[] = [];
	const meshMaterialCounts: number[] = [];
	const materialRegistry: MaterialRegistry = new Map();

	const tempMatrix = new Matrix4();
	const tempQuat = new Quaternion();
	const tempScale = new Vector3();
	const tempTrans = new Vector3();

	// Load shared mesh assets before ordered assembly.
	const assetResults = await Promise.allSettled(config.meshes.map((meshConfig) => getMeshAsset(meshConfig, selection)));
	const loadFailure = assetResults.find((result) => result.status === 'rejected');
	if (loadFailure?.status === 'rejected') {
		for (const result of assetResults) if (result.status === 'fulfilled') result.value?.dispose();

		throw loadFailure.reason;
	}

	const meshAssets = assetResults.map((result) => result.status === 'fulfilled' ? result.value : null);

	try {
		// Preserve source component and material slot order.
		for (let meshIdx = 0; meshIdx < config.meshes.length; meshIdx++) {
			const meshConfig = config.meshes[meshIdx]!;
			const meshPath = meshConfig.models[selection.model]?.path;
			const meshAsset = meshAssets[meshIdx];

			if (!meshAsset) {
				console.warn(`[ModelManager] Failed to load mesh: ${meshPath}`);
				meshMaterialCounts.push(0);
				continue;
			}

			const materialCountBefore = sourceMaterials.length;
			mergeMaterialRegistry(materialRegistry, meshAsset.materialRegistry);

			let bottleBounds: Box3 | null = null;
			if (
				meshAsset.meshEntries.some((entry) => readFurnitureGlass(entry.material.userData.glass)?.bottleLiquid)
			) {
				bottleBounds = new Box3();
				// All sections of this source asset, never the merged furniture bounds.
				for (const entry of meshAsset.meshEntries) {
					if (!entry.geometry.boundingBox) entry.geometry.computeBoundingBox();
					if (entry.geometry.boundingBox) bottleBounds.union(entry.geometry.boundingBox);
				}
			}

			let waterCenter: Vector3 | null = null;
			if (
				meshAsset.meshEntries.some((entry) => {
					const water = readFurnitureWater(entry.material.userData.water);
					return water?.common || water?.caustics || entry.material.userData.waterFx;
				})
			) {
				// One imported component, including all of its material sections. These
				// are preview bounds, not a claim about the source game's live primitive.
				const bounds = new Box3();
				for (const entry of meshAsset.meshEntries) {
					if (!entry.geometry.boundingBox) entry.geometry.computeBoundingBox();
					if (entry.geometry.boundingBox)
						bounds.union(entry.geometry.boundingBox.clone().applyMatrix4(entry.localMatrix));
				}

				if (bounds.isEmpty()) throw new Error(`[ModelManager] ${meshPath}: water component bounds missing`);

				waterCenter = bounds.getCenter(new Vector3());
			}

			for (const meshEntry of meshAsset.meshEntries) {
				const geom = meshEntry.geometry.clone();
				ownedGeometries.add(geom);
				// Furniture uses ordinary InstancedMesh in static rest pose, not skinning.
				// Keeping unused joint streams also prevents merging uint8/uint16 Draco IDs.
				for (const attribute of ['skinIndex', 'skinWeight', 'joints_1', 'weights_1']) {
					geom.deleteAttribute(attribute);
				}

				const foliageAlpha = geom.getAttribute('_foliage_alpha');
				if (foliageAlpha) {
					geom.setAttribute(FOLIAGE_ALPHA_ATTRIBUTE, foliageAlpha);
					geom.deleteAttribute('_foliage_alpha');
				}

				const emissionMask = geom.getAttribute('_surface_emission');
				if (emissionMask) {
					geom.setAttribute(SURFACE_EMISSION_ATTRIBUTE, emissionMask);
					geom.deleteAttribute('_surface_emission');
				}

				const foamMask = geom.getAttribute('_foam_mask');
				if (foamMask) {
					geom.setAttribute(FOAM_MASK_ATTRIBUTE, foamMask);
					geom.deleteAttribute('_foam_mask');
				}

				const sourceMaterial = cloneSourceMaterialForItem(meshEntry.material);
				ownedMaterials.add(sourceMaterial);

				const opal = readFurnitureOpalPreview(sourceMaterial.userData.opalPreview);
				if (sourceMaterial.userData.opalPreview && !opal) throw new Error(`[ModelManager] ${meshPath}: invalid Opal14 contract`);

				if (opal) setOpalPreviewCoordinates(geom);
				const waterFx = readWaterFX(sourceMaterial.userData.waterFx);
				if (sourceMaterial.userData.waterFx && !waterFx) throw new Error(`[ModelManager] ${meshPath}: invalid native WaterFX profile`);

				if (waterFx) await restoreWaterFxGeometry(geom, waterFx);
				restoreNNClothSourceGeometry(geom, sourceMaterial.userData.nnclothSourceGeometry);
				if (geom.hasAttribute(NN_CLOTH_SOURCE_NORMAL) || sourceMaterial.userData.nncloth) {
					assertNNClothSourceGeometry(geom, sourceMaterial.userData.nncloth?.requiredUV ?? [0, 1, 2]);
					assertNNClothBoundsFrame(geom.userData.nnclothBoundsFrame);
				}

				const water = readFurnitureWater(sourceMaterial.userData.water);
				const scene = readFurnitureScene(sourceMaterial.userData.scene);
				const cabinet = readFurnitureCabinetStatic(sourceMaterial.userData.cabinetStatic);
				if (sourceMaterial.userData.cabinetStatic && !cabinet) throw new Error(`[ModelManager] ${meshPath}: invalid CabinetStatic contract`);
				// Original section streams, before transforms and union UV padding.
				if (cabinet) assertCabinetStaticGeometry(geom, cabinet);
				if (water?.slw || water?.slwStatic || water?.nature?.wave) assertWaterSLWGeometry(geom);
				if (
					scene?.detailNormal &&
					(!geom.hasAttribute('tangent') ||
						(scene.detailNormal.adjust[0] !== 0 && !geom.hasAttribute('uv1')))
				) throw new Error(`[ModelManager] ${meshPath}: Scene detail normal requires its original tangent/UV inputs`);

				const foliage = readFurnitureFoliage(sourceMaterial.userData.foliage);
				if (sourceMaterial.userData.foliage && !foliage) throw new Error(`[ModelManager] ${meshPath}: invalid foliage material contract`);

				if (foliage?.home) {
					for (const [source, target] of [
						['_foliage_red', FOLIAGE_RED_ATTRIBUTE],
						['_foliage_gradient', FOLIAGE_GRADIENT_ATTRIBUTE],
						['_foliage_specular_uv', FOLIAGE_SPECULAR_UV_ATTRIBUTE],
						['_foliage_cycle_u', FOLIAGE_CYCLE_ATTRIBUTE],
					] as const) {
						const attribute = geom.getAttribute(source);
						if (attribute) {
							geom.setAttribute(target, attribute);
							geom.deleteAttribute(source);
						}
					}

					const count = geom.getAttribute('position').count;
					const required: Array<[string, number]> = [[FOLIAGE_RED_ATTRIBUTE, 1]];
					if (foliage.home.gradient) required.push([FOLIAGE_GRADIENT_ATTRIBUTE, 1]);
					if (foliage.home.specularTexture) required.push([FOLIAGE_SPECULAR_UV_ATTRIBUTE, 2]);
					if (foliage.home.cycle) required.push([FOLIAGE_CYCLE_ATTRIBUTE, 1]);
					for (const [name, size] of required) {
						const attribute = geom.getAttribute(name);
						if (
							!attribute ||
							attribute.itemSize !== size ||
							attribute.count !== count ||
							attribute.normalized ||
							!(attribute.array instanceof Float32Array)
						) throw new Error(`[ModelManager] ${meshPath}: Home foliage requires proven source ${name}`);
					}
				}

				const layered = readFurnitureLayered(sourceMaterial.userData.layered);
				const surfaceExtra = readFurnitureSurfaceExtra(sourceMaterial.userData.surfaceExtra);
				if (sourceMaterial.userData.surfaceExtra && !surfaceExtra) throw new Error(`[ModelManager] ${meshPath}: invalid SurfaceExtra contract`);

				const jewel = readFurnitureJewel(sourceMaterial.userData.jewel);
				const star = readFurnitureParallaxStar(sourceMaterial.userData.parallaxStar);
				if (sourceMaterial.userData.parallaxStar && !star) throw new Error(`[ModelManager] ${meshPath}: invalid ParallaxStar contract`);
				if (sourceMaterial.userData.jewel && !jewel) throw new Error(`[ModelManager] ${meshPath}: invalid Jewel contract`);

				if (jewel?.opal) restoreJewelGeometryProof(geom, sourceMaterial, jewel);
				if (jewel?.maskedSource)
					restoreJewelryMaskedGeometry(geom, sourceMaterial, jewel.maskedSource);

				const crystal = readFurnitureTranslucentCrystal(sourceMaterial.userData.translucentCrystal);
				if (sourceMaterial.userData.translucentCrystal && !crystal) throw new Error(`[ModelManager] ${meshPath}: invalid Crystal contract`);

				if (crystal) restoreTranslucentCrystalGeometryProof(geom, sourceMaterial, crystal);
				const card = readFurnitureParallaxCard(sourceMaterial.userData.parallaxCard);
				if (sourceMaterial.userData.parallaxCard && !card) throw new Error(`[ModelManager] ${meshPath}: invalid ParallaxCard contract`);

				if (card?.version === 3) restoreCurrentParallaxCardGeometry(geom, card);
				else if (card?.version === 2) restoreParallaxCardBasisV2(geom, sourceMaterial);
				else if (card) restoreParallaxCardGeometryProof(geom, sourceMaterial);

				const character = readFurnitureCharacterJewel(sourceMaterial.userData.characterJewel);
				if (sourceMaterial.userData.characterJewel && !character) throw new Error(`[ModelManager] ${meshPath}: invalid CharacterJewel contract`);

				if (character) restoreCharacterJewelGeometry(geom, character);
				const intStatic = readFurnitureIntStaticMeshCurrent(sourceMaterial.userData.intStaticMeshCurrent);
				if (sourceMaterial.userData.intStaticMeshCurrent && !intStatic) throw new Error(`[ModelManager] ${meshPath}: invalid IntStaticMesh contract`);

				if (intStatic) restoreIntStaticMeshCurrentGeometry(geom);
				const sceneJewel = readFurnitureSceneJewelCurrent(sourceMaterial.userData.sceneJewelCurrent);
				if (sourceMaterial.userData.sceneJewelCurrent && !sceneJewel) throw new Error(`[ModelManager] ${meshPath}: invalid scene Jewel contract`);

				if (sceneJewel) restoreSceneJewelCurrentGeometry(geom);
				const sphere = readFurnitureSphereBillboardCurrent(sourceMaterial.userData.sphereBillboardCurrent);
				if (sourceMaterial.userData.sphereBillboardCurrent && !sphere) throw new Error(`[ModelManager] ${meshPath}: invalid SphereBillboard preview contract`);

				if (sphere) restoreSphereBillboardCurrentGeometry(geom);
				const diamond = readFurnitureDiamondBillboardCurrent(sourceMaterial.userData.diamondBillboardCurrent);
				if (sourceMaterial.userData.diamondBillboardCurrent && !diamond) throw new Error(`[ModelManager] ${meshPath}: invalid DiamondBillboard contract`);

				if (diamond) restoreDiamondBillboardCurrentGeometry(geom);
				const animalMasked = readFurnitureAnimalMaskedCurrent(sourceMaterial.userData.animalMaskedCurrent);
				if (sourceMaterial.userData.animalMaskedCurrent && !animalMasked) throw new Error(`[ModelManager] ${meshPath}: invalid AnimalMasked contract`);

				if (animalMasked) restoreAnimalMaskedCurrentGeometry(geom);
				const absFx = readFurnitureABSFXCurrent(sourceMaterial.userData.absFxCurrent);
				if (sourceMaterial.userData.absFxCurrent && !absFx) throw new Error(`[ModelManager] ${meshPath}: invalid ABS FX contract`);

				if (absFx) restoreABSFXCurrentGeometry(geom);
				const animal = readFurnitureAnimalSimpleTrans(sourceMaterial.userData.animalSimpleTrans);
				if (sourceMaterial.userData.animalSimpleTrans && !animal) throw new Error(`[ModelManager] ${meshPath}: invalid AnimalSimpleTrans contract`);

				const ua2 = readFurnitureNNClothUA2Preview(sourceMaterial.userData.nnclothUA2Preview);
				if (sourceMaterial.userData.nnclothUA2Preview && !ua2) throw new Error(`[ModelManager] ${meshPath}: invalid NNCloth UA2 contract`);

				const waterSmallProp = readFurnitureWaterSmallProp(sourceMaterial.userData.waterSmallProp);
				if (sourceMaterial.userData.waterSmallProp && !waterSmallProp) throw new Error(`[ModelManager] ${meshPath}: invalid WaterSmallProp contract`);

				const ledSignPreview = readFurnitureLEDSignPreview(sourceMaterial.userData.ledSignPreview);
				if (sourceMaterial.userData.ledSignPreview && !ledSignPreview) throw new Error(`[ModelManager] ${meshPath}: invalid LEDSign contract`);

				const glintDetail = readFurnitureWaterGlintDetail(sourceMaterial.userData.waterGlintDetail);
				if (sourceMaterial.userData.waterGlintDetail && !glintDetail) throw new Error(`[ModelManager] ${meshPath}: invalid WaterGlintDetail contract`);

				const inkPreview = readFurnitureInkPreview(sourceMaterial.userData.inkPreview);
				if (sourceMaterial.userData.inkPreview && !inkPreview) throw new Error(`[ModelManager] ${meshPath}: invalid InkPreview contract`);

				const liquid = readFurnitureLiquidVolumeStatic(sourceMaterial.userData.liquidVolumeStatic);
				if (sourceMaterial.userData.liquidVolumeStatic && !liquid) throw new Error(`[ModelManager] ${meshPath}: invalid LiquidVolumeStatic contract`);

				const crystalPreview = readFurnitureCrystalPreview(sourceMaterial.userData.crystalPreview);
				if (sourceMaterial.userData.crystalPreview && !crystalPreview) throw new Error(`[ModelManager] ${meshPath}: invalid CrystalPreview contract`);

				const nativeUV = glintDetail
					? [0]
					: (liquid?.requiredUv ??
						crystalPreview?.requiredUv ??
						inkPreview?.requiredUv ??
						ledSignPreview?.requiredUv ??
						waterSmallProp?.requiredUv ??
						ua2?.requiredUv ??
						opal?.requiredUv ??
						animal?.requiredUv ??
						(surfaceExtra
							? surfaceExtraUVChannels(surfaceExtra)
							: (crystal?.requiredUv ??
								jewel?.requiredUv ??
								star?.requiredUv ??
								(sourceMaterial.userData.lightmassBody ? [0] : null))));
				if (nativeUV) {
					const count = geom.getAttribute('position').count;
					for (const channel of nativeUV) {
						const uv = geom.getAttribute(channel === 0 ? 'uv' : `uv${channel}`);
						if (!uv || uv.itemSize !== 2 || uv.count !== count) throw new Error(
							`[ModelManager] ${meshPath}: Jewel requires proven source UV${channel}`,
						);
					}

					const normal = geom.getAttribute('normal');
					if (!normal || normal.itemSize !== 3 || normal.count !== count) throw new Error(`[ModelManager] ${meshPath}: Jewel requires source normals`);
				}

				if (sourceMaterial.userData.layered && !layered) throw new Error(`[ModelManager] ${meshPath}: invalid layered material contract`);

				if (layered) {
					const worldFrame =
						layered.projection?.worldFrame ??
						layered.rockHome?.worldFrame ??
						layered.rockTop?.worldFrame;
					if (worldFrame) {
						const proof = geom.userData.ueLayerWorldFrameProof;
						if (
							!proof ||
							proof.coordinateTransform !== worldFrame ||
							proof.sourceNativeIndex !== '_UE_VERTEX_INDEX' ||
							proof.positionMatched !== true ||
							proof.basisMatched !== true ||
							proof.mismatches !== 0 ||
							geom.getAttribute('tangent')?.itemSize !== 4
						) throw new Error(`[ModelManager] ${meshPath}: projection requires proven native position and tangent frame`);

						if (layered.colorSource === 'local-vf-null-white') {
							if (
								proof.sourceVertexColorCount !== 0 ||
								proof.sourceVertexColorSource !== 'absent'
							) throw new Error(`[ModelManager] ${meshPath}: null-white requires an absent original native COLOR buffer`);

							geom.userData.ueLayerNullWhiteProofs = [proof];
						}
					}

					const layerColor = geom.getAttribute('_layer_color');
					if (layerColor) {
						geom.setAttribute(LAYER_COLOR_ATTRIBUTE, layerColor);
						geom.deleteAttribute('_layer_color');
					}

					const count = geom.getAttribute('position').count;
					for (const channel of layered.requiredUv) {
						const uv = geom.getAttribute(channel === 0 ? 'uv' : `uv${channel}`);
						if (!uv || uv.itemSize !== 2 || uv.count !== count) throw new Error(
							`[ModelManager] ${meshPath}: layered requires proven source UV${channel}`,
						);
					}

					if (layered.colorMask) {
						const mask = geom.getAttribute(LAYER_COLOR_ATTRIBUTE);
						if (
							!mask ||
							mask.itemSize !== 4 ||
							mask.count !== count ||
							mask.normalized ||
							!(mask.array instanceof Float32Array)
						) throw new Error(`[ModelManager] ${meshPath}: layered requires its proven original RGBA mask`);
					}

					const normal = geom.getAttribute('normal');
					if (!normal || normal.itemSize !== 3 || normal.count !== count) throw new Error(`[ModelManager] ${meshPath}: layered requires source normals`);
					if (layered.vcHeight && geom.getAttribute('tangent')?.itemSize !== 4) throw new Error(
						`[ModelManager] ${meshPath}: VCHeight requires its original tangent stream`,
					);
				}

				const clothStatic = readFurnitureClothStaticCore(sourceMaterial.userData.clothStaticCore);
				if (sourceMaterial.userData.clothStaticCore && !clothStatic) throw new Error(`[ModelManager] ${meshPath}: invalid ClothStaticCore contract`);

				const cloth = readFurnitureCloth(sourceMaterial.userData.cloth) ?? clothStatic?.cloth;
				const mirror = readFurnitureMirror(sourceMaterial.userData.mirror);
				if (sourceMaterial.userData.mirror && !mirror) throw new Error(`[ModelManager] ${meshPath}: invalid Mirror contract`);

				if (mirror) validateMirrorGeometry(geom, mirror);
				const feather = readFurnitureLongFeather(sourceMaterial.userData.longFeather);
				if (sourceMaterial.userData.longFeather && !feather) throw new Error(`[ModelManager] ${meshPath}: invalid LongFeather contract`);

				if (feather) {
					validateLongFeatherGeometry(geom, feather);
					geom.deleteAttribute('_layer_color');
				}

				if (cloth) {
					const count = geom.getAttribute('position').count;
					for (const [attribute, itemSize] of [
						['normal', 3],
						['tangent', 4],
						['uv', 2],
					] as const) {
						const source = geom.getAttribute(attribute);
						if (!source || source.itemSize !== itemSize || source.count !== count) throw new Error(
							`[ModelManager] ${meshPath}: captured cloth requires valid source ${attribute}`,
						);
					}

					const channels = new Set([cloth.mainUvChannel]);
					if (cloth.fourthRole === 'mask' && cloth.textureActive[3])
						channels.add(cloth.maskUvChannel);

					if (
						cloth.fourthRole === 'palette' &&
						cloth.textureActive[3] &&
						cloth.paletteUvBlend !== 0
					)
						channels.add(2);

					for (const channel of channels) {
						const uv = geom.getAttribute(channel === 0 ? 'uv' : `uv${channel}`);
						if (!uv || uv.itemSize !== 2 || uv.count !== count) throw new Error(
							`[ModelManager] ${meshPath}: captured cloth requires source UV${channel}`,
						);
					}
				}

				if (readFurnitureFoam(sourceMaterial.userData.foam)) {
					const mask = geom.getAttribute(FOAM_MASK_ATTRIBUTE);
					if (
						!mask ||
						mask.itemSize !== 4 ||
						mask.normalized ||
						!(mask.array instanceof Float32Array) ||
						mask.count !== geom.getAttribute('position').count
					) throw new Error(`[ModelManager] ${meshPath}: captured foam requires its proven source RGBA mask`);
				}

				if (readFurnitureGlass(sourceMaterial.userData.glass)?.bottleLiquid) {
					if (!bottleBounds || !setBottleLiquidCoordinates(geom, bottleBounds)) throw new Error(
						`[ModelManager] ${meshPath}: captured bottle liquid requires valid source coordinates and bounds`,
					);
				}

				const surface = surfaceExtra?.core ?? readFurnitureSurface(sourceMaterial.userData.surface);
				if (surface?.vertexEmissive === 'source-blue') {
					const mask = geom.getAttribute(SURFACE_EMISSION_ATTRIBUTE);
					if (!mask || mask.itemSize !== 1 || mask.count !== geom.getAttribute('position').count) throw new Error(`[ModelManager] ${meshPath}: Surface requires original emission mask`);
				}

				const effect = readFurnitureEffect(sourceMaterial.userData.effect);
				if (effect?.base) {
					const uv1 = geom.getAttribute('uv1');
					if (uv1) {
						geom.setAttribute(EFFECT_UV1_ATTRIBUTE, uv1.clone());
					} else if (
						effect.base.uvBlend.some((value) => value !== 0) ||
						(effect.base.noise?.uvBlend ?? 0) !== 0
					) throw new Error(`[ModelManager] ${meshPath}: effect requires original source UV1`);
				}

				if (foliage?.sourceAlpha && !geom.hasAttribute(FOLIAGE_ALPHA_ATTRIBUTE)) throw new Error(`[ModelManager] ${meshPath}: foliage requires original source alpha`);

				if (
					readFurnitureSurface(meshEntry.material.userData.surface) &&
					!geom.hasAttribute('uv2')
				) {
					// The captured LocalVF clamps UV channel 2 to the last available channel.
					const uv = geom.getAttribute('uv1') ?? geom.getAttribute('uv');
					if (uv) geom.setAttribute('uv2', uv.clone());
				}
				// Only missing normals need a fallback. Recomputing imported normals changes
				// smoothing and breaks the basis against which the normal map was authored.
				if (!geom.hasAttribute('normal')) geom.computeVertexNormals();
				applyGeometryTransform(geom, meshEntry.localMatrix);

				// Transport native XYZ centimeters through the export frame.
				tempScale.set(meshConfig.scale.x, meshConfig.scale.z, meshConfig.scale.y);
				tempQuat.set(meshConfig.rotation.x, meshConfig.rotation.z, meshConfig.rotation.y, meshConfig.rotation.w);
				tempTrans.set(meshConfig.trans.x / 100, meshConfig.trans.z / 100, -meshConfig.trans.y / 100);
				tempMatrix.compose(tempTrans, tempQuat, tempScale);
				applyGeometryTransform(geom, tempMatrix);
				if (readFurnitureSurface(sourceMaterial.userData.surface)?.homeUv) {
					sourceMaterial.userData.homeWallBasis = homeWallBasis(tempMatrix.clone().multiply(meshEntry.localMatrix));
				}

				if (water?.common || water?.caustics || waterFx) {
					if (!waterCenter) throw new Error(`[ModelManager] ${meshPath}: water world-sampling bounds missing`);

					geom.userData.waterObjectCenter = waterCenter.clone().applyMatrix4(tempMatrix);
				}

				geom.setAttribute('nuanSourceMesh', new Float32BufferAttribute(
					new Float32Array(geom.getAttribute('position').count).fill(meshConfig.sourceIndex), 1));
				allGeometries.push(geom);
				sourceMaterials.push(sourceMaterial);
				meshBaseNames.push(meshEntry.baseName);
				slotMeshIndices.push(meshConfig.sourceIndex);
			}

			meshMaterialCounts.push(sourceMaterials.length - materialCountBefore);
		}

		if (allGeometries.length === 0) {
			console.warn(`[ModelManager] No geometries loaded for itemId: ${itemId}`);
			return undefined;
		}

		const hadTangents = allGeometries.map((geom) => geom.hasAttribute('tangent'));
		if (
			sourceMaterials.some((material) => material.userData.waterFx) &&
			hadTangents.some((present) => !present)
		) throw new Error(`[ModelManager] ${itemId}: merging would discard native WaterFX TBN`);

		padWaterFxMergeAttributes(allGeometries);

		const nnclothBounds = allGeometries.map((geom) => {
			const frame = geom.userData.nnclothBoundsFrame as NNClothBoundsFrame | undefined;
			return frame ? { ...frame, nativeToGeometry: frame.nativeToGeometry.slice() } : undefined;
		});
		const projectionProofs = allGeometries
			.map((geom) => geom.userData.ueLayerWorldFrameProof)
			.filter(Boolean);
		if (
			sourceMaterials.some((material) => readFurnitureLayered(material.userData.layered)?.vcHeight) &&
			hadTangents.some((present) => !present)
		) throw new Error(`[ModelManager] ${itemId}: merging would discard the captured VCHeight tangent stream`);
		if (
			sourceMaterials.some((material) => material.userData.cabinetStatic) &&
			hadTangents.some((present) => !present)
		) throw new Error(`[ModelManager] ${itemId}: merging would discard the captured CabinetStatic tangent stream`);
		if (
			allGeometries.some((geom) => geom.userData.ueTranslucentCrystalProof) &&
			hadTangents.some((present) => !present)
		) throw new Error(`[ModelManager] ${itemId}: merging would discard the proven Crystal tangent stream`);
		if (
			allGeometries.some((geom) => geom.userData.ueParallaxCardProof) &&
			hadTangents.some((present) => !present)
		) throw new Error(`[ModelManager] ${itemId}: merging would discard the proven ParallaxCard tangent stream`);
		if (projectionProofs.length > 0 && hadTangents.some((present) => !present)) throw new Error(
			`[ModelManager] ${itemId}: merging would discard the proven projection tangent stream`,
		);
		if (
			sourceMaterials.some((material) => readFurnitureJewel(material.userData.jewel)?.opal?.parallax) &&
			hadTangents.some((present) => !present)
		) throw new Error(`[ModelManager] ${itemId}: merging would discard the proven Opal tangent stream`);
		if (
			sourceMaterials.some((material) => readFurnitureScene(material.userData.scene)?.detailNormal) &&
			hadTangents.some((present) => !present)
		) throw new Error(`[ModelManager] ${itemId}: merging would discard the Scene detail-normal tangent stream`);
		if (
			sourceMaterials.some((material) => {
				const water = readFurnitureWater(material.userData.water);
				return water?.slw || water?.slwStatic;
			}) &&
			hadTangents.some((present) => !present)
		) throw new Error(`[ModelManager] ${itemId}: merging would discard the captured SLW source tangent stream`);

		if (allGeometries.length > 1) normalizeGeometryAttributes(allGeometries);
		if (sourceMaterials.some((material) => material.userData.waterFx)) {
			allGeometries.forEach((section, slot) => {
				for (const [name, attribute] of Object.entries(section.attributes)) {
					if (!attribute.array) throw new Error(
						`[ModelManager][X6FX] source slot ${slot} interleaved ${name} requires exact de-interleaving before native merge`,
					);
				}
			});
		}

		let geometry: BufferGeometry;
		if (allGeometries.length === 1) {
			geometry = allGeometries[0]!;
		} else {
			const merged = mergeGeometries(allGeometries, true);
			if (!merged) {
				console.warn(`[ModelManager] Failed to merge geometries for itemId: ${itemId}`);
				return undefined;
			}

			geometry = merged;
			ownedGeometries.add(geometry);
			mergeJewelGeometryProofs(geometry, allGeometries);
			mergeJewelryMaskedGeometry(geometry, allGeometries);
			mergeTranslucentCrystalGeometryProofs(geometry, allGeometries);
			mergeParallaxCardGeometryProofs(geometry, allGeometries);
			mergeParallaxCardBasisV2(geometry, allGeometries);
			if (allGeometries.some((section) => section.userData.currentParallaxCard))
				geometry.userData.currentParallaxCard = true;

			if (allGeometries.some((section) => section.userData.characterJewelNativeFrame))
				geometry.userData.characterJewelNativeFrame = true;

			if (allGeometries.some((section) => section.userData.intStaticMeshCurrentNativeFrame))
				geometry.userData.intStaticMeshCurrentNativeFrame = true;

			if (allGeometries.some((section) => section.userData.sceneJewelCurrentNativeFrame))
				geometry.userData.sceneJewelCurrentNativeFrame = true;

			if (allGeometries.some((section) => section.userData.sphereBillboardCurrentNativeFrame))
				geometry.userData.sphereBillboardCurrentNativeFrame = true;

			if (allGeometries.some((section) => section.userData.diamondBillboardCurrentNativeFrame))
				geometry.userData.diamondBillboardCurrentNativeFrame = true;

			if (allGeometries.some((section) => section.userData.animalMaskedCurrentNativeFrame))
				geometry.userData.animalMaskedCurrentNativeFrame = true;

			if (allGeometries.some((section) => section.userData.absFxCurrentNativeFrame))
				geometry.userData.absFxCurrentNativeFrame = true;

			if (projectionProofs.length > 0) {
				geometry.userData.ueLayerWorldFrameProof = {
					...projectionProofs[0],
					sourceProofs: projectionProofs,
				};
			}

			const nullWhiteProofs = allGeometries.flatMap((section) => section.userData.ueLayerNullWhiteProofs ?? []);
			if (nullWhiteProofs.length > 0) geometry.userData.ueLayerNullWhiteProofs = nullWhiteProofs;
		}

		if (!geometry.hasAttribute('tangent')) {
			for (let index = 0; index < sourceMaterials.length; index++) {
				const material = sourceMaterials[index];
				if (
					hadTangents[index] &&
					material instanceof MeshStandardMaterial &&
					material.normalMapType === TangentSpaceNormalMap
				) {
					// Attribute intersection can switch a slot to derivative TBN after GLTFLoader
					// selected its normalScale sign. Apply the same convention as the loader.
					material.normalScale.y *= -1;
				}
			}
		}

		// Apply the root offset in meters, then restore centimeter scale and the preview frame.
		const offset = config.root_offset;
		transformJewelryMaskedGeometry(geometry, tempMatrix.makeTranslation(offset.y / 100, offset.z / 100, offset.x / 100));
		transformCharacterJewelGeometry(geometry, tempMatrix);
		transformIntStaticMeshCurrentGeometry(geometry, tempMatrix);
		transformSceneJewelCurrentGeometry(geometry, tempMatrix);
		transformSphereBillboardCurrentGeometry(geometry, tempMatrix);
		transformDiamondBillboardCurrentGeometry(geometry, tempMatrix);
		transformAnimalMaskedCurrentGeometry(geometry, tempMatrix);
		transformABSFXCurrentGeometry(geometry, tempMatrix);
		geometry.translate(offset.y / 100, offset.z / 100, offset.x / 100);

		transformJewelryMaskedGeometry(geometry, tempMatrix.makeScale(100, 100, 100));
		transformCharacterJewelGeometry(geometry, tempMatrix);
		transformIntStaticMeshCurrentGeometry(geometry, tempMatrix);
		transformSceneJewelCurrentGeometry(geometry, tempMatrix);
		transformSphereBillboardCurrentGeometry(geometry, tempMatrix);
		transformDiamondBillboardCurrentGeometry(geometry, tempMatrix);
		transformAnimalMaskedCurrentGeometry(geometry, tempMatrix);
		transformABSFXCurrentGeometry(geometry, tempMatrix);
		geometry.scale(100, 100, 100);

		applyGeometryTransform(geometry, tempMatrix.makeScale(-1, 1, 1));
		transformNNClothWorldBasis(geometry, tempMatrix.makeRotationY(Math.PI / 2));
		transformParallaxCardBasisV2(geometry, tempMatrix);
		transformCurrentParallaxCardGeometry(geometry, tempMatrix);
		transformCharacterJewelGeometry(geometry, tempMatrix);
		transformIntStaticMeshCurrentGeometry(geometry, tempMatrix);
		transformSceneJewelCurrentGeometry(geometry, tempMatrix);
		transformSphereBillboardCurrentGeometry(geometry, tempMatrix);
		transformDiamondBillboardCurrentGeometry(geometry, tempMatrix);
		transformAnimalMaskedCurrentGeometry(geometry, tempMatrix);
		transformABSFXCurrentGeometry(geometry, tempMatrix);
		transformJewelryMaskedGeometry(geometry, tempMatrix);
		transformRockProjectionRawBasis(geometry, tempMatrix);
		geometry.rotateY(Math.PI / 2);

		transformNNClothWorldBasis(geometry, tempMatrix.makeRotationX(Math.PI / 2));
		transformParallaxCardBasisV2(geometry, tempMatrix);
		transformCurrentParallaxCardGeometry(geometry, tempMatrix);
		transformCharacterJewelGeometry(geometry, tempMatrix);
		transformIntStaticMeshCurrentGeometry(geometry, tempMatrix);
		transformSceneJewelCurrentGeometry(geometry, tempMatrix);
		transformSphereBillboardCurrentGeometry(geometry, tempMatrix);
		transformDiamondBillboardCurrentGeometry(geometry, tempMatrix);
		transformAnimalMaskedCurrentGeometry(geometry, tempMatrix);
		transformABSFXCurrentGeometry(geometry, tempMatrix);
		transformJewelryMaskedGeometry(geometry, tempMatrix);
		transformRockProjectionRawBasis(geometry, tempMatrix);
		geometry.rotateX(Math.PI / 2);

		const waterCenters: Record<number, number[]> = {};
		const waterFrame = new Matrix4()
			.makeRotationX(Math.PI / 2)
			.multiply(new Matrix4().makeRotationY(Math.PI / 2))
			.multiply(new Matrix4().makeScale(-100, 100, 100))
			.multiply(new Matrix4().makeTranslation(offset.y / 100, offset.z / 100, offset.x / 100));
		allGeometries.forEach((source, materialIndex) => {
			const center = source.userData.waterObjectCenter as Vector3 | undefined;
			if (center) waterCenters[materialIndex] = center.clone().applyMatrix4(waterFrame).toArray();
		});
		if (Object.keys(waterCenters).length) geometry.userData.waterObjectCenters = waterCenters;
		mergeWaterFxDomains(
			geometry,
			allGeometries,
			new Map(
				Object.entries(waterCenters).map(([slot, center]) => [
					Number(slot),
					new Vector3().fromArray(center),
				]),
			),
		);
		sourceMaterials.forEach((source, slot) => {
			if (!source.userData.waterFx) return;

			const center = waterCenters[slot];
			if (!center || !(source instanceof MeshStandardMaterial)) throw new Error(
				`[ModelManager] ${itemId}: native WaterFX source material/component center missing`,
			);

			const options: WaterFxMaterialOptions = {
				lighting: 'editor-standard-preview',
				lightingEvidence:
					'actual editor scene lights/environment; explicit preview, not captured UE lighting',
				basisEvidence:
					'original VM/source-stream admission plus unchanged geometryPipeline reflection/winding transforms',
				nativeBitangentSign: -1,
				viewEvidence:
					'editor unpreexposed linear HDR preview; SceneView default normal-bias/mip domain, no original-game fog/TOD capture',
				emissiveScale: 1,
				preExposure: 1,
				roughness: source.roughness,
				metalness: source.metalness,
				primitiveHoldout: 0,
				nativePrimitiveSign: 1,
				objectCenter: [center[0]!, center[1]!, center[2]!],
				objectCenterEvidence: 'admitted component bounds through unchanged cfg/root frame',
				previewTimeOfDay: 0.25,
				geometryProofSlot: slot,
			};

			source.userData.waterFxMaterialOptions = options;
		});

		const nnclothBoundsFrames: Record<number, NNClothBoundsFrame> = {};
		nnclothBounds.forEach((frame, materialIndex) => {
			if (frame)
				nnclothBoundsFrames[materialIndex] = {
					...frame,
					nativeToGeometry: waterFrame
						.clone()
						.multiply(new Matrix4().fromArray(frame.nativeToGeometry))
						.toArray(),
				};
		});
		if (Object.keys(nnclothBoundsFrames).length)
			geometry.userData.nnclothBoundsFrames = nnclothBoundsFrames;

		geometry.computeBoundingBox();

		const boundingBox = geometry.boundingBox!.clone();

		capture?.({ geometry, sourceMaterials, meshBaseNames, slotMeshIndices, meshMaterialCounts });

		// Build materials after native streams and source frames are ready.
		const buildPlainMaterial = createPlainMaterialBuilder(materialRegistry);
		const plainResults = await Promise.allSettled(
			sourceMaterials.map(async (sourceMat, idx) => {
				const material = await buildPlainMaterial(sourceMat, meshBaseNames[idx] ?? null);
				ownedMaterials.add(material);
				return material;
			}),
		);
		const plainMaterials = plainResults.map((result) => {
			if (result.status === 'rejected') throw result.reason;

			return result.value;
		});

		const mergedMaterial: Material | Material[] = plainMaterials.length > 1 ? plainMaterials : (plainMaterials[0] ?? new MeshStandardMaterial());

		retainedGeometry = geometry;
		for (const material of plainMaterials) retainedMaterials.add(material);

		return {
			geometry,
			plainMaterials,
			meshBaseNames,
			slotMeshIndices,
			mergedMaterial,
			materialRegistry,
			boundingBox,
			meshMaterialCounts,
		};
	} finally {
		for (const geometry of ownedGeometries) if (geometry !== retainedGeometry) geometry.dispose();

		for (const material of ownedMaterials) if (!retainedMaterials.has(material)) material.dispose();

		for (const asset of meshAssets) asset?.dispose();
	}
}
