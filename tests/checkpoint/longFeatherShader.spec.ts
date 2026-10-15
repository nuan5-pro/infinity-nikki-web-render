import { describe, expect, it } from 'vitest';
import {
	BufferGeometry,
	DataTexture,
	DoubleSide,
	Float32BufferAttribute,
	MeshStandardMaterial,
	NormalBlending,
	ShaderLib,
} from 'three';
import {
	createLongFeatherMaterial,
	evaluateLongFeatherBase,
	evaluateLongFeatherMatcap,
	evaluateLongFeatherGreyCoverage,
	longFeatherCloudGate,
	longFeatherCovered,
	longFeatherNormalSigns,
	readFurnitureLongFeather,
	validateLongFeatherGeometry,
	type FurnitureLongFeather,
} from '../../src/materials/cloth/longFeatherShader.js';

function fixture(): FurnitureLongFeather {
	const u: [number, number, number, number][] = Array.from({ length: 44 }, () => [0, 0, 0, 0]);
	u[0] = [1, 1, 0, 0];
	u[1] = [0.2, 0.4, 0.6, 0];
	u[2] = [1, 1, 1, 0];
	u[3] = [0, 0.4, 0.398125, 0.352083];
	u[9] = [0.416667, 0.412194, 0.377604, 1];
	u[10] = [0.2, 0.8, 0.5, 0.5];
	u[18] = [0.45, 1, 201, -200];
	u[19] = [0.331144, 0.572374, 0.578125, 0.5];
	u[20] = [0.5, 0.5, 0.5, 0.5];
	u[21] = [0.5, 0.5, 0, 0];
	u[26] = [0, 1.02, -0.01, 0];
	u[27] = [-0.01, 2.226564, 0.890625, 3];
	u[38] = [0.351, 2, 0.2, 1];
	return {
		family: 'long-feather',
		version: 1,
		domain: 'masked-static-v2',
		cutoff: 0.3333,
		screenPhase: 0,
		twoSided: false,
		uniforms: u,
		textures: [
			'法线贴图',
			'UV2颜色贴图',
			'UV3颜色贴图',
			'UV1遮罩图',
			'UV2遮罩图',
			'金属反射MatCap',
			'LongFeatherScreenNoise',
		].map((key, i) => ({
			key,
			role: ['N', 'D', 'D1', 'B', 'M', 'C', 'S'][i]!,
			uv: [0, 1, 2, 0, 1, -1, -1][i]!,
			sRGB: i === 1 || i === 2 || i === 5,
			mipmaps: true,
			nearest: false,
			wrap: ['TA_Wrap', 'TA_Wrap'],
			encoding: i === 0 ? 'native-rg' : 'rgba',
			sampler: i === 6 ? 'texture-asset' : 'view-world-wrap',
		})),
	};
}

function greyFixture(): FurnitureLongFeather {
	const c = fixture();
	c.domain = 'grey-static-clear-v2';
	c.uvPolicy = 'native-last-channel-clamp';
	c.twoSided = true;
	c.uniforms[38]![1] = Math.fround(1.2);
	c.uniforms[41]![3] = Math.fround(0.333);
	return c;
}

describe('current native masked long-feather domain', () => {
	it('rejects runtime material terms, wrong channels, and non-masked domains', () => {
		const c = fixture();
		expect(readFurnitureLongFeather(c)).toBe(c);
		expect(readFurnitureLongFeather({ ...c, domain: 'grey-transmittance' })).toBeNull();
		c.uniforms[29]![0] = 1;
		c.uniforms[29]![1] = 1;
		expect(readFurnitureLongFeather(c)).toBeNull();
		c.uniforms[29]![0] = 0;
		c.textures[3]!.role = 'O';
		expect(readFurnitureLongFeather(c)).toBeNull();
	});

	it('accepts stripped descriptive text without relaxing the native domain', () => {
		const c = fixture();
		expect(readFurnitureLongFeather(c)).toBe(c);
		expect(readFurnitureLongFeather({ ...c, domain: 'grey-transmittance' })).toBeNull();
		expect(readFurnitureLongFeather({ ...c, screenPhase: 1 })).toBeNull();
		expect(readFurnitureLongFeather({ ...c, cutoff: 0.5 })).toBeNull();
	});

	it('validates grey-material UVs, sidedness and weather parameters', () => {
		const c = greyFixture();
		expect(readFurnitureLongFeather(c)).toBe(c);
		expect(readFurnitureLongFeather({ ...c, uvPolicy: undefined })).toBeNull();
		expect(readFurnitureLongFeather({ ...c, twoSided: false })).toBeNull();
		c.uniforms[42]![3] = -0.1;
		expect(readFurnitureLongFeather(c)).toBeNull();
		c.uniforms[42]![3] = 0;
		c.uniforms[34]![2] = 1;
		expect(readFurnitureLongFeather(c)).toBeNull();
	});

	it('retains the real red mask plus source screen-noise threshold', () => {
		const c = fixture();
		expect(longFeatherCovered(c, 0.4, 0, [0.5, 0.5])).toBe(false);
		expect(longFeatherCovered(c, 0.41666, 0, [0.5, 0.5])).toBe(true);
		expect(longFeatherCovered(c, 0.1, 0, [4.5, 0.5])).toBe(true);
		expect(longFeatherCovered(c, 0.4, 1, [0.5, 0.5])).toBe(true);
		expect(longFeatherCovered(c, 0.4, 0, [5.5, 0.5])).toBe(false);
	});

	it('keeps GreyTrans alpha distinct from the late velocity-depth threshold', () => {
		const u = fixture().uniforms;
		u[38]![1] = 1.2;
		u[41]![3] = Math.fround(0.333);

		const below = evaluateLongFeatherGreyCoverage(u, 0.2, false, 0);
		expect(below.alpha).toBeCloseTo(0.24);
		expect(below.oitEligible).toBe(true);
		expect(below.depthCovered).toBe(false);
		expect(evaluateLongFeatherGreyCoverage(u, 0.3, false, 0).depthCovered).toBe(true);
		expect(evaluateLongFeatherGreyCoverage(u, 1, false, 0).alpha).toBe(1);
		expect(evaluateLongFeatherGreyCoverage(u, 1, true, 0)).toEqual({
			alpha: 0,
			oitEligible: false,
			depthCovered: true,
		});
		expect(evaluateLongFeatherGreyCoverage(u, 0.5, false, 0.5).alpha).toBeCloseTo(0.3);
		expect(evaluateLongFeatherGreyCoverage(u, 0, false, 0).depthCovered).toBe(false);
		// Baseline 328 colour EID21378, primitive1849 at (734,365). The matching
		// velocity fragment EID21903 discards despite contributing OIT alpha.
		u[38]![1] = Math.fround(1.2);

		const native = evaluateLongFeatherGreyCoverage(u, 0.24408331513404846, false, 0);
		expect(native.alpha).toBeCloseTo(0.2928999960422516, 7);
		expect(native.oitEligible).toBe(true);
		expect(native.depthCovered).toBe(false);
		expect(Math.round((1 - native.alpha) * 255)).toBe(180);
		u[26]![0] = 1;
		expect(() => evaluateLongFeatherGreyCoverage(u, 0.5, false, 0)).toThrow(/static source domain/);
	});

	it('does not promote the captured zero cloud gate to arbitrary weather', () => {
		expect(longFeatherCloudGate(0, 0)).toBe(0);
		expect(longFeatherCloudGate(0.5, 0)).toBe(0.0625);
		expect(longFeatherCloudGate(0.5, 0.5)).toBe(0);
		expect(longFeatherCloudGate(2, 0)).toBe(1);
		expect(() => longFeatherCloudGate(NaN, 0)).toThrow(/cloud gate/);
	});

	it('uses native vertex blue for AO and distinct mask green for metallic', () => {
		const c = fixture();
		c.uniforms[36]![0] = 0.35;

		const whiteVertex = evaluateLongFeatherBase(c, [1, 1, 1], [1, 1, 1], [1, 0, 1], [1, 0.8, 0.2], 1, 0);
		const blackVertex = evaluateLongFeatherBase(c, [1, 1, 1], [1, 1, 1], [1, 0, 1], [1, 0.8, 0.2], 0, 0);
		expect(whiteVertex.ao).toBe(0.5);
		expect(blackVertex.ao).toBe(1);
		expect(blackVertex.metalness).toBeCloseTo(0.28);
		expect(blackVertex.base).toEqual([0.4, 0.398125, 0.352083]);
	});

	it('retains matcap magnitude contrast and its source metallic coefficient', () => {
		const c = fixture();
		expect(evaluateLongFeatherMatcap(c, [1, 1, 1], [0.4, 0.4, 0.4], 0, 0.5, 1, 1)).toEqual([
			0, 0, 0,
		]);

		const color = evaluateLongFeatherMatcap(c, [1, 1, 1], [0.4, 0.4, 0.4], 1, 0.5, 1, 1);
		expect(color.every((v) => Number.isFinite(v) && v > 0)).toBe(true);

		const black = evaluateLongFeatherMatcap(c, [0, 0, 0], [0.4, 0.4, 0.4], 1, 0.5, 1, 1);
		expect(black).toEqual([0, 0, 0]);
	});

	it('requires native RGBA before merge, never synthesizes missing inputs', () => {
		const geometry = new BufferGeometry();
		for (const [key, n] of [
			['position', 3],
			['normal', 3],
			['tangent', 4],
			['uv', 2],
			['uv1', 2],
			['uv2', 2],
		] as const) {
			geometry.setAttribute(key, new Float32BufferAttribute(new Float32Array(n * 3), n));
		}

		expect(() => validateLongFeatherGeometry(geometry, fixture())).toThrow(/raw RGBA/);
		geometry.setAttribute('_layer_color', new Float32BufferAttribute(new Float32Array(12).fill(0.5), 4));
		validateLongFeatherGeometry(geometry, fixture());
		expect(geometry.getAttribute('ueLongFeatherColor').getZ(0)).toBe(0.5);
		geometry.deleteAttribute('uv2');
		expect(() => validateLongFeatherGeometry(geometry, fixture())).toThrow(/source uv2/);
		geometry.dispose();
	});

	it('implements the proved LocalVF UV3 clamp before padding without losing a real UV3', () => {
		const geometry = new BufferGeometry();
		for (const [key, n] of [
			['position', 3],
			['normal', 3],
			['tangent', 4],
			['uv', 2],
			['uv1', 2],
		] as const) {
			geometry.setAttribute(key, new Float32BufferAttribute(new Float32Array(n * 3).fill(0.25), n));
		}

		geometry.setAttribute('_layer_color', new Float32BufferAttribute(new Float32Array(12).fill(0.5), 4));
		validateLongFeatherGeometry(geometry, greyFixture());
		expect(geometry.getAttribute('uv2')).toBe(geometry.getAttribute('uv1'));

		const sourceThird = new Float32BufferAttribute(new Float32Array(6).fill(0.75), 2);
		geometry.setAttribute('uv2', sourceThird);
		validateLongFeatherGeometry(geometry, greyFixture());
		expect(geometry.getAttribute('uv2')).toBe(sourceThird);
		geometry.deleteAttribute('uv1');
		expect(() => validateLongFeatherGeometry(geometry, greyFixture())).toThrow(/source uv1/);
		geometry.dispose();
	});

	it('keeps native texture slots and generated source-base mip semantics in one pass', () => {
		const c = fixture();
		const source = new MeshStandardMaterial();
		source.normalScale.set(1, -1);
		expect(longFeatherNormalSigns(source)).toEqual([1, 1]);

		const inputs = Object.fromEntries(c.textures.map((t) => [t.role, new DataTexture()]));
		const material = createLongFeatherMaterial(c, inputs, source);

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		};

		material.onBeforeCompile(shader as never, {} as never);
		expect(shader.vertexShader).toContain('vFeatherBlue=ueLongFeatherColor.b');
		expect(shader.fragmentShader).toContain('texture2D(lfD0,vFeatherUV1)');
		expect(shader.fragmentShader).toContain('texture2D(lfD1,vFeatherUV2)');
		expect(shader.fragmentShader).toContain('textureLod(lfMatcap,featherMatcapUV,featherLod)');
		expect(shader.fragmentShader).toContain('featherNoise+featherStep');
		expect(shader.fragmentShader).toContain('float roughnessFactor=0.9;');
		expect(shader.fragmentShader).toContain('float metalnessFactor=clamp(featherMask1.g*lfMaterial[36].x,0.0,1.0);');
		expect(shader.fragmentShader).not.toContain('#include <color_fragment>');
		expect(material.transparent).toBe(false);
		expect(material.depthWrite).toBe(true);
		expect(material.map?.channel).toBe(1);
		expect(material.userData.longFeather).toBe(c);
		material.dispose();
		source.dispose();
		Object.values(inputs).forEach((t) => t.dispose());
	});

	it('uses smooth native alpha in exactly one double-sided transparent draw without depth', () => {
		const c = greyFixture();
		const source = new MeshStandardMaterial();
		source.normalScale.set(1, -1);

		const inputs = Object.fromEntries(c.textures.map((t) => [t.role, new DataTexture()]));
		const material = createLongFeatherMaterial(c, inputs, source);

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		};

		material.onBeforeCompile(shader as never, {} as never);
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);
		expect(material.alphaTest).toBe(0);
		expect(material.forceSinglePass).toBe(true);
		expect(material.side).toBe(DoubleSide);
		expect(material.blending).toBe(NormalBlending);
		expect(material.premultipliedAlpha).toBe(false);
		expect(material.customProgramCacheKey()).toContain('grey_static_clear_v2_single_draw');
		expect(shader.fragmentShader).toContain('featherOpacity=clamp(featherMask0.r*lfMaterial[38].y,0.0,1.0)');
		expect(shader.fragmentShader).toContain('diffuseColor.a=featherOpacity;');
		expect(shader.fragmentShader).toContain('if(featherOpacity <= .001) discard;');
		expect(shader.fragmentShader).not.toContain('featherNoise+featherStep');
		expect(shader.fragmentShader).not.toContain(' < .3333');
		expect(shader.fragmentShader).toContain('float roughnessFactor=0.9;');
		expect(shader.fragmentShader).toContain('float metalnessFactor=clamp(');
		expect(shader.uniforms).toHaveProperty('lfNoise');
		expect(material.userData.longFeather).toBe(c);
		material.dispose();
		source.dispose();
		Object.values(inputs).forEach((t) => t.dispose());
	});
});
