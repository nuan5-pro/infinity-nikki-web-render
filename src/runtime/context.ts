import type { Camera, IUniform, Scene, WebGLRenderer } from 'three';
import { createGroupPreparation } from './groupPreparation.js';
import { prepareUniformArrayCache } from './uniformArrayCache.js';
import { createShadowUpdates } from './shadowUpdates.js';
import { prepareShadowPrograms } from './shadowPreparation.js';
import { installNNClothRendererContext } from '../materials/nncloth/nnclothRendererContext.js';
import { installParallaxCardPreviewContext } from '../materials/effects/parallaxCardPreview.js';
import { installCharacterJewelPreviewContext } from '../materials/jewel/characterJewelPreview.js';
import { releaseOutputUniforms, setOutputUniforms, type MaterialLighting } from './lighting.js';
import { createMaterialClock, installMaterialClock } from './materialClock.js';

export interface RenderContextOptions {
	renderer: WebGLRenderer;
	scene: Scene;
	getCamera(): Camera | undefined;
	invalidate(): void;
	onContextRestored?(): void | Promise<void>;
	lighting(): MaterialLighting;
	clock?: () => number;
	/** Defaults to playback. False starts at time zero and disables animation-driven redraws. */
	materialAnimation?: boolean;
	outputUniforms?: Record<string, IUniform>;
}

const owners = new WeakSet<WebGLRenderer>();
const scenes = new WeakSet<Scene>();

export function createRenderContext(options: RenderContextOptions) {
	const { renderer, scene } = options;
	if (owners.has(renderer)) throw new Error('Renderer already has an active render context');
	if (scenes.has(scene)) throw new Error('Scene already belongs to an active render context');

	const materialClock = createMaterialClock(options.clock, options.materialAnimation ?? true);
	owners.add(renderer);
	scenes.add(scene);

	let disposed = false;
	const callbacks = new Set<() => void>();
	const disposers = new Set<() => void>();
	const cleanups: Array<() => void> = [];
	const isAnimating = () => materialClock.enabled;
	const invalidateAnimation = () => { if (!disposed && isAnimating()) options.invalidate(); };
	let preparation: ReturnType<typeof createGroupPreparation>;
	try {
		cleanups.push(installMaterialClock(renderer, materialClock));
		cleanups.push(installNNClothRendererContext(renderer));
		cleanups.push(installParallaxCardPreviewContext(renderer, scene, {
			invalidate: invalidateAnimation, clock: materialClock.read, isAnimating,

			swapLightFactor: () => options.lighting().tod.swapLightFactor,
		}));
		cleanups.push(installCharacterJewelPreviewContext(renderer, scene, {
			invalidate: invalidateAnimation, lighting: options.lighting, clock: materialClock.read, isAnimating,
		}));
		if (options.outputUniforms) setOutputUniforms(renderer, options.outputUniforms);
		preparation = createGroupPreparation(renderer, () => ({ scene, camera: options.getCamera() }), options.invalidate, options.onContextRestored);
	} catch (error) {
		for (const cleanup of cleanups.reverse()) cleanup();

		releaseOutputUniforms(renderer);
		owners.delete(renderer);
		scenes.delete(scene);
		throw error;
	}

	const updateShadows = createShadowUpdates();
	return {
		renderer, scene,

		get disposed() { return disposed; },

		prepare: preparation.prepare,
		async prepareScene(
			stale: () => boolean,
			onProgress?: (completed: number, total: number, phase: 'shaders' | 'shadows') => void,
		) {
			const shadows = renderer.shadowMap.enabled;
			let total = 0;
			const ready = await preparation.prepareScene(stale, (completed, count) => {
				total = count;
				onProgress?.(completed, count + (shadows ? 1 : 0), 'shaders');
			});
			if (!ready || !shadows) return ready;
			const camera = options.getCamera();
			if (!camera || stale()) return false;
			onProgress?.(total, total + 1, 'shadows');
			if (!await prepareShadowPrograms(renderer, scene, camera, stale)) return false;
			onProgress?.(total + 1, total + 1, 'shadows');
			return true;
		},
		invalidate: options.invalidate,
		/** Pause or resume material time without advancing across the paused interval. */
		setMaterialAnimation(enabled: boolean) {
			if (disposed) throw new Error('Render context disposed');

			if (materialClock.setEnabled(enabled)) options.invalidate();
		},
		invalidateShadows() {
			renderer.shadowMap.needsUpdate = true;
			options.invalidate();
		},

		onBeforeRender(callback: () => void) {
			if (disposed) throw new Error('Render context disposed');

			callbacks.add(callback);
			return () => { callbacks.delete(callback); };
		},

		onDispose(callback: () => void) {
			if (disposed) throw new Error('Render context disposed');

			disposers.add(callback);
			return () => { disposers.delete(callback); };
		},

		beforeRender() {
			if (disposed) throw new Error('Render context disposed');

			for (const callback of callbacks) callback();

			prepareUniformArrayCache(renderer);

			const camera = options.getCamera();
			if (camera) updateShadows(renderer, camera);
		},

		dispose() {
			if (disposed) return;

			disposed = true;
			for (const dispose of disposers) dispose();

			disposers.clear();
			preparation.dispose();
			for (const cleanup of cleanups.reverse()) cleanup();

			callbacks.clear();
			releaseOutputUniforms(renderer);
			owners.delete(renderer);
			scenes.delete(scene);
		},
	};
}

export type RenderContext = ReturnType<typeof createRenderContext>;
