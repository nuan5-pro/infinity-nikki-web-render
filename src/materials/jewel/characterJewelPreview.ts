import {
	DoubleSide,
	FrontSide,
	MeshPhysicalMaterial,
	Vector4,
	type Scene,
	type Texture,
	type WebGLRenderer,
} from 'three';
import type { HomeTodSample } from '../../runtime/lighting.js';
import { CHARACTER_JEWEL_ATTRIBUTES } from './characterJewelGeometry.js';
import {
	createCharacterJewelMaterial,
	type CharacterJewelRuntime,
	type FurnitureCharacterJewel,
} from './characterJewelShader.js';
import { registerMaterialFinalizer } from '../../runtime/materialPreparation.js';
import { applyEnvironmentLighting } from '../../runtime/environmentLighting.js';

interface LightingView {
	primaryDirection: [number, number, number]
	primaryColor: [number, number, number]
	tod: HomeTodSample
}

interface Context {
	renderer: WebGLRenderer
	clock: () => number
	lighting: () => LightingView
	draw: () => void
	active: boolean
}

const contextKey = Symbol.for('building-momo.character-jewel-preview-context-v1');

type PreviewScene = Scene & { [contextKey]?: Context };

export function getEditorMaterialPreviewContext(renderer: WebGLRenderer, scene: Scene): Context {
	const context = (scene as PreviewScene)[contextKey];
	if (!context?.active || context.renderer !== renderer) throw new Error('[Furniture] actual scene View/TOD provider required');

	return context;
}

export function installCharacterJewelPreviewContext(
	renderer: WebGLRenderer,
	scene: Scene,
	options: { invalidate: () => void; lighting: () => LightingView; clock?: () => number },
): () => void {
	const owner = scene as PreviewScene;
	if (owner[contextKey]?.active) throw new Error('[CharacterJewel] dispose prior scene provider before replacement');

	let pending: number | undefined;

	const context: Context = {
		renderer,
		clock: options.clock ?? (() => performance.now() * 0.001),
		lighting: options.lighting,
		active: true,

		draw: () => {
			if (pending !== undefined || !context.active) return;

			pending = requestAnimationFrame(() => {
				pending = undefined;
				if (context.active) options.invalidate();
			});
		},
	};

	owner[contextKey] = context;
	return () => {
		context.active = false;
		if (pending !== undefined) cancelAnimationFrame(pending);
		if (owner[contextKey] === context) delete owner[contextKey];
	};
}

export function createDeferredCharacterJewelPreviewMaterial(
	profile: FurnitureCharacterJewel,
	sources: Partial<Record<string, Texture | null>>,
): MeshPhysicalMaterial {
	const deferred = new MeshPhysicalMaterial({ side: profile.twoSided ? DoubleSide : FrontSide });
	deferred.userData.characterJewel = profile;

	const collection = profile.collection;

	const runtime: CharacterJewelRuntime = {
		lighting: { ...collection, primaryDirection: [NaN, NaN, NaN], primaryColor: [NaN, NaN, NaN] },
		gameTime: NaN,
		aaMethod: collection.aaMethod,
		globalFactor: collection.globalFactor,
		swapLightFactor: NaN,
		timeOfDayHours: NaN,
		materialTextureMipBias: 0,
		preExposure: 1,
		inversePreExposure: 1,
		normalOverride: [0, 0, 0, 1],
		nativeCullingSign: 1,
		nativePrimitiveDeterminantSign: 1,
		nativeFrontFaceParity: -1,
		viewportSize: [NaN, NaN],
		inverseProjectionX: NaN,
	};

	const viewport = new Vector4();
	let current: MeshPhysicalMaterial | undefined;

	const update: MeshPhysicalMaterial['onBeforeRender'] = (renderer, scene, camera, geometry, object) => {
		const context = getEditorMaterialPreviewContext(renderer, scene);
		const count = geometry.getAttribute('position')?.count;
		if (
			!geometry.userData.characterJewelNativeFrame ||
			!count ||
			CHARACTER_JEWEL_ATTRIBUTES.some((name) => geometry.getAttribute(name)?.count !== count)
		) throw new Error('[CharacterJewel] current native VF/local-coordinate streams lost');
		if ('isSkinnedMesh' in object && object.isSkinnedMesh) throw new Error('[CharacterJewel] prepared reference pose requires a static mesh');

		const sign = Math.sign(object.matrixWorld.determinant());
		const cameraSign = Math.sign(camera.matrixWorld.determinant());
		if (![1, -1].includes(sign) || ![1, -1].includes(cameraSign)) throw new Error('[CharacterJewel] nonsingular actual object/camera required');

		const view = context.lighting();
		const native = ([x, y, z]: readonly number[]): [number, number, number] => [x!, -y!, z!];
		runtime.lighting.primaryDirection = native(view.primaryDirection);
		runtime.lighting.primaryColor = view.primaryColor;
		runtime.lighting.dirLightVectorLimited = native(view.tod.sunDirectionWorld);
		runtime.swapLightFactor = view.tod.swapLightFactor;
		runtime.timeOfDayHours = view.tod.minute / 60;
		runtime.gameTime = Math.fround(context.clock());
		runtime.nativeCullingSign = cameraSign as 1 | -1;
		runtime.nativePrimitiveDeterminantSign = sign as 1 | -1;
		runtime.nativeFrontFaceParity = -sign as 1 | -1;
		renderer.getCurrentViewport(viewport);
		runtime.viewportSize = [viewport.z, viewport.w];
		runtime.inverseProjectionX = 1 / camera.projectionMatrix.elements[0]!;
		current?.userData.characterJewelRefreshUniforms();
		deferred.userData.characterJewelRuntime = {
			...runtime,
			policy:
				'actual-editor-primary/manual-source-TOD; authored-MPC-init; direct-linear-HDR; single-pass-PBR',
			clockDomain: 'editor-monotonic-seconds-not-live-UE',
			collectionScope: 'source initialization, not current game MPC',
			facingContract:
				'paired-sign algebra with shader per-instance determinant; not individual GPUScene flags',
			glintCoordinates: 'native source/reference-bind centimetres, independent of geometry bake',
			rendererFrame: renderer.info.render.frame,
		};
		if (!renderer.getRenderTarget() && object.visible) context.draw();
	};

	const finalize: MeshPhysicalMaterial['onBeforeRender'] = (...args) => {
		if (current) return;

		update(...args);
		current = applyEnvironmentLighting(createCharacterJewelMaterial(profile, sources, runtime, update));

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
