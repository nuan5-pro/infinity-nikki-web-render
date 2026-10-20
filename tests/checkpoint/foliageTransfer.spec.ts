import { describe, expect, it } from 'vitest';
import { DoubleSide, NearestFilter, NoColorSpace, ShaderLib, SRGBColorSpace, Texture } from 'three';
import {
	bindFoliageCycleAtlas,
	createFoliageMaterial,
	disposeFoliageCycleAtlases,
	readFurnitureFoliage,
	type FurnitureFoliage,
} from '../../src/materials/foliage/foliageShader.js';
import { bindPaperMaterial } from '../../src/furniture/paperMaterial.js';
import { CustomDataBuffer } from '../../src/furniture/customData.js';
import type { FurnitureResourceReader } from '../../src/resources/resources.js';

function config(maskSRGB: boolean): FurnitureFoliage {
	return {
		family: 'foliage-3tex-array-v02-1',
		version: 1,
		mode: 'static-core-preview',
		sourceAlpha: true,
		textureSRGB: [true, false, maskSRGB, false, false],
		color: [1, 1, 1],
		colorBack: [1, 1, 1],
		gradient: [1, 1, 1],
		separateTint: 0,
		roughnessFront: [0.2, 0.8],
		roughnessBack: [0.3, 0.9],
		specular: [0.1, 1, 1.7, 0.8],
		ao: [0.4, 1],
		metallic: 0,
		uvScale: 1,
		normalFlatness: 0,
		cutoff: 0.3333,
		emissive: [0, 0, 0],
		emissiveBaseColor: 0,
	};
}

function homeConfig(): FurnitureFoliage {
	return {
		...config(false),
		family: 'foliage-home-array-st9',
		sourceAlpha: false,
		nearest: [true, true, true, true, true],
		home: {
			vertexMask: 'source-red',
			tintStrength: 0.5,
			hue: 0.2,
			opacityMask: 0.8,
			specularTexture: true,
			specularUv: 3,
			specularChannel: [0, 1, 0],
			specularIntensity: [0.06, 0.06],
			gradient: { grid: [3, 2], params: [0, 1.5, 0.2, 0], raw: 1 },
		},
	};
}

describe('native foliage role transfer', () => {
	for (const srgb of [false, true]) {
		it(`preserves the independently sampled mask transfer (${srgb}) without changing shared textures`, () => {
			const diffuse = new Texture();
			const normal = new Texture();
			const mask = new Texture();
			const material = createFoliageMaterial(config(srgb), diffuse, normal, mask);
			expect(material.map!.colorSpace).toBe(SRGBColorSpace);
			expect(material.normalMap!.colorSpace).toBe(NoColorSpace);
			expect(material.aoMap!.colorSpace).toBe(srgb ? SRGBColorSpace : NoColorSpace);
			expect(mask.colorSpace).toBe(NoColorSpace);
			expect(material.aoMap).not.toBe(mask);
			expect(material.userData.foliage.roughnessFront).toEqual([0.2, 0.8]);
			material.dispose();
			diffuse.dispose();
			normal.dispose();
			mask.dispose();
		});
	}

	it('rejects malformed transfer flags', () => {
		expect(readFurnitureFoliage({ ...config(true), textureSRGB: [true, false] })).toBeNull();
		expect(readFurnitureFoliage({ ...config(true), textureSRGB: [true, false, 1, false, false] })).toBeNull();
	});

	it('keeps native normal RG until after its sRGB sample, then converts handedness once', () => {
		const source = new Texture();
		const p = config(false);
		p.textureSRGB![1] = true;

		const material = createFoliageMaterial(p, source, source, source, null, null, {
			normalEncoding: 'native-rg',
		});

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		material.onBeforeCompile(shader as never, undefined as never);
		expect(material.normalMap!.colorSpace).toBe(SRGBColorSpace);
		expect(shader.fragmentShader).toContain('foliageNormalRG.y = -foliageNormalRG.y;');
		expect(shader.fragmentShader.indexOf('texture2D(normalMap, vFoliageUv)')).toBeLessThan(
			shader.fragmentShader.indexOf('foliageNormalRG.y = -foliageNormalRG.y;'),
		);
		material.dispose();
		source.dispose();
	});

	it.each(['ordinary', 'home', 'uco'] as const)('rejects %s coverage before mask/tint shading with original coordinate gradients', (mode) => {
		const source = new Texture();
		const input = mode === 'ordinary' ? config(false) : homeConfig();
		if (mode === 'uco') input.home!.coverage = { mode: 'uco-static-noise-zero', cutoff: 0.4 };
		const material = createFoliageMaterial(input, source, source, source, source, source);
		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		try {
			material.onBeforeCompile(shader as never, undefined as never);
			const fragment = shader.fragmentShader;
			const coverage = fragment.indexOf(
				mode === 'ordinary'
					? '#include <alphatest_fragment>'
					: mode === 'uco'
						? 'float foliageUcoCoverage ='
						: 'if (diffuseColor.a < foliageCoverageCutoff) discard;',
			);
			expect(coverage).toBeGreaterThan(0);
			expect(fragment.indexOf('vec4 sampledDiffuseColor =')).toBeLessThan(coverage);
			expect(fragment.indexOf('dFdx(vFoliageUv)')).toBeLessThan(coverage);
			expect(fragment.indexOf('#include <alphamap_fragment>')).toBeLessThan(coverage);
			expect(coverage).toBeLessThan(fragment.indexOf('textureGrad(foliageMaskMap,'));
			expect(fragment.indexOf('foliageSpecular = clamp(')).toBeLessThan(fragment.indexOf('diffuseColor.rgb *= vFoliageHighlight;'));
			expect(material.side).toBe(DoubleSide);
			expect(material.alphaTest).toBe(input.home ? input.cutoff / input.home.opacityMask : input.cutoff);
			if (input.home) {
				for (const coordinate of ['foliageAtlasUv', 'foliageAtlasUvB', 'vFoliageSpecularUv']) {
					expect(fragment.indexOf(`dFdx(${coordinate})`)).toBeGreaterThan(0);
					expect(fragment.indexOf(`dFdx(${coordinate})`)).toBeLessThan(coverage);
				}
				expect(material.aoMap!.minFilter).toBe(NearestFilter);
				expect(material.aoMap!.generateMipmaps).toBe(false);
			}
		} finally {
			material.dispose();
			source.dispose();
		}
	});

	it('keeps Paper array layers separate from the two-dimensional mask gradients', () => {
		const source = new Texture();
		source.userData.paperLayer = 'raw';
		const material = createFoliageMaterial(config(false), source, null, source);
		material.userData.textureInputs = { O: { paperLayer: 'raw' } };
		const buffer = new CustomDataBuffer([1], 1, 64);
		bindPaperMaterial(material, buffer);
		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		try {
			material.onBeforeCompile(shader as never, undefined as never);
			expect(shader.fragmentShader).toContain('uniform highp sampler2DArray foliageMaskMap;');
			expect(shader.fragmentShader).toMatch(/textureGrad\(foliageMaskMap, vec3\(\s*vFoliageUv, [^\n]+\), foliageUvDx, foliageUvDy\)/);
			expect(shader.fragmentShader.indexOf('dFdx(vFoliageUv)')).toBeLessThan(shader.fragmentShader.indexOf('if ( diffuseColor.a < alphaTest ) discard;'));
		} finally {
			buffer.dispose();
			material.dispose();
			source.dispose();
		}
	});

	it('captures cycle coordinates before coverage while retaining its one-mip atlas', async () => {
		const input = homeConfig();
		delete input.home!.gradient;
		input.home!.specularTexture = false;
		input.home!.specularConstant = [0, 0.06, 0];
		input.home!.cycle = {
			uv: 1,
			width: 2,
			nightIndex: 0,
			useRaw: 1,
			raw: 1,
			atlas: {
				width: 2,
				height: 2,
				resource: 'r-0000000000000000',
				byteOffset: 0,
				byteLength: 32,
				nearest: false,
				addressX: 'TA_Wrap',
				addressY: 'TA_Clamp',
			},
		};
		let atlas: Texture | undefined;
		const resources: FurnitureResourceReader = {
			read: async () => new Uint8Array(32),
			texture: async (_key, load) => {
				atlas = await load();
				return atlas;
			},
		};
		await bindFoliageCycleAtlas(input.home!.cycle.atlas, resources);
		const source = new Texture();
		const material = createFoliageMaterial(input, source, source, source);
		const shader = {
			uniforms: {} as Record<string, { value: Texture }>,
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		try {
			material.onBeforeCompile(shader as never, undefined as never);
			const fragment = shader.fragmentShader;
			const coverage = fragment.indexOf('if (diffuseColor.a < foliageCoverageCutoff) discard;');
			expect(fragment.indexOf('dFdx(foliageCycleUv)')).toBeLessThan(coverage);
			expect(coverage).toBeLessThan(fragment.indexOf('textureGrad(foliageTintMap, foliageCycleUv,'));
			expect(fragment).not.toContain('dFdx(vFoliageSpecularUv)');
			expect(shader.uniforms.foliageTintMap!.value.generateMipmaps).toBe(false);
		} finally {
			material.dispose();
			source.dispose();
			disposeFoliageCycleAtlases(resources);
			atlas?.dispose();
		}
	});
});
