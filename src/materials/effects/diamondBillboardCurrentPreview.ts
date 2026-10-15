import { DoubleSide, MeshPhysicalMaterial, Vector4, type Texture } from 'three';
import { getEditorMaterialPreviewContext } from '../jewel/characterJewelPreview.js';
import { DIAMOND_BILLBOARD_CURRENT_ATTRIBUTES } from './diamondBillboardCurrentGeometry.js';
import {
	createDiamondBillboardCurrentMaterial,
	type DiamondBillboardCurrentRuntime,
	type FurnitureDiamondBillboardCurrent,
} from './diamondBillboardCurrentShader.js';
import { registerMaterialFinalizer } from '../../runtime/materialPreparation.js';
import { applyEnvironmentLighting } from '../../runtime/environmentLighting.js';

export function createDeferredDiamondBillboardCurrentMaterial(
	profile: FurnitureDiamondBillboardCurrent,
	sources: Partial<Record<string, Texture | null>>,
): MeshPhysicalMaterial {
	const deferred = new MeshPhysicalMaterial({ side: DoubleSide, alphaTest: 0.3333 });
	deferred.userData.diamondBillboardCurrent = profile;

	const runtime: DiamondBillboardCurrentRuntime = {
		primaryDirection: [NaN, NaN, NaN],
		primaryColor: [NaN, NaN, NaN],
		sunDirection: [NaN, NaN, NaN],
		swapLightFactor: NaN,
		timeOfDayHours: NaN,
		viewport: [NaN, NaN],
		inverseProjectionX: NaN,
	};

	const viewport = new Vector4();
	let current: MeshPhysicalMaterial | undefined;

	const update: MeshPhysicalMaterial['onBeforeRender'] = (renderer, scene, camera, geometry) => {
		const context = getEditorMaterialPreviewContext(renderer, scene);
		const count = geometry.getAttribute('position')?.count;
		if (
			!geometry.userData.diamondBillboardCurrentNativeFrame ||
			!count ||
			DIAMOND_BILLBOARD_CURRENT_ATTRIBUTES.some((name) => geometry.getAttribute(name)?.count !== count)
		) throw new Error('[DiamondBillboard] native source streams lost');

		const view = context.lighting();
		const native = (v: readonly number[]) => [v[0]!, -v[1]!, v[2]!];
		runtime.primaryDirection = native(view.primaryDirection);
		runtime.primaryColor = view.primaryColor;
		runtime.sunDirection = native(view.tod.sunDirectionWorld);
		runtime.swapLightFactor = view.tod.swapLightFactor;
		runtime.timeOfDayHours = view.tod.minute / 60;
		renderer.getCurrentViewport(viewport);
		runtime.viewport = [viewport.z, viewport.w];
		runtime.inverseProjectionX = 1 / camera.projectionMatrix.elements[0]!;
		current?.userData.diamondBillboardCurrentRefresh();
		deferred.userData.diamondBillboardCurrentRuntime = {
			...runtime,
			clock: 'source-static-zero',
			collection: 'authored-initialization',
			rendererFrame: renderer.info.render.frame,
		};
	};

	const finalize: MeshPhysicalMaterial['onBeforeRender'] = (...args) => {
		if (current) return;

		update(...args);
		current = applyEnvironmentLighting(createDiamondBillboardCurrentMaterial(profile, sources, runtime, update));

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
