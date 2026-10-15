import { DoubleSide, FrontSide, MeshBasicMaterial, type Texture } from 'three';
import { getEditorMaterialPreviewContext } from '../jewel/characterJewelPreview.js';
import { ABS_FX_CURRENT_ATTRIBUTES } from './absFxCurrentGeometry.js';
import {
	createABSFXCurrentMaterial,
	type ABSFXCurrentRuntime,
	type FurnitureABSFXCurrent,
} from './absFxCurrentShader.js';
import { registerMaterialFinalizer } from '../../runtime/materialPreparation.js';

export function createDeferredABSFXCurrentMaterial(profile: FurnitureABSFXCurrent, sources: Partial<Record<string, Texture | null>>): MeshBasicMaterial {
	const deferred = new MeshBasicMaterial({
		transparent: true,
		depthWrite: false,
		side: profile.twoSided ? DoubleSide : FrontSide,
	});
	deferred.forceSinglePass = true;
	deferred.userData.absFxCurrent = profile;

	const runtime: ABSFXCurrentRuntime = {
		gameTime: NaN,
		unpausedTime: NaN,
		textureMipBias: 0,
		inversePreExposure: 1,
		preExposure: 1,
		// Approved editor neutral input; the protected native binding/default is not established.
		opacitySuppression: 0,
		collection: {
			...profile.collection,
			baseColor: [...profile.collection.baseColor],
			emissiveColor: [...profile.collection.emissiveColor],
			post: [...profile.collection.post],
		},
		nativeCullingSign: 1,
		nativePrimitiveDeterminantSign: 1,
		nativeFrontFaceParity: -1,
	};

	let current: MeshBasicMaterial | undefined;

	const update: MeshBasicMaterial['onBeforeRender'] = (renderer, scene, camera, geometry, object) => {
		const context = getEditorMaterialPreviewContext(renderer, scene);
		const count = geometry.getAttribute('position')?.count;
		if (
			!geometry.userData.absFxCurrentNativeFrame ||
			!count ||
			ABS_FX_CURRENT_ATTRIBUTES.some((name) => geometry.getAttribute(name)?.count !== count)
		) throw new Error('[ABSFX] actual current native VF/primitive streams lost');

		const sign = Math.sign(object.matrixWorld.determinant());
		const cameraSign = Math.sign(camera.matrixWorld.determinant());
		if (![1, -1].includes(sign) || ![1, -1].includes(cameraSign)) throw new Error('[ABSFX] nonsingular actual object/camera required');
		// Both editor clocks advance monotonically; this editor has no separate UE pause domain.
		runtime.gameTime = runtime.unpausedTime = Math.fround(context.clock());
		runtime.nativeCullingSign = cameraSign as 1 | -1;
		runtime.nativePrimitiveDeterminantSign = sign as 1 | -1;
		runtime.nativeFrontFaceParity = -sign as 1 | -1;
		current?.userData.absFxCurrentRefreshUniforms();
		deferred.userData.absFxCurrentRuntime = {
			...runtime,
			policy: 'actual-editor-monotonic-clocks; authored-MPC-init; existing-single-pass-editor-fog',
			collectionScope: 'source initialization, not current game MPC',
			opacityBinding: 'explicit-editor-neutral-zero; not-native-binding-or-default',
		};
		if (!renderer.getRenderTarget() && object.visible) context.draw();
	};

	const finalize: MeshBasicMaterial['onBeforeRender'] = (...args) => {
		if (current) return;

		update(...args);
		current = createABSFXCurrentMaterial(profile, sources, runtime, update);

		const data = deferred.userData;
		const name = deferred.name;
		const visible = deferred.visible;
		const toneMapped = deferred.toneMapped;
		deferred.copy(current);
		deferred.userData = { ...data, ...current.userData };
		deferred.name = name;
		deferred.visible = visible;
		deferred.toneMapped = toneMapped;
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
