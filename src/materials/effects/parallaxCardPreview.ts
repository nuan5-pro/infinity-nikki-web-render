import {
	DoubleSide,
	Matrix3,
	Matrix4,
	MeshBasicMaterial,
	type Camera,
	type Material,
	type Scene,
	type Texture,
	type WebGLRenderer,
} from 'three';
import {
	createParallaxCardMaterial,
	readFurnitureParallaxCard,
	type FurnitureParallaxCard,
} from './parallaxCardShader.js';
import { parallaxCardDrawProof } from './parallaxCardGeometry.js';
import { parallaxCardBasisV2DrawProof, type ParallaxCardBasisV2Proof } from './parallaxCardBasisV2.js';
import { validateParallaxCardRuntime, type ParallaxCardRuntime } from './parallaxCardSource.js';
import { registerMaterialFinalizer } from '../../runtime/materialPreparation.js';
import { CURRENT_PARALLAX_CARD_ATTRIBUTES } from './parallaxCardCurrentGeometry.js';
import { hasParallaxCardAnimation } from '../../runtime/materialAnimation.js';
import { textureChannelVaries } from '../../runtime/textureChannels.js';

interface Context {
	renderer: WebGLRenderer;
	scene: Scene;
	clock: () => number;
	swapLightFactor?: () => number;
	draw: () => void;
	active: boolean;
}
// Scene-scoped symbol survives Vite/HMR URL aliases without a global renderer
// singleton or a guessed callback. Only the real ready owner installs it.
const contextKey = Symbol.for('building-momo.parallax-card-preview-context-v1');

type PreviewScene = Scene & { [contextKey]?: Context };

/** The compositor calls this only for moving Cards actually drawn in its HDR
 * colour pass after successful presentation. Auxiliary targets never call it. */
export function notifyParallaxCardPresented(renderer: WebGLRenderer, scene: Scene, material: Material): void {
	const context = (scene as PreviewScene)[contextKey];
	if (
		!context?.active ||
		context.renderer !== renderer ||
		context.scene !== scene ||
		!material.visible ||
		material.userData.parallaxCardDisposed
	) return;

	const profile = readFurnitureParallaxCard(material.userData.parallaxCard);
	if (
		!profile || !Number.isInteger(material.userData.parallaxCardRendererFrame) ||
		material.userData.parallaxCardAnimated === false || !hasParallaxCardAnimation(profile)
	) return;

	context.draw();
}

/** Install from the editor's real ready context. One next-frame request follows
 * an actual visible default-target draw; offscreen/water passes never schedule. */
export function installParallaxCardPreviewContext(
	renderer: WebGLRenderer,
	scene: Scene,
	options: { invalidate: () => void; clock?: () => number; swapLightFactor?: () => number; isAnimating?: () => boolean },
): () => void {
	const owner = scene as PreviewScene;
	const prior = owner[contextKey];
	if (prior?.active) throw new Error('[ModelManager][ParallaxCard] dispose prior scene provider before ready replacement');

	let pending: number | undefined;

	const context: Context = {
		renderer,
		scene,
		clock: options.clock ?? (() => performance.now() * 0.001),
		swapLightFactor: options.swapLightFactor,
		active: true,

		draw: () => {
			if (pending !== undefined || !context.active || options.isAnimating?.() === false) return;

			pending = requestAnimationFrame(() => {
				pending = undefined;
				if (context.active && options.isAnimating?.() !== false) options.invalidate();
			});
		},
	};

	owner[contextKey] = context;
	return () => {
		context.active = false;
		if (pending !== undefined) cancelAnimationFrame(pending);
		pending = undefined;
		if (owner[contextKey] === context) delete owner[contextKey];
	};
}

function rigidCamera(camera: Camera): 1 | -1 {
	camera.updateWorldMatrix(true, false);

	const e = camera.matrixWorld.elements;
	const columns = [0, 1, 2].map((i) => [e[i * 4]!, e[i * 4 + 1]!, e[i * 4 + 2]!] as const);
	if (
		!e.every(Number.isFinite) ||
		columns.some((c) => Math.abs(Math.hypot(...c) - 1) > 1e-5) ||
		columns.some((c, i) => Math.abs(c.reduce((s, x, k) => s + x * columns[(i + 1) % 3]![k]!, 0)) > 1e-5)
	) throw new Error('[ModelManager][ParallaxCard] rigid actual preview camera required');

	return Math.sign(camera.matrixWorld.determinant()) as 1 | -1;
}

export function createDeferredParallaxCardPreviewMaterial(profile: FurnitureParallaxCard, sources: Partial<Record<string, Texture | null>>): MeshBasicMaterial {
	const animated = hasParallaxCardAnimation(profile) && textureChannelVaries(sources.O, 0);
	const deferred = new MeshBasicMaterial({
		side: DoubleSide,
		transparent: false,
		alphaTest: 0,
		depthWrite: true,
	});
	deferred.userData.parallaxCardAnimated = animated;
	deferred.userData.parallaxCard = profile;

	let current: MeshBasicMaterial | undefined;

	const runtime: ParallaxCardRuntime = {
		gameTime: NaN,
		swapLightFactor: 1,
		materialTextureMipBias: 0,
		preExposure: 1,
		outputClamp: profile.sourceOutputBound,
		nativeCullingSign: 1,
		nativePrimitiveDeterminantSign: 1,
		nativeFrontFaceParity: 1,
	};

	const instance = new Matrix4();
	const world = new Matrix4();
	let sourceBasis: ParallaxCardBasisV2Proof | undefined;

	const updateSourceBasis = () => {
		if (profile.version !== 2 || !current) return;
		if (!sourceBasis || sourceBasis.contract !== profile.basisV2?.contract) throw new Error('[ModelManager][ParallaxCard] v2 native draw/source profile conflict');

		const uniforms = current.userData.parallaxCardUniforms;
		const frame = uniforms.cardSourceToGeometry.value as Matrix3;
		frame.fromArray(sourceBasis.sourceToGeometry);
		uniforms.cardSourceWindingParity.value = sourceBasis.sourceWindingParity;
	};

	const update: MeshBasicMaterial['onBeforeRender'] = (renderer, scene, camera, geometry, object, group) => {
		const context = (scene as PreviewScene)[contextKey];
		if (!context?.active || context.renderer !== renderer) throw new Error('[ModelManager][ParallaxCard] actual editor scene/frame provider required');

		const proof =
			profile.version === 3
				? undefined
				: profile.version === 2
					? parallaxCardBasisV2DrawProof(geometry, group)
					: parallaxCardDrawProof(geometry, group);
		sourceBasis = profile.version === 2 ? (proof as ParallaxCardBasisV2Proof) : undefined;
		if (profile.version === 3) {
			const count = geometry.getAttribute('position')?.count;
			if (
				!geometry.userData.currentParallaxCard ||
				!count ||
				CURRENT_PARALLAX_CARD_ATTRIBUTES.some((name) => geometry.getAttribute(name)?.count !== count)
			) throw new Error('[ModelManager][ParallaxCard] current native VF attributes lost');
		} else if (
			!proof ||
			proof.contract !== profile.geometry ||
			![1, -1].includes(proof.sourceWindingParity)
		) throw new Error('[ModelManager][ParallaxCard] source winding proof required');

		if ('isSkinnedMesh' in object && object.isSkinnedMesh) throw new Error('[ModelManager][ParallaxCard] source bind pose only');

		const sign = Math.sign(object.matrixWorld.determinant());
		if (![1, -1].includes(sign)) throw new Error('[ModelManager][ParallaxCard] object basis singular');
		// The current PS consumes the product of paired determinant/front signs.
		// Source-node winding cancels in that product; native TBN handedness stays
		// separately in the current VF attributes through each actual geometry bake.
		const sourceWindingParity = proof?.sourceWindingParity ?? 1;
		runtime.nativePrimitiveDeterminantSign = (sign * sourceWindingParity) as 1 | -1;
		runtime.nativeFrontFaceParity = (-sign * sourceWindingParity) as 1 | -1;
		runtime.nativeCullingSign = rigidCamera(camera);
		runtime.gameTime = Math.fround(context.clock());
		if (profile.version === 3) {
			if (!context.swapLightFactor) throw new Error('[ModelManager][ParallaxCard] current editor TOD provider required');

			runtime.swapLightFactor = context.swapLightFactor();
			// The editor draws linear HDR directly, without the native UE pre-exposed
			// scene buffer. Tone-mapping exposure belongs to the later output stage.
			runtime.preExposure = 1;
			runtime.outputClamp = Math.max(profile.sourceOutputBound * runtime.preExposure, Number.MIN_VALUE);
		}

		validateParallaxCardRuntime(runtime);

		const mesh = object as typeof object & {
			isInstancedMesh?: boolean;
			count?: number;
			getMatrixAt?: (i: number, m: Matrix4) => void;
			instanceMatrix?: { version: number };
		};

		const validateBasis = (matrix: Matrix4) => {
			const e = matrix.elements;
			const columns = [0, 1, 2].map((i) => [e[i * 4]!, e[i * 4 + 1]!, e[i * 4 + 2]!] as const);
			const lengths = columns.map((c) => Math.hypot(...c));
			if (
				!e.every(Number.isFinite) ||
				lengths.some((x) => x <= 0) ||
				columns.some(
					(c, i) =>
						Math.abs(c.reduce((sum, x, k) => sum + x * columns[(i + 1) % 3]![k]!, 0)) >
						1e-5 * lengths[i]! * lengths[(i + 1) % 3]!,
				)
			) throw new Error('[ModelManager][ParallaxCard] sheared/singular actor instance basis unproved');
		};

		if (mesh.isInstancedMesh) {
			if (!Number.isInteger(mesh.count) || !mesh.getMatrixAt) throw new Error('[ModelManager][ParallaxCard] instance matrix carrier missing');

			for (let i = 0; i < mesh.count!; i++) {
				mesh.getMatrixAt(i, instance);
				world.multiplyMatrices(object.matrixWorld, instance);
				validateBasis(world);
			}
		} else validateBasis(object.matrixWorld);

		updateSourceBasis();
		current?.userData.parallaxCardRefreshUniforms();
		deferred.userData.parallaxCardRendererFrame = renderer.info.render.frame;
		deferred.userData.parallaxCardAnimated = animated;
		if (current && animated && !renderer.getRenderTarget() && object.visible) context.draw();
	};

	deferred.customProgramCacheKey = () => 'parallax-card-awaiting-actual-draw-context';

	const finalize: MeshBasicMaterial['onBeforeRender'] = (...args) => {
		if (current) return;

		update(...args);
		if (!current) {
			current = createParallaxCardMaterial(profile, sources, runtime, update);
			current.name = deferred.name;
			current.side = deferred.side;

			const data = deferred.userData;
			const visible = deferred.visible;
			const toneMapped = deferred.toneMapped;
			deferred.copy(current);
			deferred.userData = { ...data, ...current.userData };
			deferred.visible = visible;
			deferred.toneMapped = toneMapped;
			deferred.defines = { ...current.defines };
			current.userData = deferred.userData;
			deferred.onBeforeCompile = current.onBeforeCompile;
			deferred.customProgramCacheKey = current.customProgramCacheKey;
			deferred.needsUpdate = true;
		}

		updateSourceBasis();
		current.userData.parallaxCardRefreshUniforms();
	};

	registerMaterialFinalizer(deferred, finalize);
	deferred.onBeforeRender = (...args) => {
		finalize(...args);
		update(...args);
	};
	deferred.addEventListener('dispose', () => {
		deferred.userData.parallaxCardDisposed = true;
		current?.dispose();
	});
	return deferred;
}
