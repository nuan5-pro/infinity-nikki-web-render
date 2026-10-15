import { DoubleSide, MeshPhysicalMaterial, type Texture } from 'three';
import { getEditorMaterialPreviewContext } from '../jewel/characterJewelPreview.js';
import { ANIMAL_MASKED_CURRENT_ATTRIBUTES } from './animalMaskedCurrentGeometry.js';
import {
	createAnimalMaskedCurrentMaterial,
	type AnimalMaskedCurrentRuntime,
	type FurnitureAnimalMaskedCurrent,
} from './animalMaskedCurrentShader.js';
import { registerMaterialFinalizer } from '../../runtime/materialPreparation.js';
import { applyEnvironmentLighting } from '../../runtime/environmentLighting.js';

export function createDeferredAnimalMaskedCurrentMaterial(
	profile: FurnitureAnimalMaskedCurrent,
	sources: Partial<Record<string, Texture | null>>,
): MeshPhysicalMaterial {
	const deferred = new MeshPhysicalMaterial({ side: DoubleSide, alphaTest: 0.3333 });
	deferred.userData.animalMaskedCurrent = profile;

	const runtime: AnimalMaskedCurrentRuntime = {
		primaryDirection: [NaN, NaN, NaN],
		primaryColor: [NaN, NaN, NaN],
		sunDirection: [NaN, NaN, NaN],
		swapLightFactor: NaN,
		cameraSign: NaN,
	};

	let current: MeshPhysicalMaterial | undefined;

	const update: MeshPhysicalMaterial['onBeforeRender'] = (renderer, scene, camera, geometry) => {
		const context = getEditorMaterialPreviewContext(renderer, scene);
		const count = geometry.getAttribute('position')?.count;
		if (
			!geometry.userData.animalMaskedCurrentNativeFrame ||
			!count ||
			ANIMAL_MASKED_CURRENT_ATTRIBUTES.some((name) => geometry.getAttribute(name)?.count !== count)
		) throw new Error('[AnimalMasked] current native source frame lost');

		const view = context.lighting();
		const native = (v: readonly number[]) => [v[0]!, -v[1]!, v[2]!];
		runtime.primaryDirection = native(view.primaryDirection);
		runtime.primaryColor = view.primaryColor;
		runtime.sunDirection = native(view.tod.sunDirectionWorld);
		runtime.swapLightFactor = view.tod.swapLightFactor;
		runtime.cameraSign = Math.sign(camera.matrixWorld.determinant());
		current?.userData.animalMaskedCurrentRefresh();
		deferred.userData.animalMaskedCurrentRuntime = {
			...runtime,
			clock: 'source-static-zero-active-glow',
			rendererFrame: renderer.info.render.frame,
		};
	};

	const finalize: MeshPhysicalMaterial['onBeforeRender'] = (...args) => {
		if (current) return;

		update(...args);
		current = applyEnvironmentLighting(createAnimalMaskedCurrentMaterial(profile, sources, runtime, update));

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
