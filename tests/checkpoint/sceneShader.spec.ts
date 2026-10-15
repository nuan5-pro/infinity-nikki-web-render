import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, NoColorSpace, ShaderLib, SRGBColorSpace, Texture } from 'three';
import {
	createSceneMaterial,
	readFurnitureScene,
	type FurnitureScene,
} from '../../src/materials/sceneShader.js';

function config(): FurnitureScene {
	return {
		family: 'scene-single-layer',
		version: 1,
		color: [1, 1, 1],
		roughness: [0, 1],
		metalness: [0, 1],
		ao: [1, 1],
		normalIntensity: 2,
		specular: 0.5,
		textureSRGB: [true, false, false, true],
		textureMipmaps: [true, true, true, true],
		emissiveSource: 'T',
		emissive: [50, 17, 5],
		coverage: 'diffuse-alpha',
		cutoff: 0.3333,
		edge: { color: [0.3, 0.14, 0.04, 1], range: 3, useCoatingMask: 0 },
		detailNormal: { adjust: [1, 40, 40, 0.7], mipmaps: true },
		selectiveOutputMask: 128,
	};
}

describe('Scene native sampling factory', () => {
	it('validates new fields and refuses missing fifth resource', () => {
		const scene = config();
		expect(readFurnitureScene(scene)).toBe(scene);
		expect(readFurnitureScene({ ...scene, selectiveOutputMask: 1 })).toBeNull();
		expect(readFurnitureScene({ ...scene, edge: { ...scene.edge, range: NaN } })).toBeNull();

		const texture = new Texture();
		expect(() => createSceneMaterial(scene, texture, texture, texture, new MeshStandardMaterial(), texture)).toThrow(/Normal1/);
	});
	it('injects RNM, pre-clamp edge and emission without applying intensity twice', () => {
		const scene = config();
		const texture = new Texture();
		const material = createSceneMaterial(scene, texture, texture, texture, new MeshStandardMaterial(), texture, texture);

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], undefined as never);
		expect(shader.vertexShader).toContain('mix(uv, uv1, sceneDetailNormalAdjust.r)');
		expect(shader.fragmentShader).toContain('mapN.xy *= sceneNormalSigns;');
		expect(shader.fragmentShader).not.toContain('mapN.xy *= normalScale;');
		expect(shader.fragmentShader).toContain('clamp(sceneRawBase + sceneEdgeRGB, 0.0, 1.0)');
		expect(shader.fragmentShader).toContain('max(totalEmissiveRadiance + sceneEdgeRGB * sceneEdgeColor.a, vec3(0.0))');
		expect(material.alphaTest).toBe(0.3333);
		expect(material.customProgramCacheKey()).toContain('furniture_scene_v2');
		material.dispose();
	});
	it.each([undefined, false, true])(
		'preserves native detail transfer %s independently of the base normal',
		(srgb) => {
			const scene = config();
			scene.detailNormal = { ...scene.detailNormal!, srgb };
			expect(readFurnitureScene(scene)).toBe(scene);
			expect(readFurnitureScene({ ...scene, detailNormal: { ...scene.detailNormal, srgb: 'true' } })).toBeNull();

			const texture = new Texture();
			const source = new MeshStandardMaterial();
			const material = createSceneMaterial(scene, texture, texture, texture, source, texture, texture);

			const shader = {
				uniforms: {} as Record<string, { value: unknown }>,
				vertexShader: ShaderLib.standard.vertexShader,
				fragmentShader: ShaderLib.standard.fragmentShader,
			};

			material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], undefined as never);

			const detail = shader.uniforms.sceneDetailNormalMap!.value as Texture;
			expect(detail.colorSpace).toBe(srgb ? SRGBColorSpace : NoColorSpace);
			expect(material.normalMap!.colorSpace).toBe(NoColorSpace);
			expect(detail).not.toBe(texture);
			expect(texture.colorSpace).toBe(NoColorSpace);

			material.dispose();
			source.dispose();
			texture.dispose();
		},
	);
});
