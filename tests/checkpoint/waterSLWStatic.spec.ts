import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	DoubleSide,
	FrontSide,
	MeshStandardMaterial,
	NoColorSpace,
	RepeatWrapping,
	ShaderLib,
	Texture,
} from 'three';
import sourceConfigs from './fixtures/waterSLWStatic.json';
import {
	readWaterSLWStatic,
	waterSLWStaticShader,
	waterSLWStaticSourceNormal,
	waterSLWStaticUniforms,
	type WaterSLWStatic,
} from '../../src/materials/water/waterSLWStatic.js';
import {
	createWaterMaterial,
	readFurnitureWater,
	type FurnitureWater,
} from '../../src/materials/water/waterShader.js';

const configs = sourceConfigs.map((row) => row.config as WaterSLWStatic);

function water(slwStatic: WaterSLWStatic): FurnitureWater {
	return {
		core: 'slw-static',
		family: 'single-layer-water',
		approximation: 'captured static source fixture',
		absorption: [0.017, 0.013, 0.014],
		scattering: [0.00013, 0.0002, 0.00019],
		proxyDepth: 20,
		transmittance: 1,
		baseAlpha: 1,
		alphaBlend: 0,
		alphaPower: 1,
		alphaFresnel: [0, 1],
		tint: [1, 1, 1],
		emissive: [0, 0, 0],
		textureSRGB: [false, false, false, false],
		textureMipmaps: [false, !!slwStatic.base, true, false],
		color: [0.115245, 0.151042, 0.115245],
		baseBrightness: 1,
		basePower: 1,
		opacity: [0.2, 0.2],
		coverage: 0.2,
		metalness: 0,
		roughness: 0.05,
		f0: 0.08,
		normalStrength: 0,
		uv: [1, 1, 0, 0],
		normalUv: [1, 1, 0, 0],
		flow: [0, 0],
		normalFlow: [0, 0],
		ripple: [0, 0],
		slwStatic,
		opticalDepth: { edgeScale: 33.231506, edgePower: 0.5, waterTrans: 0.3 },
		caustics: {
			causticsProject: [0, 0, 1 / 180],
			causticsAtlas: [4, 4, 0.5, 1 / 200],
			brightness: 10,
		},
	};
}

describe('captured static SLW permutations', () => {
	it('has an explicit detail-only sampler domain and rejects partial or mismatched payloads', () => {
		for (const config of configs) expect(readWaterSLWStatic(config)).toBe(config);

		expect(readWaterSLWStatic({ ...configs[1], base: configs[0]!.base })).toBeNull();
		expect(readWaterSLWStatic({ ...configs[0], base: undefined })).toBeNull();
		expect(readWaterSLWStatic({ ...configs[1], detailSpeed: NaN })).toBeNull();

		const detail = water(configs[1]!);
		expect(readFurnitureWater(detail)).toBe(detail);

		const compact = { ...detail };
		delete compact.approximation;
		expect(readFurnitureWater(compact)).toBe(compact);
		expect(readFurnitureWater({ ...compact, slwStatic: undefined })).toBeNull();
		expect(readFurnitureWater({ ...detail, core: 'slw' })).toBeNull();
		expect(readFurnitureWater({ ...detail, slwStatic: undefined })).toBeNull();
		expect(readFurnitureWater({ ...detail, caustics: undefined })).toBeNull();
		expect(readFurnitureWater({ ...detail, opticalDepth: undefined })).toBeNull();
		expect(
			readFurnitureWater({
				...detail,
				opticalDepth: { edgeScale: 10, edgePower: -0.1, waterTrans: 1.5 },
			}),
		).not.toBeNull();
	});

	it('uses actual O/D1 and optional N, not PM_Normals or a normalMap proxy', () => {
		const texture = new Texture();
		const source = new MeshStandardMaterial({ side: DoubleSide });
		source.userData.render = { twoSided: false };
		for (const config of configs) {
			const normal = config.base ? texture : null;
			const material = createWaterMaterial(water(config), null, normal, source, texture, null, texture);

			const shader = {
				uniforms: {} as Record<string, { value: unknown }>,
				vertexShader: ShaderLib.standard.vertexShader,
				fragmentShader: ShaderLib.standard.fragmentShader,
			};

			material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], undefined as never);
			expect(material.side).toBe(FrontSide);
			expect(material.normalMap).toBeNull();
			expect(material.roughnessMap).toBeNull();
			expect(material.customProgramCacheKey()).toBe(
				`local_optics_v7_wave_false_caustics_true_furniture_water_slw_static_v1_${config.mode}_${!!normal}_true_localvf-frame-v1`,
			);

			const detail = shader.uniforms.waterSLWStaticDetailNormal!.value as Texture;
			expect(detail.colorSpace).toBe(NoColorSpace);
			expect(detail.wrapS).toBe(RepeatWrapping);
			expect(shader.uniforms.waterAnisotropy!.value).toBe(config.anisotropy);
			expect(shader.uniforms.waterNatureCausticsBrightness!.value).toBe(10);
			expect(shader.uniforms.waterSLWStaticBaseNormal !== undefined).toBe(!!config.base);
			expect(shader.vertexShader).toContain('waterSLWWorldMatrix * instanceMatrix');
			expect(shader.vertexShader).toContain('waterSLWWorldMatrix * batchingMatrix');
			expect(shader.vertexShader).toContain('cross(cross(objectNormal, tangent.xyz), objectNormal)');
			expect(shader.vertexShader).toContain('max(length(waterSLWWorldMatrix[0].xyz), 0.00001)');
			expect(shader.vertexShader).toContain('-waterSLWParity * tangent.w');
			expect(shader.fragmentShader).toContain('dot(sourceTBN[0], worldNormal)');
			expect(shader.fragmentShader).toContain('normalize(sourceTBN * tangentNormal)');
			expect(shader.fragmentShader).not.toContain('waterRayDepth');
			expect(shader.fragmentShader).toContain('waterDestination = waterVisibility * waterTransmission * waterTransmission;');
			expect(shader.fragmentShader).not.toContain('waterSLWHeight(');
			expect(shader.fragmentShader).not.toContain('waterSLWDirectional(');
			material.dispose();
		}

		expect(() => createWaterMaterial(water(configs[1]!), null, texture, source, texture, null, texture)).toThrow(/no source base/);
		expect(() => createWaterMaterial(water(configs[0]!), null, null, source, texture, null, texture)).toThrow(/actual captured/);
		texture.dispose();
		source.dispose();
	});

	it('emits only the sampled native static wave consumers', () => {
		const base = waterSLWStaticShader(configs[0]!);
		const detail = waterSLWStaticShader(configs[1]!);
		expect(base.match(/texture2D\(waterSLWStaticBaseNormal/g)).toHaveLength(2);
		expect(base.match(/texture2D\(waterSLWStaticDetailNormal/g)).toHaveLength(2);
		expect(detail.match(/texture2D\(waterSLWStaticDetailNormal/g)).toHaveLength(2);
		expect(detail).not.toContain('waterSLWStaticBase');
		expect(waterSLWStaticUniforms(configs[1]!)).not.toHaveProperty('waterSLWStaticBaseWave01');
		expect(detail).not.toMatch(/UIWS_RT|Rain|Gerstner|waterColor/);

		const calls: string[] = [];
		const result = waterSLWStaticSourceNormal(
			configs[1]!,
			[0, 0, 0],
			[0, 0, 100],
			[0, 0, 1],
			0,
			(role) => {
				calls.push(role);
				return [0.5, 0.5, 0, 1];
			},
		);
		expect(calls).toEqual(['detail', 'detail']);
		expect(result).toEqual([0, 0, 1]);
	});

	it('replays all controlled original-DWORD normals and UVs when the captured fixture is supplied', () => {
		if (!process.env.WATER_STATIC_DWORD_FIXTURE) return;

		type Sample = { role: string; uv: [number, number] };

		type Row = {
			template: string
			worldCm: [number, number, number]
			cameraCm: [number, number, number]
			toCameraUE: [number, number, number]
			seconds: number
			baseSamples: [number, number, number, number][]
			detailSamples: [number, number, number, number][]
			originalDWORDNormalBeforeInteractive: [number, number, number]
			originalDWORDSamples: Sample[]
		};

		const fixture = JSON.parse(readFileSync(process.env.WATER_STATIC_DWORD_FIXTURE, 'utf8')) as {
			staticSamples: Row[]
		};
		let normalError = 0;
		let uvError = 0;
		for (const row of fixture.staticSamples) {
			const index = sourceConfigs.findIndex((config) => config.template === row.template);
			expect(index).toBeGreaterThanOrEqual(0);

			const samples = { base: row.baseSamples, detail: row.detailSamples };
			const offsets = { base: 0, detail: 0 };
			const calls: Sample[] = [];
			const normal = waterSLWStaticSourceNormal(
				configs[index]!,
				row.worldCm,
				row.cameraCm,
				row.toCameraUE,
				row.seconds,
				(role, uv) => {
					calls.push({ role, uv });
					return samples[role][offsets[role]++]!;
				},
			);
			normalError = Math.max(normalError, ...normal.map((value, i) => Math.abs(value - row.originalDWORDNormalBeforeInteractive[i]!)));
			expect(calls).toHaveLength(row.originalDWORDSamples.length);
			uvError = Math.max(
				uvError,
				...calls.flatMap((call, i) => call.uv.map((value, axis) => Math.abs(value - row.originalDWORDSamples[i]!.uv[axis]!))),
			);
		}

		expect(fixture.staticSamples).toHaveLength(36);
		expect(normalError).toBeLessThan(3e-6);
		expect(uvError).toBeLessThan(3e-7);
		if (process.env.WATER_STATIC_REPLAY_REPORT)
			writeFileSync(process.env.WATER_STATIC_REPLAY_REPORT, JSON.stringify({ cases: 36, normalError, uvError }, null, 2));
	});
});
