import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, ShaderLib, Texture } from 'three';
import {
	createLayeredMaterial,
	readFurnitureLayered,
	type FurnitureLayered,
	type LayeredRole,
} from '../../src/materials/layered/layeredShader.js';

function fixture(): FurnitureLayered {
	const layer = {
		uv: [1, 0, 0, 0],
		normalUv: [1, 0, 0, 0],
		transform: [1, 1, 0, 0],
		color: [1, 1, 1],
		albedo: [1, 1, 1],
		normalEncoding: 'rg',
		normalIntensity: 1,
		roughness: [0, 1],
		ao: 1,
	};

	const roles = ['D', 'N', 'O', 'D1', 'N1', 'N2', 'B', 'C', 'M'];
	return {
		family: 'layered-static',
		version: 1,
		mode: 'rock-vertex',
		colorMask: true,
		requiredUv: [0, 1, 2, 3],
		uvFallback: 'local-last-channel',
		layers: [structuredClone(layer), structuredClone(layer)],
		blend: [0, 0, 0, 0],
		edge: [3, 2, 3],
		vertexChannel: [0, 1, 0, 0],
		metalness: [0, 0],
		ao: [0, 0],
		emissive: [
			[0, 0, 0],
			[0, 0, 0],
		],
		specular: 0.5,
		useOrm: 0,
		textures: Object.fromEntries(
			roles.map((role) => [
				role,
				{
					key: role,
					slice: -1,
					srgb: false,
					mipmaps: true,
					filter: 'TF_Default',
					addressX: 'TA_Wrap',
					addressY: 'TA_Wrap',
					sampler: role === 'N2' ? 'texture-asset' : 'view-world-wrap',
				},
			]),
		),
		rock: {
			mainNormalIntensity: 0.7,
			detailNormalUv: [0, 1, 0, 0],
			detailNormalTiling: 7,
			detailNormalIntensity: 0.3,
			macroAmount: 0.75,
			macroBlend: 1,
			macroTiling: 1,
			maskUv: [1, 0, 0, 0],
			maskIntensity: [1, 1, 1, 1],
			maskColor: [
				[1, 1, 1],
				[1, 1, 1],
				[1, 1, 1],
				[1, 1, 1],
			],
			maskRoughness: [1, 1, 1, 1],
			macroRoughness: 0.3,
			useRoughness: 0,
			useMetallic: 0,
		},
	} as FurnitureLayered;
}

describe('rock vertex native normal inputs', () => {
	it('keeps Detail sampling and strength independent from Main, color and Layer02', () => {
		const config = fixture();
		expect(readFurnitureLayered(config)).toBe(config);

		const inputs = Object.fromEntries(Object.keys(config.textures).map((role) => [role, new Texture()])) as Record<LayeredRole, Texture>;
		const source = new MeshStandardMaterial();
		const material = createLayeredMaterial(config, inputs, source);

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {} as Record<string, { value: unknown }>,
		};

		material.onBeforeCompile(shader, {} as never);

		expect(shader.fragmentShader).toContain('layeredUv(rockDetailNormalUv) * rockDetailNormalTiling');
		expect(shader.fragmentShader).toContain('texture2D(layeredN2, layerNormalUV01)');
		expect(shader.fragmentShader).toContain('layeredRNM(mainNormal, layeredRG(layerN01, rockDetailNormalIntensity, 1.0))');
		expect(shader.fragmentShader).toContain('mix(normal0, layeredRNM(normal0, normal1), layerWeight)');
		expect(shader.uniforms.rockMainNormalIntensity?.value).toBe(0.7);
		expect(shader.uniforms.rockDetailNormalIntensity?.value).toBe(0.3);
		expect(shader.uniforms.rockDetailNormalTiling?.value).toBe(7);
		expect((shader.uniforms.rockDetailNormalUv?.value as { toArray(): number[] }).toArray()).toEqual([0, 1, 0, 0]);
		material.dispose();
		source.dispose();
		Object.values(inputs).forEach((texture) => texture.dispose());
	});

	it('rejects incomplete old contracts rather than substituting another normal', () => {
		const config = fixture();
		delete config.textures.N2;
		expect(readFurnitureLayered(config)).toBeNull();
		expect(() => createLayeredMaterial(config, {}, new MeshStandardMaterial())).toThrow('Detail normal stack');
	});
});
