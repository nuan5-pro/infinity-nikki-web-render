import {
	AdditiveBlending,
	ClampToEdgeWrapping,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshBasicMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NearestMipmapNearestFilter,
	NoColorSpace,
	NormalBlending,
	RepeatWrapping,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4,
	type Texture,
} from 'three';

export const EFFECT_UV1_ATTRIBUTE = 'effectUv1';

interface EffectBubble {
	mode: 'simple' | 'edge' | 'simple-edge';
	color: [number, number, number];
	edgeColor: [number, number, number];
	smokeColor: [number, number, number];
	specColor: [number, number, number];
	exponents: [number, number, number];
	opacity: [number, number, number, number];
	smokeOpacity: number;
	smokeEdge: number;
	emissivePower: number;
	warpIntensity: number;
	specSize: number;
	edgeLight: [number, number, number];
	edgeRange: [number, number, number];
	saturation: number;
}

interface EffectBase {
	color: [number, number, number];
	baseUv: [number, number, number, number];
	secondUv: [number, number, number, number];
	alphaUv: [number, number, number, number];
	uvBlend: [number, number, number];
	rotation: [number, number, number];
	clamp: [number, number, number, number];
	baseChannel: [number, number, number, number];
	alphaChannel: [number, number, number, number];
	baseRefine: [number, number, number, number];
	secondControl: [number, number];
	alpha: [number, number, number, number];
	baseAdd: number;
	secondAdd: number;
	clothAlpha: number;
	noise?: EffectNoise;
}

interface EffectNoise {
	uv: [[number, number, number, number], [number, number, number, number]];
	uvBlend: number;
	offset: number;
	strength: number;
	amount: [number, number, number];
	srgb: [boolean, boolean];
	nearest: [boolean, boolean];
	wrap: [[string, string], [string, string]];
}

interface EffectGlow {
	color: [number, number, number];
	curve: [number, number, number, number];
	opacity: number;
}

export interface FurnitureEffect {
	family: 'bubble' | 'effect-base' | 'fake-glow';
	version: 1;
	textureSRGB: [boolean, boolean, boolean, boolean];
	textureNearest: [boolean, boolean, boolean, boolean];
	vertexMask: 'none';
	bubble?: EffectBubble;
	base?: EffectBase;
	glow?: EffectGlow;
}

function finiteArray(value: unknown, length: number): boolean {
	return (
		Array.isArray(value) &&
		value.length === length &&
		value.every((v) => typeof v === 'number' && Number.isFinite(v))
	);
}

export function readFurnitureEffect(value: unknown): FurnitureEffect | null {
	if (!value || typeof value !== 'object') return null;

	const e = value as Record<string, unknown>;
	if (e.version !== 1 || e.vertexMask !== 'none') return null;

	for (const key of ['textureSRGB', 'textureNearest']) {
		if (
			!Array.isArray(e[key]) ||
			e[key].length !== 4 ||
			!e[key].every((v) => typeof v === 'boolean')
		) return null;
	}

	let arrays: Record<string, number>;
	let scalars: string[];
	let core: Record<string, unknown>;
	switch (e.family) {
	case 'bubble':
		if (!e.bubble || typeof e.bubble !== 'object' || e.base || e.glow) return null;

		core = e.bubble as Record<string, unknown>;
		if (core.mode !== 'simple' && core.mode !== 'edge' && core.mode !== 'simple-edge') return null;

		arrays = {
			color: 3,
			edgeColor: 3,
			smokeColor: 3,
			specColor: 3,
			exponents: 3,
			opacity: 4,
			edgeLight: 3,
			edgeRange: 3,
		};
		scalars = [
			'smokeOpacity',
			'smokeEdge',
			'emissivePower',
			'warpIntensity',
			'specSize',
			'saturation',
		];
		break;
	case 'effect-base':
		if (!e.base || typeof e.base !== 'object' || e.bubble || e.glow) return null;

		core = e.base as Record<string, unknown>;
		arrays = {
			color: 3,
			baseUv: 4,
			secondUv: 4,
			alphaUv: 4,
			uvBlend: 3,
			rotation: 3,
			clamp: 4,
			baseChannel: 4,
			alphaChannel: 4,
			baseRefine: 4,
			secondControl: 2,
			alpha: 4,
		};
		scalars = ['baseAdd', 'secondAdd', 'clothAlpha'];
		break;
	case 'fake-glow':
		if (!e.glow || typeof e.glow !== 'object' || e.bubble || e.base) return null;

		core = e.glow as Record<string, unknown>;
		arrays = { color: 3, curve: 4 };
		scalars = ['opacity'];
		break;
	default:
		return null;
	}

	for (const [key, length] of Object.entries(arrays)) {
		if (!finiteArray(core[key], length)) return null;
	}

	for (const key of scalars) {
		if (typeof core[key] !== 'number' || !Number.isFinite(core[key])) return null;
	}

	const profile = value as FurnitureEffect;
	if (profile.bubble) {
		const b = profile.bubble;
		if (
			b.smokeEdge >= 1 ||
			b.specSize <= 0 ||
			b.emissivePower < 0 ||
			b.exponents.some((v) => v < 0)
		) return null;
		if (b.mode !== 'simple' && (b.edgeRange[0] < 0 || b.edgeRange[1] === b.edgeRange[2])) return null;
	}

	if (
		profile.base &&
		(profile.base.baseRefine[0] < 0 ||
			profile.base.alpha[1] < 0 ||
			profile.base.uvBlend.some((v) => v < 0 || v > 1))
	) return null;

	if (profile.base?.noise) {
		const n = profile.base.noise;
		if (
			!Array.isArray(n.uv) ||
			n.uv.length !== 2 ||
			!n.uv.every((uv) => finiteArray(uv, 4)) ||
			!finiteArray(n.amount, 3) ||
			![n.offset, n.strength, n.uvBlend].every(Number.isFinite) ||
			n.strength === 0 ||
			n.amount.every((value) => value === 0) ||
			n.uvBlend < 0 ||
			n.uvBlend > 1
		) return null;

		for (const values of [n.srgb, n.nearest]) {
			if (
				!Array.isArray(values) ||
				values.length !== 2 ||
				!values.every((value) => typeof value === 'boolean')
			) return null;
		}

		if (
			!Array.isArray(n.wrap) ||
			n.wrap.length !== 2 ||
			!n.wrap.every(
				(wrap) =>
					Array.isArray(wrap) &&
					wrap.length === 2 &&
					wrap.every((value) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(value)),
			)
		) return null;
	}

	if (
		profile.glow &&
		(profile.glow.curve[3] < 0 || profile.glow.opacity < 0 || profile.glow.opacity > 1)
	) return null;

	return profile;
}

/** Captured static colour/coverage, not PBR. Three core samples plus active noise,
 * one transparent pass, no screen texture, cube, dissolve or runtime particle data.
 * COLOR_0 is not colour in these source shaders and is never enabled here.
 */
export function createEffectMaterial(
	effect: FurnitureEffect,
	diffuse: Texture | null,
	second: Texture | null,
	third: Texture | null,
	noise1: Texture | null = null,
	noise2: Texture | null = null,
): MeshBasicMaterial {
	const sources = [diffuse, second, third];
	const noise = effect.base?.noise;
	if (effect.family !== 'fake-glow' && sources.some((source) => !source)) throw new Error(`Furniture ${effect.family} core requires all three captured textures`);
	if (noise && (!noise1 || !noise2)) throw new Error('Furniture EffectBase noise requires both native textures');

	const slots = [0, 2, 3];
	const textures = sources.map((source, i) => {
		if (!source) return null;

		const texture = source.clone();
		const slot = slots[i]!;
		texture.colorSpace = effect.textureSRGB[slot] ? SRGBColorSpace : NoColorSpace;
		texture.magFilter = effect.textureNearest[slot] ? NearestFilter : LinearFilter;
		texture.minFilter = effect.textureNearest[slot]
			? NearestMipmapNearestFilter
			: LinearMipmapLinearFilter;
		texture.generateMipmaps = true;
		texture.needsUpdate = true;
		return texture;
	});
	const noiseTextures = noise
		? [noise1, noise2].map((source, i) => {
			if (!source) throw new Error('Furniture EffectBase noise requires both native textures');

			const texture = source.clone();
			texture.colorSpace = noise.srgb[i] ? SRGBColorSpace : NoColorSpace;
			texture.magFilter = texture.minFilter = noise.nearest[i] ? NearestFilter : LinearFilter;

			const wrapping = (value: string) =>
				value === 'TA_Clamp'
					? ClampToEdgeWrapping
					: value === 'TA_Mirror'
						? MirroredRepeatWrapping
						: RepeatWrapping;

			texture.wrapS = wrapping(noise.wrap[i]![0]);
			texture.wrapT = wrapping(noise.wrap[i]![1]);
			// Native SampleLevel(-1) clamps to mip zero, independently of derivatives.
			texture.generateMipmaps = false;
			texture.needsUpdate = true;
			return texture;
		})
		: [];
	const material = new MeshBasicMaterial({
		map: textures[0],
		transparent: true,
		depthWrite: false,
		forceSinglePass: true,
		blending: effect.family === 'fake-glow' ? AdditiveBlending : NormalBlending,
	});
	material.userData.effect = effect;
	material.addEventListener('dispose', () => [...textures, ...noiseTextures].forEach((texture) => texture?.dispose()));

	const needsUv1 = !!effect.base?.uvBlend.some((v) => v !== 0) || (noise?.uvBlend ?? 0) !== 0;
	material.onBeforeCompile = (shader) => {
		const uniforms: Record<string, { value: unknown }> = {
			effectDiffuse: { value: textures[0] },
			effectSecond: { value: textures[1] },
			effectThird: { value: textures[2] },
		};

		let declarations = '';
		let body = '';
		if (effect.bubble) {
			const b = effect.bubble;
			for (const [key, value] of Object.entries({
				effectColor: new Vector3(...b.color),
				effectEdgeColor: new Vector3(...b.edgeColor),
				effectSmokeColor: new Vector3(...b.smokeColor),
				effectSpecColor: new Vector3(...b.specColor),
				effectExponents: new Vector3(...b.exponents),
				effectOpacity: new Vector4(...b.opacity),
				effectSmokeOpacity: b.smokeOpacity,
				effectSmokeEdge: b.smokeEdge,
				effectEmissivePower: b.emissivePower,
				effectWarpIntensity: b.warpIntensity,
				effectSpecSize: b.specSize,
				effectEdgeLight: new Vector3(...b.edgeLight),
				effectEdgeRange: new Vector3(...b.edgeRange),
				effectSaturation: b.saturation,
			}))
				uniforms[key] = { value };

			declarations = `uniform vec3 effectColor, effectEdgeColor, effectSmokeColor, effectSpecColor, effectExponents, effectEdgeLight, effectEdgeRange;
uniform vec4 effectOpacity;
uniform float effectSmokeOpacity, effectSmokeEdge, effectEmissivePower, effectWarpIntensity, effectSpecSize, effectSaturation;
vec3 effectAddSaturation(vec3 rgb, float amount) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(rgb.bg, K.wz), vec4(rgb.gb, K.xy), step(rgb.b, rgb.g));
  vec4 q = mix(vec4(p.xyw, rgb.r), vec4(rgb.r, p.yzx), step(p.x, rgb.r));
  float d = q.x - min(q.w, q.y);
  vec3 hsv = vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  hsv.y += amount;
  vec3 ramp = clamp(abs(fract(hsv.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return hsv.z * mix(vec3(1.0), ramp, hsv.y);
}`;
			body = `vec3 effectView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vEffectView);
vec3 effectNormal = normalize(vEffectNormal);
float effectFacing = clamp(dot(effectNormal, effectView), 0.0, 1.0);
float effectEdge = 1.0 - effectFacing;
float effectColorFresnel = effectEdge <= 0.0 ? 0.0 : pow(effectEdge, effectExponents.x);
float effectAlphaFresnel = effectEdge <= 0.0 ? 0.0 : pow(effectEdge, effectExponents.y);
float effectWarp = texture2D(effectThird, vEffectUv).r * effectWarpIntensity;
vec4 effectD = texture2D(effectDiffuse, vEffectUv + vec2(effectWarp));
// bca879f1 L161-164 cancels the half-texel-centre offsets to 0.5+N.xy/size,
// not 0.5+0.5*N.xy/size. UE view X/Z reverse in the frontend coordinate chain.
vec2 effectSpecUv = ${
	b.mode === 'simple'
		? 'vec2(0.5) + effectNormal.xy * vec2(0.5, -0.5) / effectSpecSize'
		: b.mode === 'simple-edge'
			? 'vec2(0.5) - effectNormal.xy / effectSpecSize'
			: 'vec2(0.5) + 0.5 * cross(effectNormal, effectView).yx'
};
vec3 effectSpec = texture2D(effectSecond, effectSpecUv).rgb;
float effectSmoke = smoothstep(effectSmokeEdge, 1.0, effectFacing);
vec3 effectRgb = effectD.rgb * (effectD.a <= 0.0 ? 0.0 : pow(effectD.a, effectEmissivePower)) * mix(effectColor, effectEdgeColor, effectColorFresnel);
effectRgb += effectSpec * effectSpecColor + effectSmoke * (1.0 - effectD.a) * effectSmokeColor;
${
	b.mode !== 'simple'
		? `float effectLightFresnel = 0.04 + 0.96 * pow(max(abs(effectEdge), 0.0001), effectEdgeRange.x);
float effectLight = clamp((effectLightFresnel - effectEdgeRange.y) / (effectEdgeRange.z - effectEdgeRange.y), 0.0, 1.0);
effectRgb += effectLight * effectLight * (3.0 - 2.0 * effectLight) * effectEdgeLight;
${b.mode === 'edge' ? 'effectRgb = effectAddSaturation(effectRgb, effectSaturation);' : ''}`
		: ''
}
diffuseColor.rgb *= max(effectRgb, vec3(0.0));
diffuseColor.a *= clamp(effectD.a * effectOpacity.z + effectSmoke * effectSmokeOpacity +
  mix(effectOpacity.x, effectOpacity.y, effectAlphaFresnel) + effectSpec.r * effectOpacity.w, 0.0, 1.0);`;
		} else if (effect.base) {
			const b = effect.base;
			for (const [key, value] of Object.entries({
				effectColor: new Vector3(...b.color),
				effectBaseUv: new Vector4(...b.baseUv),
				effectSecondUv: new Vector4(...b.secondUv),
				effectAlphaUv: new Vector4(...b.alphaUv),
				effectUvBlend: new Vector3(...b.uvBlend),
				effectRotation: new Vector3(...b.rotation),
				effectClamp: new Vector4(...b.clamp),
				effectBaseChannel: new Vector4(...b.baseChannel),
				effectAlphaChannel: new Vector4(...b.alphaChannel),
				effectRefine: new Vector4(...b.baseRefine),
				effectSecondControl: new Vector2(...b.secondControl),
				effectAlpha: new Vector4(...b.alpha),
				effectBaseAdd: b.baseAdd,
				effectSecondAdd: b.secondAdd,
				effectClothAlpha: b.clothAlpha,
			}))
				uniforms[key] = { value };

			declarations = `uniform vec3 effectColor, effectUvBlend, effectRotation;
uniform vec4 effectBaseUv, effectSecondUv, effectAlphaUv, effectClamp, effectBaseChannel, effectAlphaChannel, effectRefine, effectAlpha;
uniform vec2 effectSecondControl;
uniform float effectBaseAdd, effectSecondAdd, effectClothAlpha;
vec2 effectUv(vec2 uv, vec4 transform, float rotation) {
  vec2 p = uv * transform.xy - 0.5;
  float c = cos(rotation), s = sin(rotation);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5 + transform.zw;
}
vec2 effectClampUv(vec2 uv, float strength, float both) {
  vec2 limited = mix(vec2(uv.x, clamp(uv.y, 0.0, 1.0)), clamp(uv, 0.0, 1.0), both);
  return mix(uv, limited, strength);
}`;

			let noiseBody = '';
			if (noise) {
				Object.assign(uniforms, {
					effectNoise1: { value: noiseTextures[0] },
					effectNoise2: { value: noiseTextures[1] },
					effectNoiseUv1: { value: new Vector4(...noise.uv[0]) },
					effectNoiseUv2: { value: new Vector4(...noise.uv[1]) },
					effectNoiseUvBlend: { value: noise.uvBlend },
					effectNoiseOffset: { value: noise.offset },
					effectNoiseStrength: { value: noise.strength },
					effectNoiseAmount: { value: new Vector3(...noise.amount) },
				});
				declarations +=
					'\nuniform sampler2D effectNoise1, effectNoise2;\nuniform vec4 effectNoiseUv1, effectNoiseUv2;\nuniform vec3 effectNoiseAmount;\nuniform float effectNoiseUvBlend, effectNoiseOffset, effectNoiseStrength;';
				noiseBody = `vec2 effectNuv1 = mix(vEffectUv, vEffectUv1, effectNoiseUvBlend) * effectNoiseUv1.xy + effectNoiseUv1.zw;
vec2 effectNuv2 = vEffectUv * effectNoiseUv2.xy + effectNoiseUv2.zw;
float effectNoise = ((texture2D(effectNoise1, effectNuv1).r + effectNoiseOffset) +
  (texture2D(effectNoise2, effectNuv2).r + effectNoiseOffset)) * effectNoiseStrength;`;
			}

			body = `${noiseBody}
vec2 effectBuv = effectClampUv(effectUv(mix(vEffectUv, vEffectUv1, effectUvBlend.x), effectBaseUv, effectRotation.x)${noise ? ' + vec2(effectNoise * effectNoiseAmount.x)' : ''}, effectClamp.x, effectClamp.y);
vec4 effectB = texture2D(effectDiffuse, effectBuv);
float effectBaseMask = clamp(dot(effectB, effectBaseChannel), 0.0, 1.0);
vec3 effectRefined = vec3(effectB.r <= 0.0 ? 0.0 : pow(effectB.r, effectRefine.x),
  effectB.g <= 0.0 ? 0.0 : pow(effectB.g, effectRefine.x),
  effectB.b <= 0.0 ? 0.0 : pow(effectB.b, effectRefine.x)) * effectRefine.y;
vec3 effectRgb = (mix(effectRefined, effectB.rgb * effectRefine.z, effectRefine.w) + effectBaseAdd) * effectColor;
vec3 effectS = texture2D(effectSecond, effectUv(mix(vEffectUv, vEffectUv1, effectUvBlend.y), effectSecondUv, effectRotation.y)${noise ? ' + vec2(effectNoise * effectNoiseAmount.y)' : ''}).rgb;
float effectGrey = dot(effectS, vec3(0.3, 0.59, 0.11));
effectRgb *= mix(effectS, vec3(effectGrey), effectSecondControl.x) * effectSecondControl.y + effectSecondAdd;
vec2 effectAuv = effectClampUv(effectUv(mix(vEffectUv, vEffectUv1, effectUvBlend.z), effectAlphaUv, effectRotation.z)${noise ? ' + vec2(effectNoise * effectNoiseAmount.z)' : ''}, effectClamp.z, effectClamp.w);
float effectA = clamp(dot(texture2D(effectThird, effectAuv), effectAlphaChannel), 0.0, 1.0);
effectA = effectA <= 0.0 ? 0.0 : pow(effectA, effectAlpha.y) * effectAlpha.z;
diffuseColor.rgb *= max(effectRgb, vec3(0.0));
diffuseColor.a *= clamp(effectBaseMask * effectAlpha.x * mix(1.0, effectA, effectAlpha.w) * effectClothAlpha, 0.0, 1.0);`;
		} else if (effect.glow) {
			const g = effect.glow;
			uniforms.effectGlowColor = { value: new Vector3(...g.color) };
			uniforms.effectGlowCurve = { value: new Vector4(...g.curve) };
			uniforms.effectGlowOpacity = { value: g.opacity };
			declarations = 'uniform vec3 effectGlowColor; uniform vec4 effectGlowCurve; uniform float effectGlowOpacity;';
			body = `float effectRadius = length(2.0 * (vEffectUv - 0.5));
float effectCurve = effectGlowCurve.x * effectRadius + effectGlowCurve.z * effectRadius * effectRadius +
  effectGlowCurve.y * effectRadius * effectRadius * effectRadius;
diffuseColor.rgb *= max(effectGlowColor * exp2(-1.438293 * effectCurve * effectGlowCurve.w), vec3(0.0));
diffuseColor.a *= effectGlowOpacity;`;
		}

		Object.assign(shader.uniforms, uniforms);

		const varyings = `varying vec2 vEffectUv, vEffectUv1;
varying vec3 vEffectNormal, vEffectView;`;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
${varyings}
${needsUv1 ? `attribute vec2 ${EFFECT_UV1_ATTRIBUTE};` : ''}`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
#if !defined(USE_ENVMAP) && !defined(USE_SKINNING)
#include <beginnormal_vertex>
#include <defaultnormal_vertex>
#endif
vEffectNormal = transformedNormal;
vEffectUv = uv;
vEffectUv1 = ${needsUv1 ? EFFECT_UV1_ATTRIBUTE : 'uv'};`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
vEffectView = -mvPosition.xyz;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
${varyings}
uniform sampler2D effectDiffuse, effectSecond, effectThird;
${declarations}`,
			)
			.replace('#include <map_fragment>', body)
			.replace('#include <alphamap_fragment>', '');
		// Stock color_fragment remains AFTER the source core: only instance colour,
		// picking/highlight adapters consume it, never the source COLOR_0 masks.
	};
	material.customProgramCacheKey = () => `furniture_effect_v1_${effect.family}_${effect.bubble?.mode ?? ''}_${needsUv1}_${!!noise}`;
	return material;
}
