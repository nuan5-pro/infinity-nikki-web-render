import { Vector3, Vector4 } from 'three';
import type { LayeredRole } from './layeredShader.js';

export interface LayeredRockTopLayer {
	worldFrame: 'CUE Gltf.SwapYZ(position*0.01f)';
	tiling: number;
	uvSwitch: number;
	normalIntensity: number;
	blendNormal: number;
	mask: [number, number, number, number];
	tint: [number, number, number];
	desaturation: number;
	ao: number;
	specular: number;
}

export function validRockTopLayer(value: unknown): value is LayeredRockTopLayer {
	if (!value || typeof value !== 'object') return false;

	const config = value as LayeredRockTopLayer;
	if (config.worldFrame !== 'CUE Gltf.SwapYZ(position*0.01f)') return false;

	for (const key of [
		'tiling',
		'uvSwitch',
		'normalIntensity',
		'blendNormal',
		'desaturation',
		'ao',
		'specular',
	] as const) {
		if (!Number.isFinite(config[key])) return false;
	}

	return (
		Array.isArray(config.mask) &&
		config.mask.length === 4 &&
		config.mask.every(Number.isFinite) &&
		Array.isArray(config.tint) &&
		config.tint.length === 3 &&
		config.tint.every(Number.isFinite)
	);
}

export const rockTopLayerUniforms = `
uniform float rockTopTiling;
uniform float rockTopUvSwitch;
uniform float rockTopNormalIntensity;
uniform float rockTopBlendNormal;
uniform vec4 rockTopMask;
uniform vec3 rockTopTint;
uniform float rockTopDesaturation;
uniform float rockTopAo;
uniform float rockTopSpecular;
vec3 rockTopDecode(vec3 value) {
  vec3 low = value * 0.077399;
  vec3 high = pow(max((value + 0.055) * 0.947867, vec3(0.0)), vec3(2.4));
  return mix(low, high, step(vec3(0.04046), value));
}`;

export function rockTopLayerValues(config: LayeredRockTopLayer) {
	return {
		rockTopTiling: { value: config.tiling },
		rockTopUvSwitch: { value: config.uvSwitch },
		rockTopNormalIntensity: { value: config.normalIntensity },
		rockTopBlendNormal: { value: config.blendNormal },
		rockTopMask: { value: new Vector4(...config.mask) },
		rockTopTint: { value: new Vector3(...config.tint) },
		rockTopDesaturation: { value: config.desaturation },
		rockTopAo: { value: config.ao },
		rockTopSpecular: { value: config.specular },
	};
}

// PC AD6746... LocalVF PS 6e27... uses a Top-only branch. The existing
// world-frame and native-absent-COLOR admission is shared with the material
// factory; this helper changes neither geometry nor texture transfer metadata.
export function rockTopLayerCore(sample: (role: LayeredRole, uv: string) => string): string {
	return `
vec2 rockBaseUV = layeredUv(layerUv[0]) * layerTransform[0].xy;
vec3 rockBaseColor = ${sample('D', 'rockBaseUV')}.rgb * layerColor[0];
vec4 rockBaseOR = ${sample('O', 'rockBaseUV')};
vec4 rockTint = ${sample('M', 'layeredUv(rockMaskUv)')} * rockMaskIntensity;
rockBaseColor = mix(rockBaseColor, rockMaskColor[0], rockTint.r);
rockBaseColor = mix(rockBaseColor, rockMaskColor[1], rockTint.g);
rockBaseColor = mix(rockBaseColor, rockMaskColor[2], rockTint.b);
rockBaseColor = mix(rockBaseColor, rockMaskColor[3], rockTint.a);

vec3 rockMainN = layeredRG(${sample('N', 'vLayerUv0')}, rockMainNormalIntensity, 1.0);
vec3 rockDetailN = layeredRG(${sample('N1', 'layeredUv(rockDetailNormalUv) * rockDetailNormalTiling')}, rockDetailNormalIntensity, 1.0);
vec3 rockInnerN = layeredRNM(rockMainN, rockDetailN);
vec3 rockSourceN = normalize(vLayerWorldNormal);
vec3 rockSourceT = normalize(vLayerWorldTangent);
vec3 rockSourceB = normalize(vLayerWorldBitangent);
// Native VS evaluates the same source RNM orientation at vertices. Reusing
// fragment samples is the declared single-pass static approximation.
vec3 rockOrientation = normalize(rockSourceN + rockSourceT * rockInnerN.x + rockSourceB * rockInnerN.y + rockSourceN * rockInnerN.z);
float rockAngle = rockOrientation.z * 0.25 + 0.5;
float rockTopWeight = mix(rockTopMask.x, rockTopMask.y, rockAngle);
// Native edge perturbation is multiplied by 4*C.r*(1-C.r). The admitted
// absent-COLOR LocalVF stream is white, so this is exactly zero, not a guess.
rockTopWeight *= vLayerColor.r;
rockTopWeight = clamp(rockTopWeight * (1.0 + 2.0 * rockTopMask.z) - rockTopMask.z, 0.0, 1.0);
vec2 rockTopUV = mix(vLayerWorldPosition.xy * 0.00125, vLayerUv0, rockTopUvSwitch) * rockTopTiling;
vec3 rockTopN = ${sample('N2', 'rockTopUV')}.rgb * 2.0 - 1.0;
rockTopN = mix(rockTopN, layeredRNM(rockSourceN, rockTopN), rockTopBlendNormal);
vec3 rockTopTangentN = vec3(dot(rockSourceT, rockTopN), dot(rockSourceB, rockTopN), dot(rockSourceN, rockTopN));
rockTopTangentN.xy *= rockTopNormalIntensity;
layeredNormal = normalize(mix(rockInnerN, rockTopTangentN, rockTopWeight));

vec3 rockTopColor = ${sample('D2', 'rockTopUV')}.rgb * rockTopTint;
rockTopColor = mix(rockTopColor, vec3(dot(rockTopColor, vec3(0.3, 0.59, 0.11))), rockTopDesaturation);
rockTopColor = rockTopDecode(rockTopColor);
diffuseColor.rgb = clamp(mix(rockBaseColor, rockTopColor, rockTopWeight), 0.0, 1.0);
float rockRoughness = rockBaseOR.g;
rockRoughness *= mix(1.0, rockMaskRoughness.r, rockTint.r);
rockRoughness *= mix(1.0, rockMaskRoughness.g, rockTint.g);
rockRoughness *= mix(1.0, rockMaskRoughness.b, rockTint.b);
rockRoughness *= mix(1.0, rockMaskRoughness.a, rockTint.a);
layeredRoughness = clamp(mix(rockRoughness, ${sample('O2', 'rockTopUV')}.g, rockTopWeight), 0.0, 1.0);
layeredMetal = clamp(rockBaseOR.b * rockUseMetallic * (1.0 - rockTopWeight), 0.0, 1.0);
// This PS uses ColorControl.a as top AO; the array R channel is not consumed.
layeredOcclusion = clamp(mix(rockBaseOR.r, rockTopAo, rockTopWeight), 0.0, 1.0);
layeredEmission = vec3(0.0);
layeredSpecularValue = mix(0.5, rockTopSpecular, rockTopWeight);`;
}

export function rockTopLayerWeight(mask: LayeredRockTopLayer['mask'], orientationZ: number): number {
	const value = mask[0] + (mask[1] - mask[0]) * (orientationZ * 0.25 + 0.5);
	return Math.max(0, Math.min(1, value * (1 + 2 * mask[2]) - mask[2]));
}
