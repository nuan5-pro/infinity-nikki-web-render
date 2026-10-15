import { DoubleSide, FrontSide, MeshPhysicalMaterial, type Texture } from 'three';
import { getEditorMaterialPreviewContext } from './characterJewelPreview.js';
import { SCENE_JEWEL_CURRENT_ATTRIBUTES } from './jewelCurrentGeometry.js';
import {
	createSceneJewelCurrentMaterial,
	type FurnitureSceneJewelCurrent,
	type SceneJewelCurrentRuntime,
} from './jewelCurrentShader.js';
import { registerMaterialFinalizer } from '../../runtime/materialPreparation.js';
import { applyEnvironmentLighting } from '../../runtime/environmentLighting.js';

export function createDeferredSceneJewelCurrentMaterial(
	profile: FurnitureSceneJewelCurrent,
	sources: Partial<Record<string, Texture | null>>,
): MeshPhysicalMaterial {
	const deferred = new MeshPhysicalMaterial({ side: profile.twoSided ? DoubleSide : FrontSide });
	deferred.userData.sceneJewelCurrent = profile;

	const runtime: SceneJewelCurrentRuntime = {
		primaryDirection: [NaN, NaN, NaN],
		primaryColor: [NaN, NaN, NaN],
		ready: profile.collection.ready,
		limitedDirection: [...profile.collection.limitedDirection],
		sunColor: [...profile.collection.sunColor],
		normalOverride: [0, 0, 0, 1],
		preExposure: 1,
		swapLightFactor: profile.collection.swapLightFactor,
		nativeCullingSign: 1,
		nativePrimitiveDeterminantSign: 1,
		nativeFrontFaceParity: -1,
	};

	let current: MeshPhysicalMaterial | undefined;

	const update: MeshPhysicalMaterial['onBeforeRender'] = (renderer, scene, camera, geometry, object) => {
		const context = getEditorMaterialPreviewContext(renderer, scene);
		const count = geometry.getAttribute('position')?.count;
		if (
			!geometry.userData.sceneJewelCurrentNativeFrame ||
			!count ||
			SCENE_JEWEL_CURRENT_ATTRIBUTES.some((name) => geometry.getAttribute(name)?.count !== count)
		) throw new Error('[SceneJewel] actual current native VF streams lost');

		const sign = Math.sign(object.matrixWorld.determinant());
		const cameraSign = Math.sign(camera.matrixWorld.determinant());
		if (![1, -1].includes(sign) || ![1, -1].includes(cameraSign)) throw new Error('[SceneJewel] nonsingular actual object/camera required');

		const view = context.lighting();

		const native = ([x, y, z]: readonly [number, number, number]): [number, number, number] => [
			x,
			-y,
			z,
		];

		runtime.primaryDirection = native(view.primaryDirection);
		runtime.primaryColor = view.primaryColor;
		runtime.limitedDirection = native(view.tod.sunDirectionWorld);
		runtime.swapLightFactor = view.tod.swapLightFactor;
		runtime.nativeCullingSign = cameraSign as 1 | -1;
		runtime.nativePrimitiveDeterminantSign = sign as 1 | -1;
		runtime.nativeFrontFaceParity = -sign as 1 | -1;
		current?.userData.sceneJewelCurrentRefreshUniforms();
	};

	const finalize: MeshPhysicalMaterial['onBeforeRender'] = (...args) => {
		if (current) return;

		update(...args);
		current = applyEnvironmentLighting(createSceneJewelCurrentMaterial(profile, sources, runtime, update));

		const data = deferred.userData;
		const name = deferred.name;
		const visible = deferred.visible;
		const toneMapped = deferred.toneMapped;
		deferred.copy(current);
		deferred.userData = { ...data, ...current.userData };
		deferred.name = name;
		deferred.visible = visible;
		deferred.toneMapped = toneMapped;
		deferred.defines = { ...current.defines };
		current.userData = deferred.userData;
		deferred.onBeforeCompile = current.onBeforeCompile;
		deferred.customProgramCacheKey = current.customProgramCacheKey;
		deferred.needsUpdate = true;
	};

	registerMaterialFinalizer(deferred, finalize);
	deferred.onBeforeRender = (...args) => {
		finalize(...args);
		update(...args);
	};
	deferred.addEventListener('dispose', () => current?.dispose());
	return deferred;
}
