import { describe, expect, it } from 'vitest';
import {
	BufferGeometry,
	DoubleSide,
	Float32BufferAttribute,
	FrontSide,
	Matrix3,
	Matrix4,
	MeshStandardMaterial,
	RepeatWrapping,
	ShaderLib,
	Texture,
	Vector3,
} from 'three';
import sourceSLW from './fixtures/waterSLWFountain.json';
import { applyGeometryTransform } from '../../src/furniture/geometry.js';
import {
	assertWaterSLWGeometry,
	type WaterSLW,
} from '../../src/materials/water/waterSLW.js';
import {
	createWaterMaterial,
	readFurnitureWater,
	type FurnitureWater,
} from '../../src/materials/water/waterShader.js';

const slw = sourceSLW as WaterSLW;

function config(): FurnitureWater {
	return {
		core: 'slw',
		family: 'single-layer-water',
		absorption: [0.0027, 0.0022, 0.0019],
		scattering: [0.00002, 0.00004, 0.00004],
		proxyDepth: 20,
		transmittance: 1,
		baseAlpha: 1,
		alphaBlend: 0,
		alphaPower: 1,
		alphaFresnel: [0, 1],
		tint: [1, 1, 1],
		emissive: [0, 0, 0],
		textureSRGB: [false, false, false, false],
		textureMipmaps: [false, true, true, false],
		color: [0.056901, 0.122878, 0.130208],
		baseBrightness: 1,
		basePower: 1,
		opacity: [0.04, 0.04],
		coverage: 0.016,
		metalness: 0,
		roughness: 0.04,
		f0: 0.0204,
		normalStrength: 0,
		uv: [1, 1, 0, 0],
		normalUv: [1, 1, 0, 0],
		flow: [0, 0],
		normalFlow: [0, 0],
		ripple: [0, 0],
		slw,
	};
}

function geometry() {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
	geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
	geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
	return geometry;
}

describe('production SLW integration', () => {
	it('keeps nature-pool flow visible with its radial mask, without zeroing it for missing scene depth', () => {
		const source: FurnitureWater = {
			...config(),
			core: 'nature-pool',
			slw: undefined,
			nature: {
				dustUv: [0.5, 0.5, 0.25, 0.25],
				dustSpeed: [0, 0],
				dustBrightness: 3,
				noise: [5, 0.1, 2],
				nebulaUv: [1, 1, 0.259204, 0.80936],
				nebulaBrightness: 0.2,
				flowUv: [1.5, 1.5, 0, 0],
				flow: [0.23, -0.3, 1.4, 7],
				hue: 69.115038,
				circle: [0.990118, 1.519165, 0.76923077, 1.3],
				depth: [0.000985821, 2, 0.002, 0.032769],
				opacity: 0.2,
				surfaceOpacity: [-9.885799, 0.85],
				anisotropy: 0,
			},
		};

		const texture = new Texture();
		const material = createWaterMaterial(source, texture, texture, undefined, texture, texture);

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		material.onBeforeCompile(shader as never, undefined as never);
		expect(shader.fragmentShader).toContain('float waterDustMask = waterCircleMask;');
		expect(shader.fragmentShader).toContain(
			'waterSourceCoverage = clamp(mix(waterSurfaceOpacity.x, waterSurfaceOpacity.y, waterNatureEdge), 0.0, 1.0);',
		);
		expect(shader.fragmentShader).toContain('waterCoverage = 1.0 - waterTransmissionScalar;');
		expect(shader.fragmentShader).not.toContain('waterCoverage = clamp(waterSurfaceOpacity.y');
		expect(shader.fragmentShader).toContain('(waterDustRgb + waterFlowRgb) * (waterHueRgb + waterFlowRgb) * waterDustMask * waterDustOpacity');
		expect(shader.fragmentShader).toContain('waterSecondPhase');
		expect(shader.fragmentShader).not.toMatch(/waterSceneDepth|waterHasScene/);
		expect(material.normalMap).toBeNull();
		material.dispose();
	});

	it('renders a local surface without any screen capture inputs', () => {
		const texture = new Texture();
		const material = createWaterMaterial(config(), null, texture, undefined, texture);

		const shader = {
			uniforms: {} as Record<string, { value: unknown }>,
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], undefined as never);
		expect(shader.uniforms.waterHasScene).toBeUndefined();
		expect(shader.fragmentShader).not.toMatch(/waterSceneColor|waterSceneDepth|waterHasScene/);
		expect(shader.fragmentShader).toContain('waterDestination = waterVisibility * waterTransmission * waterTransmission;');
		expect(shader.fragmentShader).toContain('waterVolumeIncoming * waterScatter * (1.0 - waterFresnel) * waterVisibility');
		expect(shader.fragmentShader).not.toContain('waterReflection *= waterNativeAlpha;');
		expect(shader.fragmentShader).toContain('waterDirectionalScatter += directLight.color * waterSchlickPhase(');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(material.visible).toBe(true);
		material.dispose();
	});

	it.each([0, 0.3, 0.8])(
		'keeps source coverage %s distinct from extinction opacity and reflection',
		(coverage) => {
			const transmission = [0.9, 0.8, 0.7];
			const background = [0.3, 0.4, 0.5];
			const light = [0.7, 0.8, 0.9];
			const raw = [0.1, 0.2, 0.3];
			const reflection = [0.02, 0.03, 0.04];
			const destination = transmission.map((value) => (1 - coverage) * value * value);
			const scalar = Math.min(...destination);
			const alpha = 1 - scalar;
			expect(alpha).toBeGreaterThan(coverage);
			for (let i = 0; i < 3; i++) {
				const body = light[i]! * raw[i]! * coverage;
				const residual = (destination[i]! - scalar) * background[i]!;
				const rgb = (body + residual + reflection[i]!) / alpha;
				// The surface contribution fades with coverage; existing specular does not
				// receive that factor (or a second Fresnel factor) in the SLW branch.
				expect(rgb * alpha + (1 - alpha) * background[i]!).toBeCloseTo(body + reflection[i]! + destination[i]! * background[i]!, 12);
				if (coverage === 0) {
					expect(body).toBe(0);
					expect(rgb * alpha - residual).toBeCloseTo(reflection[i]!, 12);
				}
			}
		},
	);

	it('validates the optional SLW domain without changing other water programs', () => {
		expect(readFurnitureWater(config())).not.toBeNull();
		expect(readFurnitureWater({ ...config(), core: 'common-trans' })).toBeNull();
		expect(() => createWaterMaterial(config(), null, new Texture(), undefined, null)).toThrow(/both captured/);

		const basic = { ...config(), slw: undefined };
		const flat = createWaterMaterial(basic, null, null);
		expect(flat.customProgramCacheKey()).toContain('furniture_water_v7_slw');
		flat.dispose();
	});

	it('routes real wave samplers into lighting rather than normalMap/ORM material fields', () => {
		const texture = new Texture();
		const material = createWaterMaterial(config(), null, texture, new MeshStandardMaterial(), texture);

		const shader = {
			uniforms: {} as Record<string, { value: unknown }>,
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], undefined as never);
		expect(material.normalMap).toBeNull();
		expect(material.roughnessMap).toBeNull();
		expect(material.customProgramCacheKey()).toBe(
			'local_optics_v7_wave_false_caustics_false_furniture_water_slw_v2_slw_true_true_localvf-frame-v1',
		);
		expect(shader.uniforms.waterSLWDetailIntensity!.value).toEqual([11, 1]);
		expect((shader.uniforms.waterSLWBaseNormal!.value as Texture).wrapS).toBe(RepeatWrapping);
		expect(shader.vertexShader).toContain('waterSLWWorldMatrix * instanceMatrix');
		expect(shader.vertexShader).toContain('waterSLWWorldMatrix * batchingMatrix');
		expect(shader.vertexShader).toContain('cross(cross(objectNormal, tangent.xyz), objectNormal)');
		expect(shader.vertexShader).toContain('max(length(waterSLWWorldMatrix[0].xyz), 0.00001)');
		expect(shader.vertexShader).not.toContain('transpose(inverse(waterSLWLinear))');
		expect(shader.vertexShader).toContain('-waterSLWParity * tangent.w');
		expect(shader.fragmentShader).toContain('-cross(vWaterSLWNormalUE, vWaterSLWTangentUE) * vWaterSLWBitangentSign');
		expect(shader.fragmentShader).not.toContain('normalize(vWaterSLWTangentUE)');
		expect(shader.fragmentShader).toContain('waterSLWWaveNormal(vWaterWorldCm, waterCameraUE, waterViewUE, waterSourceTBN, waterTime)');
		expect(shader.fragmentShader).not.toContain('waterCommonWaveNormal');
		expect(shader.vertexShader).not.toContain('waterCenterPosition');
		material.dispose();
	});

	it('refuses missing or degenerate source tangent streams instead of deriving/guessing them', () => {
		const mesh = geometry();
		expect(() => assertWaterSLWGeometry(mesh)).not.toThrow();
		mesh.deleteAttribute('tangent');
		expect(() => assertWaterSLWGeometry(mesh)).toThrow(/source tangent/);

		const invalid = geometry();
		invalid.getAttribute('tangent').setW(1, 0);
		expect(() => assertWaterSLWGeometry(invalid)).toThrow(/signed source tangent/);
		invalid.getAttribute('tangent').setW(1, 1);
		invalid.getAttribute('normal').setXYZ(1, 1, 0, 0);
		expect(() => assertWaterSLWGeometry(invalid)).toThrow(/nondegenerate/);
	});

	it('honors captured SLW culling without changing other water sides', () => {
		const source = new MeshStandardMaterial({ side: DoubleSide });
		source.userData.render = { twoSided: false };

		const texture = new Texture();
		const native = createWaterMaterial(config(), null, texture, source, texture);
		expect(native.side).toBe(FrontSide);

		const basic = createWaterMaterial({ ...config(), slw: undefined }, null, null, source);
		expect(basic.side).toBe(DoubleSide);
		source.userData.render.twoSided = true;

		const twoSided = createWaterMaterial(config(), null, texture, source, texture);
		expect(twoSided.side).toBe(DoubleSide);
		for (const material of [native, basic, twoSided, source]) material.dispose();
	});

	it('retains source admission while omitting unavailable depth transport', () => {
		const texture = new Texture();
		const source = config();
		source.opticalDepth = { edgeScale: 33.231506, edgePower: 1.748281, waterTrans: 0.3 };
		source.caustics = {
			causticsProject: [0, 0, 1 / 180],
			causticsAtlas: [4, 4, 0.5, 1 / 70],
			brightness: 15,
		};
		expect(readFurnitureWater(source)).not.toBeNull();
		expect(readFurnitureWater({ ...source, slw: undefined })).toBeNull();
		expect(readFurnitureWater({ ...source, core: 'common-trans' })).toBeNull();
		expect(readFurnitureWater({ ...source, opticalDepth: { ...source.opticalDepth, waterTrans: 1.5 } })).not.toBeNull();
		expect(
			readFurnitureWater({
				...source,
				opticalDepth: { ...source.opticalDepth, edgePower: -0.16638 },
			}),
		).not.toBeNull();

		const material = createWaterMaterial(source, null, texture, undefined, texture, undefined, texture);

		const shader = {
			uniforms: {} as Record<string, { value: unknown }>,
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
		};

		material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], undefined as never);
		expect(material.customProgramCacheKey()).toContain('local_optics_v7_wave_false_caustics_true_');
		expect(shader.fragmentShader).not.toContain('waterLocalBehind');
		expect(shader.fragmentShader).not.toContain('waterRayDepth');
		expect(shader.fragmentShader).not.toContain('waterOpticalPath');
		expect(shader.fragmentShader).toContain('waterCoverage = 1.0 - waterTransmissionScalar;');
		expect(shader.fragmentShader).not.toContain('waterCommonCausticsEmission(');
		expect(shader.uniforms.waterNatureCausticsBrightness!.value).toBe(15);
		expect(shader.uniforms.waterDepthTrans!.value).toBe(0.3);
		material.dispose();
	});

	it('retains original handedness under baked mirrors and remaining instance/model reflection', () => {
		const mesh = geometry();
		// Original native frame T=+X,N=+Z,B=+Y; CUE stores SwapYZ(T/N), w=+1.
		const mirror = new Matrix4().makeScale(-1, 1, 1);
		applyGeometryTransform(mesh, mirror);
		expect(mesh.getAttribute('tangent').getW(0)).toBe(-1);

		const instance = new Matrix4().makeRotationZ(0.4).scale(new Vector3(2, 3, 4));
		const model = new Matrix4().makeScale(1, -1, 1);
		const world = model.clone().multiply(instance);
		const rotation = new Matrix3().setFromMatrix4(world);
		for (let column = 0; column < 3; column++) {
			const offset = column * 3;
			const length = Math.max(Math.hypot(...rotation.elements.slice(offset, offset + 3)), 0.00001);
			for (let row = 0; row < 3; row++) rotation.elements[offset + row] /= length;
		}

		const localN = new Vector3().fromBufferAttribute(mesh.getAttribute('normal'), 0);
		const localT = new Vector3().fromBufferAttribute(mesh.getAttribute('tangent'), 0);
		const repairedT = new Vector3().crossVectors(new Vector3().crossVectors(localN, localT), localN);
		const n = localN.applyMatrix3(rotation);
		const t = repairedT.applyMatrix3(rotation);
		const b = new Vector3()
			.crossVectors(n, t)
			.multiplyScalar(-Math.sign(world.determinant()) * mesh.getAttribute('tangent').getW(0))
			.normalize();
		const nativeSwappedB = new Vector3(0, 0, 1).transformDirection(world.clone().multiply(mirror));
		expect(b.distanceTo(nativeSwappedB)).toBeLessThan(1e-6);
		expect(Math.abs(n.dot(t))).toBeLessThan(1e-6);
		expect(Math.abs(n.dot(b))).toBeLessThan(1e-6);
	});

	it('removes positive column scales before local cross-cross transport without normalizing its magnitudes', () => {
		const n = new Vector3(0.2, 0.3, 0.9);
		const t = new Vector3(0.7, -0.1, 0.25);
		const repaired = new Vector3().crossVectors(new Vector3().crossVectors(n, t), n);
		const rotation = new Matrix4().makeRotationZ(0.4);
		const scaled = rotation.clone().scale(new Vector3(2, 3, 4));
		const unscaled = new Matrix3().setFromMatrix4(scaled);
		for (let column = 0; column < 3; column++) {
			const offset = column * 3;
			const length = Math.max(Math.hypot(...unscaled.elements.slice(offset, offset + 3)), 0.00001);
			for (let row = 0; row < 3; row++) unscaled.elements[offset + row] /= length;
		}

		const expectedN = n.clone().applyMatrix4(rotation);
		const expectedT = repaired.clone().applyMatrix4(rotation);
		expect(n.clone().applyMatrix3(unscaled).distanceTo(expectedN)).toBeLessThan(1e-12);
		expect(repaired.clone().applyMatrix3(unscaled).distanceTo(expectedT)).toBeLessThan(1e-12);
		expect(expectedN.length()).toBeCloseTo(n.length(), 12);
		expect(expectedT.length()).toBeCloseTo(repaired.length(), 12);

		const incorrectN = n.clone().applyMatrix3(new Matrix3().getNormalMatrix(scaled)).normalize();
		expect(incorrectN.distanceTo(expectedN.clone().normalize())).toBeGreaterThan(0.1);
	});
});
