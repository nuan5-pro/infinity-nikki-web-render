import {
	AdditiveBlending,
	Color,
	DoubleSide,
	FrontSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshStandardMaterial,
	NoColorSpace,
	NormalBlending,
	RepeatWrapping,
	ShaderChunk,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4,
	type Material,
	type BufferGeometry,
	type Texture,
} from 'three';
import {
	readWaterCaustics,
	readWaterCommon,
	waterCommonShader,
	waterCommonUniforms,
	waterNatureCausticsShader,
	type WaterCaustics,
	type WaterCommon,
} from './waterCommon.js';
import {
	assertWaterSLWGeometry,
	readWaterSLW,
	waterSLWShader,
	waterSLWUniforms,
	type WaterSLW,
} from './waterSLW.js';
import {
	readWaterSLWStatic,
	waterSLWStaticShader,
	waterSLWStaticUniforms,
	type WaterSLWStatic,
} from './waterSLWStatic.js';
import { waterPhaseShader, waterVolumeLights } from './waterOptics.js';
import {
	readWaterNatureWave,
	waterNatureWaveShader,
	waterNatureWaveUniforms,
	type WaterNatureWave,
} from './waterNatureWave.js';

export interface FurnitureWater {
	family: 'single-layer-water' | 'translucent-water' | 'flow-water'
	core:
		| 'default'
		| 'slw'
		| 'slw-static'
		| 'nature-pool'
		| 'slw-base-wave'
		| 'common-trans'
		| 'x6fx'
		| 'glint'
		| 'small-prop'
		| 'special-trans'
		| 'flowing-liquid'
	approximation?: string
	absorption: [number, number, number]
	scattering: [number, number, number]
	proxyDepth: number
	transmittance: number
	baseAlpha: number
	alphaBlend: number
	alphaPower: number
	alphaFresnel: [number, number]
	tint: [number, number, number]
	emissive: [number, number, number]
	textureSRGB: [boolean, boolean, boolean, boolean]
	textureMipmaps: [boolean, boolean, boolean, boolean]
	color: [number, number, number]
	baseBrightness: number
	basePower: number
	opacity: [number, number]
	coverage: number
	metalness: number
	roughness: number
	f0: number
	normalStrength: number
	uv: [number, number, number, number]
	normalUv: [number, number, number, number]
	flow: [number, number]
	normalFlow: [number, number]
	ripple: [number, number]
	opticalDepth?: { edgeScale: number; edgePower: number; waterTrans: number }
	nature?: WaterNature
	common?: WaterCommon
	caustics?: WaterCaustics
	slw?: WaterSLW
	slwStatic?: WaterSLWStatic
}

interface WaterNature {
	wave?: WaterNatureWave
	dustUv: [number, number, number, number]
	dustSpeed: [number, number]
	dustBrightness: number
	noise: [number, number, number]
	nebulaUv: [number, number, number, number]
	nebulaBrightness: number
	flowUv: [number, number, number, number]
	flow: [number, number, number, number]
	hue: number
	circle: [number, number, number, number]
	depth: [number, number, number, number]
	opacity: number
	surfaceOpacity: [number, number]
	anisotropy: number
}

export function readFurnitureWater(value: unknown): FurnitureWater | null {
	if (!value || typeof value !== 'object') return null;

	const config = value as Record<string, unknown>;
	if (!['single-layer-water', 'translucent-water', 'flow-water'].includes(String(config.family))) return null;
	if (
		![
			'default',
			'slw',
			'slw-static',
			'nature-pool',
			'slw-base-wave',
			'common-trans',
			'x6fx',
			'glint',
			'small-prop',
			'special-trans',
			'flowing-liquid',
		].includes(String(config.core))
	) return null;

	for (const key of ['textureSRGB', 'textureMipmaps']) {
		const flags = config[key];
		if (
			!Array.isArray(flags) ||
			flags.length !== 4 ||
			!flags.every((flag) => typeof flag === 'boolean')
		) return null;
	}

	for (const [key, size] of [
		['color', 3],
		['opacity', 2],
		['uv', 4],
		['normalUv', 4],
		['flow', 2],
		['normalFlow', 2],
		['ripple', 2],
		['absorption', 3],
		['scattering', 3],
		['alphaFresnel', 2],
		['tint', 3],
		['emissive', 3],
	] as const) {
		const array = config[key];
		if (
			!Array.isArray(array) ||
			array.length !== size ||
			!array.every((component) => typeof component === 'number' && Number.isFinite(component))
		) return null;
	}

	for (const key of [
		'roughness',
		'f0',
		'normalStrength',
		'baseBrightness',
		'basePower',
		'proxyDepth',
		'transmittance',
		'baseAlpha',
		'alphaBlend',
		'alphaPower',
		'coverage',
		'metalness',
	]) {
		if (typeof config[key] !== 'number' || !Number.isFinite(config[key])) return null;
	}

	if (config.opticalDepth) {
		const d = config.opticalDepth as Record<string, unknown>;
		if (
			!['edgeScale', 'edgePower', 'waterTrans'].every((key) => typeof d[key] === 'number' && Number.isFinite(d[key])) ||
			(d.edgeScale as number) <= 0 ||
			(!config.slw &&
				!config.slwStatic &&
				((d.edgePower as number) < 0 ||
					(d.waterTrans as number) < 0 ||
					(d.waterTrans as number) > 1))
		) return null;
	}

	if (config.nature) {
		if (config.core !== 'nature-pool' || typeof config.nature !== 'object') return null;

		const n = config.nature as Record<string, unknown>;
		if (n.wave !== undefined && !readWaterNatureWave(n.wave)) return null;

		for (const [key, size] of Object.entries({
			dustUv: 4,
			dustSpeed: 2,
			noise: 3,
			nebulaUv: 4,
			flowUv: 4,
			flow: 4,
			circle: 4,
			depth: 4,
			surfaceOpacity: 2,
		})) {
			if (
				!Array.isArray(n[key]) ||
				n[key].length !== size ||
				!n[key].every((v) => typeof v === 'number' && Number.isFinite(v))
			) return null;
		}

		for (const key of ['dustBrightness', 'nebulaBrightness', 'hue', 'opacity', 'anisotropy']) {
			if (typeof n[key] !== 'number' || !Number.isFinite(n[key])) return null;
		}
	}

	if (config.common && (config.core !== 'common-trans' || !readWaterCommon(config.common))) return null;
	if (
		config.caustics &&
		((config.core !== 'nature-pool' &&
			!(config.core === 'slw' && config.slw) &&
			!(config.core === 'slw-static' && config.slwStatic)) ||
			!readWaterCaustics(config.caustics))
	) return null;
	if (config.slw && (config.core !== 'slw' || !readWaterSLW(config.slw))) return null;
	if (config.slwStatic && (config.core !== 'slw-static' || !readWaterSLWStatic(config.slwStatic))) return null;
	if (
		config.core === 'slw-static' &&
		(!config.slwStatic || !config.opticalDepth || !config.caustics)
	) return null;

	return value as FurnitureWater;
}

// All water draws share one clock; updating it costs no instance traversal.
const waterTime = { value: 0 };

/** One water draw with local optical composition and ordinary instancing/picking.
 * source is optional, but passing it retains loader TBN signs and presentation.
 * D/N must be the resolved color/normal roles, not a caustics or scene lookup.
 */
export function createWaterMaterial(
	config: FurnitureWater,
	diffuse: Texture | null,
	normal: Texture | null,
	source?: Material,
	packed?: Texture | null,
	tint?: Texture | null,
	caustics?: Texture | null,
	natureNormal?: Texture | null,
): MeshStandardMaterial {
	if (config.nature && (!diffuse || !normal || !packed || !tint)) throw new Error('Nature water requires its four captured emission resources');
	if (config.common && (!normal || !packed || !tint)) throw new Error('Common water requires its captured wave and caustics resources');
	if (config.caustics && !caustics) throw new Error('Nature caustics requires its independent captured atlas');
	if (config.slw && (!normal || !packed)) throw new Error('SLW water requires both captured wave normal resources');
	if (config.slwStatic && (!packed || (config.slwStatic.base && !normal))) throw new Error('Static SLW requires its actual captured wave normal resources');
	if (config.slwStatic?.mode === 'detail' && normal) throw new Error('Detail-only SLW has no source base normal sampler');

	const natureWave = config.nature?.wave;
	if (natureWave && !natureNormal) throw new Error('Nature water requires its independent captured wave normal');

	const waveTBN = !!(config.slw || config.slwStatic || natureWave);
	const boundsSampling = !!(config.common || config.caustics);
	const worldSampling = boundsSampling || waveTBN;
	const textures = [
		diffuse,
		normal,
		packed ?? null,
		tint ?? null,
		caustics ?? null,
		natureNormal ?? null,
	].map((texture, slot) => {
		if (!texture) return null;
		// Factory-local sampling state; shared loader textures retain their own
		// transfer/filter settings and can still serve other material families.
		const owned = texture.clone();
		const srgb = slot === 5 ? false : slot === 4 ? true : config.textureSRGB[slot];
		const mipmaps = slot === 5 ? true : slot === 4 ? false : config.textureMipmaps[slot]!;
		owned.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
		owned.magFilter = LinearFilter;
		owned.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
		// The one-mip Glint Base_Tex must stay one-mip. Other native chains are
		// regenerated from exported mip zero: deliberately not original-mip parity.
		owned.generateMipmaps = mipmaps;
		if (config.nature || config.common || waveTBN) {
			owned.wrapS = RepeatWrapping;
			owned.wrapT = RepeatWrapping;
		}

		owned.needsUpdate = true;
		return owned;
	});
	const material = new MeshStandardMaterial({
		color: new Color().setRGB(...config.color),
		map: config.nature ? null : textures[0],
		normalMap: config.nature || config.common || waveTBN ? null : textures[1],
		normalScale: new Vector2(config.normalStrength, config.normalStrength),
		roughness: config.roughness,
		metalness: config.metalness,
		transparent: true,
		opacity: 1,
		depthWrite: false,
		alphaTest: 0,
		// X6FX exports straight RGB plus separate coverage. Preserve the source
		// additive destination factor instead of darkening B with ordinary alpha.
		blending:
			config.core === 'x6fx' && source?.userData.render?.blend === 'additive'
				? AdditiveBlending
				: NormalBlending,
		// Captured SLW preserves native culling even when the generic water GLB
		// transport was double-sided. Other water domains retain their own sides.
		side:
			waveTBN && typeof source?.userData.render?.twoSided === 'boolean'
				? source.userData.render.twoSided
					? DoubleSide
					: FrontSide
				: (source?.side ?? DoubleSide),
		forceSinglePass: true,
	});
	material.addEventListener('dispose', () => textures.forEach((texture) => texture?.dispose()));
	if (source) {
		material.name = source.name;
		material.userData = { ...source.userData };
		material.depthTest = source.depthTest;
		material.colorWrite = source.colorWrite;
		material.toneMapped = source.toneMapped;
		material.visible = source.visible;

		const standard = source as MeshStandardMaterial;
		if (standard.isMeshStandardMaterial) {
			// Rebuilding a dyed/plain water material must not apply the derived
			// amplitude twice. Keep the loader's original derivative/TBN convention.
			const original = standard.userData.waterNormalScale;
			const baseScale =
				Array.isArray(original) &&
				original.length === 2 &&
				original.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
					? new Vector2(original[0], original[1])
					: standard.normalScale.clone();
			material.userData.waterNormalScale = baseScale.toArray();
			material.normalScale.copy(baseScale).multiplyScalar(config.normalStrength);
			material.normalMapType = standard.normalMapType;
			material.flatShading = standard.flatShading;
		}
	}

	material.userData.water = config;

	const unlitCore = ['x6fx', 'small-prop', 'flowing-liquid'].includes(config.core);
	const opticalCore = !unlitCore && config.core !== 'default';
	const singleLayer = opticalCore && config.family === 'single-layer-water';
	const commonLit = config.core === 'common-trans';
	let sampleCore = '';
	switch (config.core) {
	case 'x6fx':
		sampleCore = `
// Captured X6FX L177-183/L205; raw R*A remains separate from RGB shaping.
vec3 waterBase = waterSample.rgb * waterBaseBrightness;
diffuseColor.rgb *= vec3(
  waterSafePow(waterBase.r, waterBasePower),
  waterSafePow(waterBase.g, waterBasePower),
  waterSafePow(waterBase.b, waterBasePower));
waterSourceAlpha = mix(waterBaseAlpha, waterSample.r * waterSample.a, waterAlphaBlend);
waterSourceAlpha = waterSafePow(waterSourceAlpha, waterAlphaPower);`;
		break;
	case 'glint':
		sampleCore = `
// Preserve the actual sampled intrinsic tint. Scene transport is composed only
// after current-view lighting is available, never from a fabricated white pixel.
diffuseColor.rgb *= waterSample.rgb;`;
		break;
	case 'flowing-liquid':
		sampleCore = `
// Proven Color RGB albedo and RGB*A*EmissiveTint term; no star/reflection mask.
diffuseColor.rgb = clamp(waterSample.rgb * diffuseColor.rgb, 0.0, 1.0)
  + waterSample.rgb * waterSample.a * waterEmissive;`;
		break;
	}

	const waterObjectCenter = { value: new Vector3() };
	const checkedSLWGeometry = new WeakSet<BufferGeometry>();
	material.onBeforeRender = (_renderer, _scene, _camera, geometry, _object, group) => {
		waterTime.value = performance.now() * 0.001;
		if (waveTBN && !checkedSLWGeometry.has(geometry)) {
			assertWaterSLWGeometry(geometry);
			checkedSLWGeometry.add(geometry);
		}

		if (!boundsSampling) return;

		const slot =
			group && 'materialIndex' in group && typeof group.materialIndex === 'number'
				? group.materialIndex
				: 0;
		const center = geometry.userData.waterObjectCenters?.[slot];
		if (
			!Array.isArray(center) ||
			center.length !== 3 ||
			!center.every((value) => typeof value === 'number' && Number.isFinite(value))
		) throw new Error('Water world sampling requires its imported component bounds');

		waterObjectCenter.value.fromArray(center);
	};
	material.onBeforeCompile = (shader) => {
		shader.uniforms.waterSceneUnits = { value: 1 };

		const depth = config.opticalDepth;
		shader.uniforms.waterDepthEdge = {
			value: new Vector2(depth?.edgeScale ?? 1, depth?.edgePower ?? 1),
		};
		shader.uniforms.waterDepthTrans = { value: depth?.waterTrans ?? config.coverage };
		shader.uniforms.waterTime = waterTime;
		shader.uniforms.waterUv = { value: new Vector4(...config.uv) };
		shader.uniforms.waterNormalUv = { value: new Vector4(...config.normalUv) };
		shader.uniforms.waterFlow = { value: new Vector2(...config.flow) };
		shader.uniforms.waterNormalFlow = { value: new Vector2(...config.normalFlow) };
		shader.uniforms.waterOpacity = { value: new Vector2(...config.opacity) };
		shader.uniforms.waterCoverageFactor = { value: config.coverage };
		shader.uniforms.waterF0 = { value: config.f0 };
		shader.uniforms.waterAnisotropy = {
			value: config.slwStatic?.anisotropy ?? config.nature?.anisotropy ?? 0,
		};
		shader.uniforms.waterBaseBrightness = { value: config.baseBrightness };
		shader.uniforms.waterBasePower = { value: config.basePower };
		shader.uniforms.waterBaseAlpha = { value: config.baseAlpha };
		shader.uniforms.waterAlphaBlend = { value: config.alphaBlend };
		shader.uniforms.waterAlphaPower = { value: config.alphaPower };
		shader.uniforms.waterAlphaFresnel = { value: new Vector2(...config.alphaFresnel) };
		shader.uniforms.waterAbsorption = { value: new Color().setRGB(...config.absorption) };
		shader.uniforms.waterScattering = { value: new Color().setRGB(...config.scattering) };
		shader.uniforms.waterProxyDepth = { value: config.proxyDepth };
		shader.uniforms.waterTransmittance = { value: config.transmittance };
		shader.uniforms.waterTint = { value: new Color().setRGB(...config.tint) };
		shader.uniforms.waterEmissive = { value: new Color().setRGB(...config.emissive) };

		const nature = config.nature;
		if (natureWave)
			Object.assign(shader.uniforms, waterNatureWaveUniforms(natureWave, textures[5]!));

		if (config.common) {
			Object.assign(shader.uniforms, waterCommonUniforms(config.common));
			shader.uniforms.waterCommonBaseNormal = { value: textures[1] };
			shader.uniforms.waterCommonDetailNormal = { value: textures[2] };
			shader.uniforms.waterCommonCausticsTex = { value: textures[3] };
		}

		if (config.slw) {
			Object.assign(shader.uniforms, waterSLWUniforms(config.slw));
			shader.uniforms.waterSLWBaseNormal = { value: textures[1] };
			shader.uniforms.waterSLWDetailNormal = { value: textures[2] };
		}

		if (config.slwStatic) {
			Object.assign(shader.uniforms, waterSLWStaticUniforms(config.slwStatic));
			if (config.slwStatic.base) shader.uniforms.waterSLWStaticBaseNormal = { value: textures[1] };
			shader.uniforms.waterSLWStaticDetailNormal = { value: textures[2] };
		}

		if (boundsSampling) shader.uniforms.waterObjectCenter = waterObjectCenter;
		if (config.caustics) {
			shader.uniforms.waterNatureCausticsTex = { value: textures[4] };
			shader.uniforms.waterNatureCausticsProject = {
				value: new Vector3(...config.caustics.causticsProject),
			};
			shader.uniforms.waterNatureCausticsAtlas = {
				value: new Vector4(...config.caustics.causticsAtlas),
			};
			shader.uniforms.waterNatureCausticsBrightness = { value: config.caustics.brightness };
		}

		if (nature) {
			for (const [name, value] of Object.entries({
				waterDust: textures[0],
				waterDustNoise: textures[1],
				waterNebula: textures[2],
				waterFlowMap: textures[3],
				waterDustUv: new Vector4(...nature.dustUv),
				waterDustSpeed: new Vector2(...nature.dustSpeed),
				waterDustBrightness: nature.dustBrightness,
				waterNoise: new Vector3(...nature.noise),
				waterNebulaUv: new Vector4(...nature.nebulaUv),
				waterNebulaBrightness: nature.nebulaBrightness,
				waterFlowUv: new Vector4(...nature.flowUv),
				waterNatureFlow: new Vector4(...nature.flow),
				waterHue: nature.hue,
				waterCircle: new Vector4(...nature.circle),
				waterDustDepth: new Vector4(...nature.depth),
				waterDustOpacity: nature.opacity,
				waterSurfaceOpacity: new Vector2(...nature.surfaceOpacity),
			}))
				shader.uniforms[name] = { value };
		}

		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
uniform float waterTime;
uniform vec4 waterUv;
uniform vec4 waterNormalUv;
uniform vec2 waterFlow;
uniform vec2 waterNormalFlow;
${
	worldSampling
		? `uniform float waterSceneUnits;
varying vec3 vWaterWorldCm;`
		: ''
}
${
	boundsSampling
		? `uniform vec3 waterObjectCenter;
varying float vWaterObjectCenterZ;`
		: ''
}
${
	waveTBN
		? `#ifndef USE_TANGENT
attribute vec4 tangent;
#endif
varying vec3 vWaterSLWTangentUE, vWaterSLWNormalUE;
varying float vWaterSLWBitangentSign;`
		: ''
}
varying vec2 vWaterUv;
varying vec2 vWaterNormalUv;`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vWaterUv = (uv + waterFlow * waterTime) * waterUv.xy + waterUv.zw;
vWaterNormalUv = (uv + waterNormalFlow * waterTime) * waterNormalUv.xy + waterNormalUv.zw;`,
			);
		if (worldSampling) {
			shader.vertexShader = shader.vertexShader.replace(
				'#include <worldpos_vertex>',
				`#include <worldpos_vertex>
vec4 waterWorldPosition = vec4(transformed, 1.0);
${boundsSampling ? 'vec4 waterCenterPosition = vec4(waterObjectCenter, 1.0);' : ''}
#ifdef USE_BATCHING
waterWorldPosition = batchingMatrix * waterWorldPosition;
${boundsSampling ? 'waterCenterPosition = batchingMatrix * waterCenterPosition;' : ''}
#endif
#ifdef USE_INSTANCING
waterWorldPosition = instanceMatrix * waterWorldPosition;
${boundsSampling ? 'waterCenterPosition = instanceMatrix * waterCenterPosition;' : ''}
#endif
waterWorldPosition = modelMatrix * waterWorldPosition;
${boundsSampling ? 'waterCenterPosition = modelMatrix * waterCenterPosition;' : ''}
// Editor world reflects source Y; it does not exchange the horizontal axes.
vWaterWorldCm = vec3(waterWorldPosition.x, -waterWorldPosition.y, waterWorldPosition.z) * waterSceneUnits;
${boundsSampling ? 'vWaterObjectCenterZ = waterCenterPosition.z * waterSceneUnits;' : ''}`,
			);
		}

		if (waveTBN) {
			shader.vertexShader = shader.vertexShader.replace(
				'#include <defaultnormal_vertex>',
				`#include <defaultnormal_vertex>
mat4 waterSLWWorldMatrix = modelMatrix;
#ifdef USE_INSTANCING
waterSLWWorldMatrix = waterSLWWorldMatrix * instanceMatrix;
#endif
#ifdef USE_BATCHING
waterSLWWorldMatrix = waterSLWWorldMatrix * batchingMatrix;
#endif
mat3 waterSLWLinear = mat3(waterSLWWorldMatrix);
// LocalVF removes each instance column's scale before transporting the basis.
// Its cross-cross repair is local, before rotation, with no VS normalization.
mat3 waterSLWRotation = mat3(
  waterSLWWorldMatrix[0].xyz / max(length(waterSLWWorldMatrix[0].xyz), 0.00001),
  waterSLWWorldMatrix[1].xyz / max(length(waterSLWWorldMatrix[1].xyz), 0.00001),
  waterSLWWorldMatrix[2].xyz / max(length(waterSLWWorldMatrix[2].xyz), 0.00001));
vec3 waterSLWLocalT = cross(cross(objectNormal, tangent.xyz), objectNormal);
vec3 waterSLWWorldN = waterSLWRotation * objectNormal;
vec3 waterSLWWorldT = waterSLWRotation * waterSLWLocalT;
// CUE SwapYZ has determinant -1 but preserves UE TangentZ.w. Baked
// geometry mirrors already changed w; apply only remaining world parity.
float waterSLWParity = sign(determinant(waterSLWLinear));
vWaterSLWTangentUE = vec3(waterSLWWorldT.x, -waterSLWWorldT.y, waterSLWWorldT.z);
vWaterSLWNormalUE = vec3(waterSLWWorldN.x, -waterSLWWorldN.y, waterSLWWorldN.z);
vWaterSLWBitangentSign = -waterSLWParity * tangent.w;`,
			);
		}

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform float waterTime;
uniform vec2 waterOpacity;
uniform vec2 waterDepthEdge;
uniform float waterSceneUnits, waterDepthTrans;
uniform float waterCoverageFactor;
uniform float waterF0;
uniform float waterAnisotropy;
uniform float waterBaseBrightness;
uniform float waterBasePower;
uniform float waterBaseAlpha;
uniform float waterAlphaBlend;
uniform float waterAlphaPower;
uniform vec2 waterAlphaFresnel;
uniform vec3 waterAbsorption;
uniform vec3 waterScattering;
uniform float waterProxyDepth;
uniform float waterTransmittance;
uniform vec3 waterTint;
uniform vec3 waterEmissive;
${worldSampling ? 'varying vec3 vWaterWorldCm;' : ''}
${boundsSampling ? 'varying float vWaterObjectCenterZ;' : ''}
${waveTBN ? 'varying vec3 vWaterSLWTangentUE, vWaterSLWNormalUE;\nvarying float vWaterSLWBitangentSign;' : ''}
${config.slw ? waterSLWShader : config.slwStatic ? waterSLWStaticShader(config.slwStatic) : natureWave ? waterNatureWaveShader : ''}
${config.common ? waterCommonShader : ''}
${config.caustics ? waterNatureCausticsShader : ''}
${
	nature
		? `uniform sampler2D waterDust, waterDustNoise, waterNebula, waterFlowMap;
uniform vec4 waterDustUv, waterNebulaUv, waterFlowUv, waterNatureFlow, waterCircle, waterDustDepth;
uniform vec2 waterDustSpeed, waterSurfaceOpacity;
uniform vec3 waterNoise;
uniform float waterDustBrightness, waterNebulaBrightness, waterHue, waterDustOpacity;`
		: ''
}
float waterSafePow(float value, float power) {
  return value > 0.0 ? pow(value, power) : 0.0;
}
${singleLayer ? waterPhaseShader : ''}
varying vec2 vWaterUv;
varying vec2 vWaterNormalUv;`,
			)
			.replace(
				'#include <map_fragment>',
				`
vec4 waterSample = vec4(1.0);
${ShaderChunk.map_fragment.split('vMapUv').join('vWaterUv').replace('diffuseColor *= sampledDiffuseColor;', 'waterSample = sampledDiffuseColor;')}
float waterSourceAlpha = 1.0;
${sampleCore}
vec3 waterRawColor = diffuseColor.rgb;`,
			)
			.replace(
				'#include <normal_fragment_begin>',
				ShaderChunk.normal_fragment_begin.split('vNormalMapUv').join('vWaterNormalUv'),
			)
			.replace(
				'#include <normal_fragment_maps>',
				ShaderChunk.normal_fragment_maps
					.split('vNormalMapUv')
					.join('vWaterNormalUv')
					.replace(
						'vec3 mapN = texture2D( normalMap, vWaterNormalUv ).xyz * 2.0 - 1.0;',
						`vec2 waterRG = texture2D(normalMap, vWaterNormalUv).rg * 2.0 - 1.0;
vec3 mapN = vec3(waterRG, sqrt(max(1.0 - dot(waterRG, waterRG), 0.0)));`,
					)
					.replace(
						'mapN.xy *= normalScale;',
						`mapN.xy *= normalScale;
${
	config.core === 'x6fx' ||
	config.core === 'flowing-liquid' ||
	config.core === 'special-trans' ||
	config.core === 'slw-base-wave'
		? `
// Named shallow-normal substitute for the omitted source multi-sample chain.
mapN.z = sqrt(max(1.0 - dot(mapN.xy, mapN.xy), 0.0));`
		: ''
}`,
					) +
					(config.common
						? `
vec3 waterCameraUE = vec3(cameraPosition.x, -cameraPosition.y, cameraPosition.z) * waterSceneUnits;
vec3 waterViewWorld = transpose(mat3(viewMatrix)) * (isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition));
vec3 waterViewUE = vec3(waterViewWorld.x, -waterViewWorld.y, waterViewWorld.z);
vec3 waterNormalUE = waterCommonWaveNormal(vWaterWorldCm, waterCameraUE, waterViewUE, waterTime);
normal = normalize(mat3(viewMatrix) * vec3(waterNormalUE.x, -waterNormalUE.y, waterNormalUE.z));
`
						: '') +
					(config.slw
						? `
vec3 waterCameraUE = vec3(cameraPosition.x, -cameraPosition.y, cameraPosition.z) * waterSceneUnits;
vec3 waterViewWorld = transpose(mat3(viewMatrix)) * (isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition));
vec3 waterViewUE = vec3(waterViewWorld.x, -waterViewWorld.y, waterViewWorld.z);
// Native PS reconstructs B after interpolation. F reflects the cross product,
// contributing a second minus to the retained pre-F bitangent sign.
mat3 waterSourceTBN = mat3(vWaterSLWTangentUE, -cross(vWaterSLWNormalUE, vWaterSLWTangentUE) * vWaterSLWBitangentSign, vWaterSLWNormalUE);
vec3 waterNormalUE = waterSLWWaveNormal(vWaterWorldCm, waterCameraUE, waterViewUE, waterSourceTBN, waterTime);
normal = normalize(mat3(viewMatrix) * vec3(waterNormalUE.x, -waterNormalUE.y, waterNormalUE.z));
`
						: config.slwStatic
							? `
vec3 waterCameraUE = vec3(cameraPosition.x, -cameraPosition.y, cameraPosition.z) * waterSceneUnits;
vec3 waterViewWorld = transpose(mat3(viewMatrix)) * (isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition));
vec3 waterViewUE = vec3(waterViewWorld.x, -waterViewWorld.y, waterViewWorld.z);
mat3 waterSourceTBN = mat3(vWaterSLWTangentUE, -cross(vWaterSLWNormalUE, vWaterSLWTangentUE) * vWaterSLWBitangentSign, vWaterSLWNormalUE);
vec3 waterNormalUE = waterSLWStaticWaveNormal(vWaterWorldCm, waterCameraUE, waterViewUE, waterSourceTBN, waterTime);
normal = normalize(mat3(viewMatrix) * vec3(waterNormalUE.x, -waterNormalUE.y, waterNormalUE.z));
`
							: natureWave
								? `
vec3 waterCameraUE = vec3(cameraPosition.x, -cameraPosition.y, cameraPosition.z) * waterSceneUnits;
mat3 waterSourceTBN = mat3(vWaterSLWTangentUE, -cross(vWaterSLWNormalUE, vWaterSLWTangentUE) * vWaterSLWBitangentSign, vWaterSLWNormalUE);
vec3 waterNormalUE = waterNatureWaveNormal(vWaterWorldCm, waterCameraUE, waterSourceTBN, waterTime);
normal = normalize(mat3(viewMatrix) * vec3(waterNormalUE.x, -waterNormalUE.y, waterNormalUE.z));
`
								: ''),
			)
			.replace(
				'#include <lights_physical_fragment>',
				`#include <lights_physical_fragment>
material.specularColor = vec3(waterF0);
material.specularColorBlended = mix(vec3(waterF0), waterRawColor, metalnessFactor);
${
	opticalCore
		? `// Evaluate irradiance independently of the intrinsic water color below.
material.diffuseColor = vec3(1.0);
material.diffuseContribution = vec3(1.0);`
		: ''
}
`,
			)
			.replace(
				'#include <lights_fragment_begin>',
				singleLayer
					? waterVolumeLights(ShaderChunk.lights_fragment_begin)
					: '#include <lights_fragment_begin>',
			)
			.replace(
				'#include <opaque_fragment>',
				`
vec3 waterView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
float waterCos = clamp(abs(dot(normal, waterView)), 0.0, 1.0);
float waterGrazing = pow(1.0 - waterCos, 5.0);
float waterCoverage = mix(waterOpacity.x, waterOpacity.y, waterGrazing);
${
	config.core === 'x6fx'
		? `
// MeshFade uses the source normal chain; view cosine is the explicit proxy.
waterSourceAlpha *= waterSafePow(
  1.0 + waterAlphaFresnel.x * (waterCos - 1.0), waterAlphaFresnel.y);`
		: ''
}
${
	opticalCore
		? `
// The material's declared local optical depth replaces unavailable scene depth.
// The actual framebuffer background is still blended exactly once by the GPU.
vec3 waterTransmission = exp(-max(waterProxyDepth, 0.0) * (waterAbsorption + waterScattering));
vec3 waterLight = max(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.0));
vec3 waterBackground = max(reflectedLight.indirectDiffuse, vec3(0.0));
float waterSourceCoverage = clamp(waterCoverageFactor, 0.0, 1.0);
vec3 waterNatureEmission = vec3(0.0);
${
	nature
		? `
// d4a941 L300-353: retain Dust RGB * noise.R, Nebula RGB and both flow phases.
// View/tangent parallax offsets and source collection day/night are explicit omissions.
vec2 waterDustCoord = vWaterUv * waterDustUv.xy + waterDustUv.zw + waterDustSpeed * waterTime;
vec3 waterDustRgb = textureLod(waterDust, waterDustCoord, 0.0).rgb * waterDustBrightness;
float waterNoiseR = texture2D(waterDustNoise, vWaterUv * waterNoise.x + waterTime * waterNoise.y).r * waterNoise.z;
waterDustRgb *= waterNoiseR;
vec3 waterNebulaRgb = texture2D(waterNebula, vWaterUv * waterNebulaUv.xy + waterNebulaUv.zw).rgb * waterNebulaBrightness;
vec3 waterHueInput = waterDustRgb + waterNebulaRgb;
vec3 waterHueAxis = vec3(0.57735026919);
vec3 waterHueAxial = waterHueAxis * dot(waterHueAxis, waterHueInput);
vec3 waterHueRgb = waterHueAxial + (waterHueInput - waterHueAxial) * cos(waterHue) + cross(waterHueAxis, waterHueInput) * sin(waterHue);
vec2 waterFlowCoord = vWaterUv * waterFlowUv.xy + waterFlowUv.zw;
vec2 waterFlowVector = (texture2D(waterFlowMap, waterFlowCoord).rg - 0.5) * 2.0 * waterNatureFlow.x * vec2(-1.0, 1.0);
float waterPhase = fract(waterTime * waterNatureFlow.y);
float waterSecondPhase = fract(waterTime * waterNatureFlow.y - 0.5);
vec3 waterFlowA = texture2D(waterNebula, waterFlowCoord + waterFlowVector * waterSecondPhase + waterNatureFlow.z).rgb;
vec3 waterFlowB = texture2D(waterNebula, waterFlowCoord + waterFlowVector * waterPhase).rgb;
vec3 waterFlowRgb = mix(waterFlowA, waterFlowB, 1.0 - abs(2.0 * waterPhase - 1.0)) * waterNatureFlow.w;
float waterCircleEdge = 1.0 - length(vWaterUv - waterCircle.xy) * waterCircle.z;
float waterCircleMask = waterSafePow(waterCircleEdge > 0.0 ? 1.0 - exp(-pow(waterCircleEdge * 2.333, 2.0)) : 0.0, waterCircle.w);
// Local surface retains the authored radial/flow mask, without an invented shore depth.
float waterDustMask = waterCircleMask;
// Surface coverage and final optical opacity are different quantities.
float waterNatureEdge = min(waterSafePow(max(waterProxyDepth, 0.0) * waterDustDepth.z, waterDustDepth.w), 1.0);
waterSourceCoverage = clamp(mix(waterSurfaceOpacity.x, waterSurfaceOpacity.y, waterNatureEdge), 0.0, 1.0);
// L412-431 multiplies the masked dust/flow term by the separate hue/nebula/flow
// term. It is NOT a diffuse alias or a constant colored-water replacement.
waterNatureEmission = max((waterDustRgb + waterFlowRgb) * (waterHueRgb + waterFlowRgb) * waterDustMask * waterDustOpacity, vec3(0.0));
`
		: ''
}
vec3 waterEmission;
vec3 waterDestination;
${
	singleLayer
		? `
float waterFresnel = waterF0 + (1.0 - waterF0) * waterGrazing;
vec3 waterScatter = clamp(waterScattering * (1.0 - waterTransmission)
  / max(waterAbsorption + waterScattering, vec3(1e-5)), 0.0, 1.0);
float waterVisibility = 1.0 - waterSourceCoverage;
waterDestination = waterVisibility * waterTransmission * waterTransmission;
vec3 waterVolumeIncoming = max(reflectedLight.indirectDiffuse, vec3(0.0)) * 0.25 + waterDirectionalScatter;
waterEmission = waterLight * waterRawColor * waterSourceCoverage * (1.0 - metalnessFactor)
  + waterVolumeIncoming * waterScatter * (1.0 - waterFresnel) * waterVisibility;`
		: `
vec3 waterBehind = waterTransmission * waterBackground;
float waterLoss = 1.0 - max(max(waterBehind.r, waterBehind.g), waterBehind.b);
float waterNativeAlpha = clamp(waterLoss * waterSourceCoverage, 0.0, 1.0);
${
	config.core === 'glint'
		? `
vec3 waterNativeRgb = clamp(mix(waterRawColor, waterBehind, waterTransmittance) * waterTint, 0.0, 1.0);
vec3 waterTransport = max(waterTransmission * waterTransmittance * waterTint, vec3(0.0));`
		: `
float waterWeight = clamp(waterLoss * waterTransmittance, 0.0, 1.0);
waterWeight *= waterWeight;
vec3 waterNativeRgb = clamp(mix(waterRawColor, waterBehind, waterWeight), 0.0, 1.0);
vec3 waterTransport = waterTransmission * waterWeight;`
}
waterTransport = min(waterTransport, waterNativeRgb / max(waterBackground, vec3(1e-6)));
vec3 waterIntrinsic = max(waterNativeRgb - waterTransport * waterBackground, vec3(0.0));
waterDestination = clamp(vec3(1.0 - waterNativeAlpha) + waterNativeAlpha * waterTransport, 0.0, 1.0);
waterEmission = waterNativeAlpha * waterLight * waterIntrinsic;`
}
// A scalar alpha cannot encode spectral transmission. Retain the nonnegative
// spectral residual against the local indirect-light response, as a local approximation.
float waterTransmissionScalar = min(min(waterDestination.r, waterDestination.g), waterDestination.b);
waterCoverage = 1.0 - waterTransmissionScalar;
vec3 waterResidual = (waterDestination - waterTransmissionScalar) * waterBackground;
vec3 waterReflection = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
${singleLayer ? '' : 'waterReflection *= waterNativeAlpha;'}
vec3 waterPremultiplied = waterEmission + waterResidual + waterReflection + waterNatureEmission;
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA) || defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)
waterPremultiplied *= vColor.rgb;
#endif
outgoingLight = waterCoverage > 0.0 ? waterPremultiplied / waterCoverage : vec3(0.0);`
		: unlitCore
			? 'outgoingLight = diffuseColor.rgb;'
			: `
// Uncaptured water has an independent finite PBR fallback, not a zero-coefficient
// optical branch. No invented background, extinction or scatter enters it.
vec3 waterDefaultReflection = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA) || defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)
waterDefaultReflection *= vColor.rgb;
#endif
outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse
  + waterDefaultReflection;`
}
diffuseColor.a = clamp(diffuseColor.a * waterCoverage * waterSourceAlpha, 0.0, 1.0);
#include <opaque_fragment>`,
			);
	};

	const sourceProgramKey = () =>
		config.slwStatic
			? `furniture_water_slw_static_v1_${config.slwStatic.mode}_${!!normal}_${!!packed}`
			: config.slw
				? `furniture_water_slw_${config.opticalDepth ? 'v3' : 'v2'}_${config.core}_${!!normal}_${!!packed}`
				: commonLit
					? `furniture_water_common_v9_${config.core}_${!!normal}_${!!config.opticalDepth}_${!!config.common}`
					: `furniture_water_v7_${config.core}_${!!normal}_${!!config.opticalDepth}_${!!config.nature}_${!!config.common}_${!!config.caustics}`;

	material.customProgramCacheKey = () =>
		`local_optics_v7_wave_${!!natureWave}_caustics_${singleLayer && !!config.caustics}_${sourceProgramKey()}${waveTBN ? '_localvf-frame-v1' : ''}`;
	return material;
}
