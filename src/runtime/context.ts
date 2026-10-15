import type { Camera, IUniform, Scene, WebGLRenderer } from 'three';
import { createGroupPreparation } from './groupPreparation.js';
import { prepareUniformArrayCache } from './uniformArrayCache.js';
import { createShadowUpdates } from './shadowUpdates.js';
import { installNNClothRendererContext } from '../materials/nncloth/nnclothRendererContext.js';
import { installParallaxCardPreviewContext } from '../materials/effects/parallaxCardPreview.js';
import { installCharacterJewelPreviewContext } from '../materials/jewel/characterJewelPreview.js';
import { releaseOutputUniforms, setOutputUniforms, type MaterialLighting } from './lighting.js';

export interface RenderContextOptions {
	renderer: WebGLRenderer;
	scene: Scene;
	getCamera(): Camera | undefined;
	invalidate(): void;
	lighting(): MaterialLighting;
	clock?: () => number;
	outputUniforms?: Record<string, IUniform>;
}

const owners = new WeakSet<WebGLRenderer>();
const scenes = new WeakSet<Scene>();

export function createRenderContext(options: RenderContextOptions) {
	const { renderer, scene } = options;
	if (owners.has(renderer)) throw new Error('Renderer already has an active render context');
	if (scenes.has(scene)) throw new Error('Scene already belongs to an active render context');

	owners.add(renderer);
	scenes.add(scene);

	let disposed = false;
	const callbacks = new Set<() => void>();
	const disposers = new Set<() => void>();
	const cleanups: Array<() => void> = [];
	let preparation: ReturnType<typeof createGroupPreparation>;
	try {
		cleanups.push(installNNClothRendererContext(renderer));
		cleanups.push(installParallaxCardPreviewContext(renderer, scene, {
			invalidate: options.invalidate, clock: options.clock,

			swapLightFactor: () => options.lighting().tod.swapLightFactor,
		}));
		cleanups.push(installCharacterJewelPreviewContext(renderer, scene, {
			invalidate: options.invalidate, lighting: options.lighting, clock: options.clock,
		}));
		if (options.outputUniforms) setOutputUniforms(renderer, options.outputUniforms);
		preparation = createGroupPreparation(renderer, () => ({ scene, camera: options.getCamera() }), options.invalidate);
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
		invalidate: options.invalidate,

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
			if (camera) updateShadows(renderer, scene, camera);
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
