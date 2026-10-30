import {
	BufferGeometry,
	DataTexture,
	Float32BufferAttribute,
	MeshStandardMaterial,
	ShaderLib,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
	createLayeredMaterial,
	readFurnitureLayered,
	type FurnitureLayered,
	type LayeredRole,
} from '../../src/materials/layered/layeredShader.js';
import {
	rockTopLayerCore,
	rockTopLayerWeight,
	validRockTopLayer,
} from '../../src/materials/layered/rockTopLayerFoliageShader.js';

function sourceConfig(): FurnitureLayered {
	const roles: LayeredRole[] = ['D', 'N', 'O', 'D1', 'N1', 'O1', 'B', 'C', 'M', 'D2', 'N2', 'O2'];

	const layer = {
		uv: [1, 0, 0, 0],
		transform: [4, 4, 0, 0],
		normalUv: [1, 0, 0, 0],
		color: [1, 1, 1],
		albedo: [1, 1, 1],
		normalEncoding: 'rg',
		normalIntensity: 0.6,
		roughness: [0, 1],
		ao: 1,
	};

	return {
		family: 'layered-static',
		version: 1,
		mode: 'rock-projection',
		colorSource: 'local-vf-null-white',
		colorMask: false,
		requiredUv: [0],
		uvFallback: 'none',
		layers: [layer, structuredClone(layer)],
		blend: [0, 0, 0, 0],
		edge: [0, 0, 0],
		vertexChannel: [0, 0, 0, 0],
		metalness: [0, 0],
		ao: [0, 0],
		specular: 0.5,
		useOrm: 0,
		emissive: [
			[0, 0, 0],
			[0, 0, 0],
		],
		textures: Object.fromEntries(
			roles.map((role) => [
				role,
				{
					key: role,
					slice: ['D2', 'N2', 'O2'].indexOf(role),
					srgb: ['D', 'D1', 'C'].includes(role),
					mipmaps: true,
					filter: 'TF_Default',
					addressX: 'TA_Wrap',
					addressY: 'TA_Wrap',
					sampler: 'view-world-wrap',
				},
			]),
		),
		projection: {
			worldFrame: 'CUE Gltf.SwapYZ(position*0.01f)',
			rotations: [0, 0],
			control: [
				[1, 0, 0, 1],
				[1, 0, 0, 1],
			],
			desaturation: [0, 0],
			baseNormalIntensity: 1,
			mask: [2, 0, 1, 1],
			top: [12, 1, 0.5, 1],
			topColor: [1.18, 1.30048, 1.08],
			topDesaturation: 0.12,
			maskControl: [-1.204484, 0.58, 7.5, 0.25],
			orientation: [0.5, 0, 0],
			moss: 1,
			curvature: [1, 1, 0],
			curvatureColor: [1, 1, 1],
			baseColorIntensity: 1,
			topRoughness: 1,
			topAO: 1,
			rockAO: [0, 1],
			topSpecular: 0.3,
		},
	} as FurnitureLayered;
}

describe('captured LocalVF null-white rock projection', () => {
	it('separates authored COLOR and null-white programs without keying runtime uniforms', () => {
		const white = sourceConfig();
		const authored = structuredClone(white);
		authored.colorMask = true;
		delete authored.colorSource;
		const differentUniforms = structuredClone(white);
		differentUniforms.projection!.topColor = [0.5, 0.8, 0.1];
		const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
		const inputs = Object.fromEntries(Object.keys(white.textures).map((role) => [role, texture]));
		const source = new MeshStandardMaterial();
		const materials = [white, authored, differentUniforms].map(config => createLayeredMaterial(config, inputs, source));
		try {
			const shaders = materials.map(material => {
				const shader = {
					vertexShader: ShaderLib.standard.vertexShader,
					fragmentShader: ShaderLib.standard.fragmentShader,
					uniforms: {},
				} as any;
				material.onBeforeCompile(shader, {} as any);
				return shader;
			});

			expect(materials[0]!.customProgramCacheKey()).not.toBe(materials[1]!.customProgramCacheKey());
			expect(shaders[0].vertexShader).not.toContain('attribute vec4 ueLayerColor;');
			expect(shaders[1].vertexShader).toContain('attribute vec4 ueLayerColor;');
			expect(shaders[0].fragmentShader).toContain('const vec4 vLayerColor = vec4(1.0);');
			expect(shaders[1].fragmentShader).toContain('varying vec4 vLayerColor;');
			expect(materials[0]!.customProgramCacheKey()).toBe(materials[2]!.customProgramCacheKey());
			expect(shaders[0].vertexShader).toBe(shaders[2].vertexShader);
			expect(shaders[0].fragmentShader).toBe(shaders[2].fragmentShader);
			expect(shaders[0].uniforms.projectionTopColor.value).not.toEqual(shaders[2].uniforms.projectionTopColor.value);
		} finally {
			materials.forEach(material => material.dispose());
			source.dispose();
			texture.dispose();
		}
	});

	it('keeps the explicit null stream separate from authored COLOR and retains frame requirements', () => {
		const config = sourceConfig();
		expect(readFurnitureLayered(config)).not.toBeNull();

		const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
		const inputs = Object.fromEntries(Object.keys(config.textures).map((role) => [role, texture]));
		const source = new MeshStandardMaterial();
		const material = createLayeredMaterial(config, inputs, source);

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		} as any;

		material.onBeforeCompile(shader, {} as any);
		expect(shader.fragmentShader).toMatch(/const vec4 vLayerColor\s*=\s*vec4\(1(?:\.0)?\)/);
		expect(shader.vertexShader).not.toContain('attribute vec4 ueLayerColor');
		expect(shader.fragmentShader).toContain('projectionBaseMask.g * projectionMaskControl.w');
		expect(shader.fragmentShader).toContain('vLayerWorldPosition.xy * 0.00125');
		expect(material.vertexColors).toBe(false);

		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
		geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1], 3));
		geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1], 4));
		geometry.setAttribute('uv', new Float32BufferAttribute([0, 0], 2));
		expect(() => material.onBeforeRender({} as any, {} as any, {} as any, geometry, {} as any, {} as any)).toThrow(/verified native/);
		geometry.userData.ueLayerWorldFrameProof = {
			coordinateTransform: config.projection!.worldFrame,
			sourceNativeIndex: '_UE_VERTEX_INDEX',
			positionMatched: true,
			basisMatched: true,
			mismatches: 0,
		};
		geometry.userData.ueLayerNullWhiteProofs = [
			{ sourceVertexColorCount: 0, sourceVertexColorSource: 'absent' },
		];
		expect(() => material.onBeforeRender({} as any, {} as any, {} as any, geometry, {} as any, {} as any)).not.toThrow();
		expect(geometry.getAttribute('ueLayerColor')).toBeUndefined();
		material.dispose();
		source.dispose();
		texture.dispose();
		geometry.dispose();
	});

	it('does not grant null-white to other modes, missing declarations or authored colour routes', () => {
		const config = sourceConfig();
		for (const change of [
			{ mode: 'rock-home' },
			{ colorSource: 'default-white' },
			{ colorSource: undefined },
			{ colorMask: true },
		]) {
			expect(readFurnitureLayered({ ...config, ...change })).toBeNull();
		}
	});
});

describe('independent PC Top-only surface', () => {
	it('preserves the native two-sided contrast and never fills dormant macro/edge textures', () => {
		expect(rockTopLayerWeight([0.2, 0.65, 10, 0], 1)).toBe(1);
		expect(rockTopLayerWeight([0.2, 0.65, 10, 0], 0)).toBe(0);
		expect(rockTopLayerWeight([0.2, 0.65, 10, 0], 0.6)).toBeCloseTo(0.3425);
		for (const lower of [0.2, 0.18, 0.15]) {
			expect(rockTopLayerWeight([lower, 0.65, 10, 0], 1)).toBe(1);
			expect(rockTopLayerWeight([lower, 0.65, 10, 0], -1)).toBe(0);
		}

		const requested: string[] = [];
		const core = rockTopLayerCore((role, uv) => {
			requested.push(role);
			return `texture2D(layered${role}, ${uv})`;
		});
		expect(new Set(requested)).toEqual(new Set(['D', 'O', 'M', 'N', 'N1', 'N2', 'D2', 'O2']));
		expect(core).not.toContain('vLayerUv2');
		expect(core).toContain('1.0 + 2.0 * rockTopMask.z');
		expect(core).toContain('mix(rockBaseOR.r, rockTopAo, rockTopWeight)');
	});

	it('accepts only an explicit native frame and finite source controls', () => {
		const config = {
			worldFrame: 'CUE Gltf.SwapYZ(position*0.01f)',
			tiling: 1.7,
			uvSwitch: 0,
			normalIntensity: 1,
			blendNormal: 0,
			mask: [0.2, 0.65, 10, 0],
			tint: [1.03, 1.01, 1],
			desaturation: 0,
			ao: 1,
			specular: 0.5,
		};

		expect(validRockTopLayer(config)).toBe(true);
		expect(validRockTopLayer({ ...config, worldFrame: 'inferred-world-z' })).toBe(false);
		expect(validRockTopLayer({ ...config, mask: [0.2, 0.65, NaN, 0] })).toBe(false);
	});

	it('uses the shared factory without two-layer dummy samplers or fabricated colour attributes', () => {
		const config = sourceConfig();
		config.mode = 'rock-top-layer';
		delete config.projection;
		config.textures = Object.fromEntries(
			['D', 'N', 'O', 'N1', 'M', 'D2', 'N2', 'O2'].map((role) => [
				role,
				config.textures[role as LayeredRole],
			]),
		);
		config.rock = {
			mainNormalIntensity: 1,
			detailNormalUv: [1, 0, 0, 0],
			detailNormalTiling: 6,
			detailNormalIntensity: 0.65,
			macroAmount: 0,
			macroBlend: 0,
			macroTiling: 1,
			maskUv: [1, 0, 0, 0],
			maskIntensity: [0.8, 0.8, 0.8, 0.15],
			maskColor: [
				[1, 1, 1],
				[1, 1, 1],
				[1, 1, 1],
				[1, 1, 1],
			],
			maskRoughness: [1, 1, 1, 1],
			macroRoughness: 0,
			useRoughness: 0,
			useMetallic: 0,
		};
		config.rockTop = {
			worldFrame: 'CUE Gltf.SwapYZ(position*0.01f)',
			tiling: 1.7,
			uvSwitch: 0,
			normalIntensity: 1,
			blendNormal: 0,
			mask: [0.2, 0.65, 10, 0],
			tint: [1.03, 1.01, 1],
			desaturation: 0,
			ao: 1,
			specular: 0.5,
		};
		expect(readFurnitureLayered(config)).not.toBeNull();

		const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
		const inputs = Object.fromEntries(Object.keys(config.textures).map((role) => [role, texture]));
		const source = new MeshStandardMaterial();
		const material = createLayeredMaterial(config, inputs, source);

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		} as any;

		material.onBeforeCompile(shader, {} as any);
		expect(shader.fragmentShader).toContain('float rockTopWeight');
		expect(shader.fragmentShader).not.toContain('uniform sampler2D layeredC;');
		expect(shader.fragmentShader).not.toContain('uniform sampler2D layeredB;');
		expect(shader.vertexShader).not.toContain('attribute vec4 ueLayerColor');
		expect(shader.uniforms.rockTopMask.value.toArray()).toEqual([0.2, 0.65, 10, 0]);
		material.dispose();
		source.dispose();
		texture.dispose();
	});
});
