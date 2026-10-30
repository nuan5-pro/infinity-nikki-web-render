import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MeshBasicMaterial, Scene, Texture, type WebGLRenderer } from 'three';
import {
	parallaxCardOutputBound,
	readFurnitureParallaxCard,
	createParallaxCardMaterial,
	type FurnitureParallaxCard,
} from '../../src/materials/effects/parallaxCardShader.js';
import {
	parallaxCardSampleColor,
	type ParallaxCardRuntime,
} from '../../src/materials/effects/parallaxCardSource.js';
import { installParallaxCardPreviewContext, notifyParallaxCardPresented } from '../../src/materials/effects/parallaxCardPreview.js';

const path = process.env.PARALLAX_CARD_PROFILE_EVIDENCE;
const profile = path ? (JSON.parse(readFileSync(path, 'utf8')) as FurnitureParallaxCard) : null;

describe('actual Parallax source domain and preview boundary', () => {
	it('requests animation only after a moving card has drawn and stops for hidden or disposed materials', () => {
		const request = vi.fn(() => 73);
		vi.stubGlobal('requestAnimationFrame', request);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		const scene = new Scene();
		const renderer = {} as WebGLRenderer;
		const dispose = installParallaxCardPreviewContext(renderer, scene, { invalidate: vi.fn() });
		const material = new MeshBasicMaterial();
		const uniforms = Array.from({ length: 11 }, () => [0, 0, 0, 0]);
		uniforms[7]![3] = 1;
		uniforms[8]![1] = 1;
		material.userData.parallaxCard = {
			version: 3,
			family: 'parallax-card',
			geometry: 'parallax-card-current-native-frame-v3',
			coverage: 'native-mask-constant-one-not-character-alpha',
			sourceOutputBound: 6,
			nativeViewClamp: 'editor-source-bound-times-pre-exposure',
			current: { vertexFactory: 'FLocalVertexFactory', uniforms },
			textures: Object.fromEntries(['D', 'D1', 'T', 'T1', 'O'].map(role => [role, { cube: false, rgbScale: 1, sRGB: false }])),
		};
		try {
			notifyParallaxCardPresented(renderer, scene, material);
			expect(request).not.toHaveBeenCalled();
			material.userData.parallaxCardRendererFrame = 9;
			material.visible = false;
			notifyParallaxCardPresented(renderer, scene, material);
			expect(request).not.toHaveBeenCalled();
			material.visible = true;
			material.userData.parallaxCardDisposed = true;
			notifyParallaxCardPresented(renderer, scene, material);
			expect(request).not.toHaveBeenCalled();
			material.userData.parallaxCardDisposed = false;
			uniforms[7]![3] = 0;
			notifyParallaxCardPresented(renderer, scene, material);
			expect(request).not.toHaveBeenCalled();
			uniforms[7]![3] = 1;
			material.userData.parallaxCardAnimated = false;
			notifyParallaxCardPresented(renderer, scene, material);
			expect(request).not.toHaveBeenCalled();
			material.userData.parallaxCardAnimated = true;
			notifyParallaxCardPresented(renderer, scene, material);
			expect(request).toHaveBeenCalledOnce();
		} finally {
			dispose();
			material.dispose();
			vi.unstubAllGlobals();
		}
	});

	it.skipIf(!profile)(
		'proves all normalized-sample corners/TOD/windows and retains unknown native clamp',
		() => {
			const p = profile!;
			expect(readFurnitureParallaxCard(p)).toBe(p);
			expect(parallaxCardOutputBound(p)).toBe(6);
			expect(p.nativeViewClamp).toBe('unknown-cb0[318].x');

			const runtime: ParallaxCardRuntime = {
				gameTime: 431.234,
				swapLightFactor: 1,
				materialTextureMipBias: 0,
				preExposure: 1,
				outputClamp: 1000,
				nativeCullingSign: 1,
				nativePrimitiveDeterminantSign: 1,
				nativeFrontFaceParity: 1,
			};

			for (let corners = 0; corners < 64; corners++)
				for (const tod of [-2, 0, 0.25, 0.75, 1, 2])
					for (const tile of [
						[0.5, 0.5],
						[-0.5, 0.5],
						[1, 0.5],
					] as [number, number][]) {
						const bit = (i: number) => (corners >> i) & 1;
						const rgb = (i: number) => [bit(i), bit(i), bit(i)] as [number, number, number];

						const samples = {
							bg: rgb(0),
							bgEmissive: rgb(1),
							character: [bit(2), bit(2), bit(2), bit(3)] as [number, number, number, number],
							characterEmissive: rgb(4),
							noiseR: bit(5),
						};

						const raw = parallaxCardSampleColor(p.colors, samples, tile, p.scalars['Noise Intensity']!, { ...runtime, swapLightFactor: tod });
						expect(raw.slice(0, 3).every((x) => x >= 0 && x <= 6)).toBe(true);
						expect(
							parallaxCardSampleColor(p.colors, samples, tile, 1, {
								...runtime,
								swapLightFactor: tod,
								outputClamp: 6,
							}),
						).toEqual(raw);
					}

			const over = structuredClone(p);
			over.colors['Emissive BG Color'][1] = 7;
			expect(readFurnitureParallaxCard(over)).toBeNull();

			const negative = structuredClone(p);
			negative.scalars['Noise Intensity'] = -1;
			expect(readFurnitureParallaxCard(negative)).toBeNull();

			const fakeNative = structuredClone(p);
			fakeNative.nativeViewClamp = '65504';
			expect(readFurnitureParallaxCard(fakeNative)).toBeNull();
		},
	);

	it.skipIf(!profile)(
		'retains tangent declaration and direct source-alpha coverage in shader factory',
		() => {
			const p = profile!;
			const textures = Object.fromEntries(Object.keys(p.textures).map((role) => [role, new Texture()]));

			const runtime: ParallaxCardRuntime = {
				gameTime: 53.1,
				swapLightFactor: 1,
				materialTextureMipBias: 0,
				preExposure: 1,
				outputClamp: 6,
				nativeCullingSign: 1,
				nativePrimitiveDeterminantSign: 1,
				nativeFrontFaceParity: -1,
			};

			const material = createParallaxCardMaterial(p, textures, runtime, () => {});
			expect(material.defines.USE_TANGENT).toBe('');
			expect(material.alphaTest).toBe(0);
			expect(material.transparent).toBe(false);
			expect(material.userData.parallaxCardUniforms.cardO.value.colorSpace).toBe(material.userData.parallaxCardUniforms.cardD.value.colorSpace);
			material.dispose();
			Object.values(textures).forEach((texture) => texture.dispose());
		},
	);

	it('ready provider is scene-scoped, has no idle scheduling, cancels on dispose and accepts ready replacement', () => {
		const request = vi.fn(() => 73);
		const cancel = vi.fn();
		vi.stubGlobal('requestAnimationFrame', request);
		vi.stubGlobal('cancelAnimationFrame', cancel);

		const scene = new Scene();
		const renderer = {} as WebGLRenderer;
		const invalidate = vi.fn();
		const dispose = installParallaxCardPreviewContext(renderer, scene, { invalidate });
		expect(request).not.toHaveBeenCalled();

		const context = (scene as any)[Symbol.for('building-momo.parallax-card-preview-context-v1')];
		context.draw();
		context.draw();
		expect(request).toHaveBeenCalledTimes(1);
		dispose();
		expect(cancel).toHaveBeenCalledWith(73);
		expect(context.active).toBe(false);
		installParallaxCardPreviewContext(renderer, scene, { invalidate })();
		vi.unstubAllGlobals();
	});
});
