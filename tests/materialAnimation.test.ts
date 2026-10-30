import { afterEach, expect, it, vi } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Mesh, PerspectiveCamera, Scene, Texture, type WebGLRenderer } from 'three';
import {
	hasABSFXAnimation,
	hasCharacterJewelAnimation,
	hasIntStaticMeshAnimation,
	hasParallaxCardAnimation,
} from '../src/runtime/materialAnimation.js';
import { finalizeMaterial } from '../src/runtime/materialPreparation.js';
import { createDeferredCharacterJewelPreviewMaterial, installCharacterJewelPreviewContext } from '../src/materials/jewel/characterJewelPreview.js';
import { CHARACTER_JEWEL_ATTRIBUTES } from '../src/materials/jewel/characterJewelGeometry.js';
import type { FurnitureCharacterJewel } from '../src/materials/jewel/characterJewelShader.js';
import type { FurnitureABSFXCurrent } from '../src/materials/effects/absFxCurrentShader.js';
import type { FurnitureParallaxCard } from '../src/materials/effects/parallaxCardShader.js';
import type { FurnitureIntStaticMeshCurrent } from '../src/materials/surface/intStaticMeshCurrentShader.js';

const uniforms = (count: number) => Array.from({ length: count }, () => [0, 0, 0, 0]);

afterEach(() => { vi.unstubAllGlobals(); });

it('does not animate a static or zero-output character jewel glint', () => {
	const p = { uniforms: uniforms(39) } as FurnitureCharacterJewel;
	p.uniforms[11] = [1, .1, .05, 0];
	p.uniforms[15] = [1, 1, 1, 0];
	expect(hasCharacterJewelAnimation(p)).toBe(true);
	p.uniforms[11]![2] = 0;
	expect(hasCharacterJewelAnimation(p)).toBe(false);
	p.uniforms[11]![2] = .05;
	p.uniforms[15] = [0, 0, 0, 1];
	expect(hasCharacterJewelAnimation(p)).toBe(false);
	p.uniforms[15]![0] = 1;
	p.uniforms[11]![1] = 0;
	expect(hasCharacterJewelAnimation(p)).toBe(false);
});

it('requires an active time-dependent glint, not just the int-static variant name', () => {
	const p = { variant: 'pattern-layer-glint', uniforms: uniforms(34) } as FurnitureIntStaticMeshCurrent;
	p.uniforms[19] = [.4, 0, 20, 0];
	p.uniforms[20] = [8, .2, 1, 1];
	p.uniforms[21] = [10, .1, 1, .5];
	expect(hasIntStaticMeshAnimation(p)).toBe(false);
	p.uniforms[19]![3] = .2;
	expect(hasIntStaticMeshAnimation(p)).toBe(true);
	p.uniforms[21]![2] = 0;
	expect(hasIntStaticMeshAnimation(p)).toBe(false);
});

it('does not animate noise scrolling when its parallax output is disabled', () => {
	const p = { version: 3, current: { uniforms: uniforms(11) } } as FurnitureParallaxCard;
	p.current!.uniforms[8] = [.1, 0, 0, 0];
	expect(hasParallaxCardAnimation(p)).toBe(false);
	p.current!.uniforms[8]![1] = 1;
	expect(hasParallaxCardAnimation(p)).toBe(true);
	p.current!.uniforms[8]![0] = 0;
	expect(hasParallaxCardAnimation(p)).toBe(false);
	const legacy = { version: 2, scalars: { 'Noise Intensity': 0, 'X Noise Speed': 0, 'Y Noise Speed': .1 } } as FurnitureParallaxCard;
	expect(hasParallaxCardAnimation(legacy)).toBe(false);
	legacy.scalars['Noise Intensity'] = 1;
	expect(hasParallaxCardAnimation(legacy)).toBe(true);
});

it('keeps ABSFX glint, UV scrolling and breathing live without animating zero coverage', () => {
	const p = { uniforms: uniforms(52), collection: { baseColor: [1, 1, 1, 1] } } as FurnitureABSFXCurrent;
	expect(hasABSFXAnimation(p)).toBe(false);
	p.uniforms[1]![1] = .1;
	p.uniforms[3]![3] = 1;
	expect(hasABSFXAnimation(p)).toBe(true);
	p.uniforms[3]![3] = 0;
	expect(hasABSFXAnimation(p)).toBe(false);
	p.uniforms[26]![1] = .1;
	expect(hasABSFXAnimation(p)).toBe(true);
	p.uniforms[26]![1] = 0;
	p.uniforms[36]![2] = .5;
	p.uniforms[37] = [0, 1, 1, 1];
	expect(hasABSFXAnimation(p)).toBe(false);
	p.uniforms[37]![2] = 2;
	expect(hasABSFXAnimation(p)).toBe(true);
	p.collection.baseColor[3] = 0;
	expect(hasABSFXAnimation(p)).toBe(false);
});

it('prepares animated jewel uniforms without treating shader finalization as a presented frame', () => {
	const request = vi.fn(() => 73);
	vi.stubGlobal('requestAnimationFrame', request);
	vi.stubGlobal('cancelAnimationFrame', vi.fn());
	const scene = new Scene();
	const camera = new PerspectiveCamera();
	const renderer = {
		shadowMap: { enabled: false, type: 1 },
		getRenderTarget: () => null,
		getCurrentViewport: (value: { set: (...args: number[]) => void }) => value.set(0, 0, 800, 600),
	} as unknown as WebGLRenderer;
	const lighting = { primaryDirection: [0, 0, -1], primaryColor: [1, 1, 1], tod: { minute: 720, sunDirectionWorld: [0, 0, 1], swapLightFactor: -1 } } as const;
	const release = installCharacterJewelPreviewContext(renderer, scene, {
		invalidate: vi.fn(), clock: () => 1,
		lighting: () => ({ ...lighting, primaryDirection: [...lighting.primaryDirection], primaryColor: [...lighting.primaryColor] }),
	});
	const p = {
		version: 1, family: 'character-jewel-current', variant: 'surface', vertexFactory: 'FLocalVertexFactory',
		twoSided: false, requiredUV: [0], uniforms: uniforms(39),
		collection: { ready: 0, aaMethod: 0, globalFactor: 1, fillIntensity: 0, fillSkyColor: [0, 0, 0], fillGroundColor: [0, 0, 0], resolvedSunColor: [0, 0, 0], dirLightVectorLimited: [0, 0, -1] },
		textures: Object.fromEntries(['N', 'D1', 'D', 'B', 'T', 'N1', 'T1', 'O'].map(role => [role, { parameter: role, sRGB: false, rgbScale: 1, addressX: 'TA_Wrap', addressY: 'TA_Wrap', mipmaps: false, nearest: false, cube: role === 'O' }])),
	} as FurnitureCharacterJewel;
	p.uniforms[11] = [1, .1, .05, 0];
	p.uniforms[15] = [1, 1, 1, 0];
	const sources = Object.fromEntries(Object.keys(p.textures).map(role => [role, new Texture()]));
	const material = createDeferredCharacterJewelPreviewMaterial(p, sources);
	const geometry = new BufferGeometry();
	geometry.userData.characterJewelNativeFrame = true;
	for (const name of ['position', ...CHARACTER_JEWEL_ATTRIBUTES])
		geometry.setAttribute(name, new Float32BufferAttribute([0, 0, 0], 3));
	const mesh = new Mesh(geometry, material);
	try {
		finalizeMaterial(material, renderer, scene, camera, geometry, mesh, null);
		expect(request).not.toHaveBeenCalled();
		material.onBeforeRender(renderer, scene, camera, geometry, mesh, null as never);
		expect(request).toHaveBeenCalledOnce();
	} finally {
		release();
		material.dispose();
		geometry.dispose();
		Object.values(sources).forEach(texture => texture.dispose());
	}
});
