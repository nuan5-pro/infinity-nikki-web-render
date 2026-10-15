import type { FurnitureLayered, LayeredRole } from './layeredShader.js';

export interface LayeredRockHome {
	worldFrame: 'CUE Gltf.SwapYZ(position*0.01f)';
	baseTiling: number;
	baseColorTiling: number;
	baseNormalIntensity: number;
	detailScale: number;
	triplanarBlend: number;
	detailIntensity: number;
	topTiling: number;
	topNormalIntensity: number;
	topColor: [number, number, number];
	topSpecular: number;
}

export function validLayeredRockHome(config: FurnitureLayered): boolean {
	const p = config.rockHome;
	if (
		!p ||
		p.worldFrame !== 'CUE Gltf.SwapYZ(position*0.01f)' ||
		config.requiredUv.length !== 1 ||
		config.requiredUv[0] !== 0
	) return false;

	for (const key of [
		'baseTiling',
		'baseColorTiling',
		'baseNormalIntensity',
		'detailScale',
		'triplanarBlend',
		'detailIntensity',
		'topTiling',
		'topNormalIntensity',
		'topSpecular',
	] as const) {
		if (!Number.isFinite(p[key])) return false;
	}

	if (
		p.detailScale >= 0 ||
		!Array.isArray(p.topColor) ||
		p.topColor.length !== 3 ||
		!p.topColor.every(Number.isFinite)
	) return false;

	for (const [role, slice] of [
		['D', -1],
		['N', -1],
		['O', -1],
		['N1', -1],
		['D2', 0],
		['N2', 1],
		['O2', 2],
	] as const) {
		const texture = config.textures[role];
		if (
			!texture ||
			texture.slice !== slice ||
			texture.srgb !== (role === 'D') ||
			texture.constant !== undefined ||
			texture.sampler !== (role === 'D' ? 'texture-asset' : 'view-world-wrap')
		) return false;
	}

	return true;
}

export const rockHomeUniforms = `
uniform float homeBaseTiling;
uniform float homeBaseColorTiling;
uniform float homeBaseNormalIntensity;
uniform float homeDetailScale;
uniform float homeTriplanarBlend;
uniform float homeDetailIntensity;
uniform float homeTopTiling;
uniform float homeTopNormalIntensity;
uniform vec3 homeTopColor;
uniform float homeTopSpecular;
// PS safe-normalize keeps both the >=1e-6 and abs(delta)>1e-5 predicates.
vec3 homeSafeUnit(vec3 value) {
  float squareLength = dot(value, value);
  if (squareLength < 0.000001 || abs(squareLength - 0.000001) <= 0.00001) return vec3(0.0);
  return value * inversesqrt(squareLength);
}
vec3 homeArrayLinear(vec3 value) {
  vec3 low = value * 0.077399;
  vec3 high = pow(max((value + 0.055) * 0.947867, vec3(0.0)), vec3(2.4));
  bvec3 useHigh = greaterThanEqual(value, vec3(0.04045));
  bvec3 outsideEpsilon = greaterThan(abs(value - 0.04045), vec3(0.00001));
  return vec3(useHigh.x && outsideEpsilon.x ? high.x : low.x,
    useHigh.y && outsideEpsilon.y ? high.y : low.y,
    useHigh.z && outsideEpsilon.z ? high.z : low.z);
}`;

// PS65c02636 instructions 71-242: actual s0 detail/array and s2 base diffuse;
// the already-selected array slices are supplied by the existing texture path.
export function rockHomeCore(sample: (role: LayeredRole, uv: string) => string): string {
	return `
vec3 homeN = normalize(vLayerWorldNormal);
vec3 homeT = vLayerWorldTangent;
vec3 homeB = cross(vLayerWorldNormal, homeT) * vLayerNativeHandedness;
vec3 homePosition = vLayerWorldPosition.xzy * homeDetailScale;
vec3 homeSign = vec3(vLayerWorldNormal.z >= 0.0 ? 1.0 : -1.0, vLayerWorldNormal.y >= 0.0 ? -1.0 : 1.0, vLayerWorldNormal.x >= 0.0 ? 1.0 : -1.0);
vec3 homeDetailA = layeredRG(${sample('N1', 'homePosition.xy')}, 1.0, 1.0) * vec3(homeSign.y, -1.0, 1.0);
vec3 homeDetailB = layeredRG(${sample('N1', 'homePosition.zy')}, 1.0, 1.0) * vec3(homeSign.z, -1.0, 1.0);
float homeWeightX = clamp((1.0 + 2.0 * homeTriplanarBlend) * abs(vLayerWorldNormal.x) - homeTriplanarBlend, 0.0, 1.0);
vec3 homeDetailAB = mix(homeDetailA, homeDetailB, homeWeightX);
vec3 homeAxisA = homeSafeUnit(vec3(homeN.y, -homeN.x, 0.0));
vec3 homeAxisB = homeSafeUnit(vec3(-homeN.z * homeN.x, -homeN.z * homeN.y, homeN.y * homeN.y + homeN.x * homeN.x));
vec3 homeWorldAB = homeAxisA * homeDetailAB.x + homeAxisB * homeDetailAB.y + homeN * homeDetailAB.z;
vec3 homeDetailC = layeredRG(${sample('N1', 'homePosition.xz')}, 1.0, 1.0) * vec3(homeSign.x, -1.0, 1.0);
vec3 homeAxisC = homeSafeUnit(vec3(-homeN.z, 0.0, homeN.x));
vec3 homeAxisD = homeSafeUnit(vec3(-homeN.y * homeN.x, homeN.x * homeN.x + homeN.z * homeN.z, -homeN.y * homeN.z));
vec3 homeWorldC = homeAxisC * homeDetailC.x + homeAxisD * homeDetailC.y + homeN * homeDetailC.z;
float homeWeightZ = clamp((1.0 + 2.0 * homeTriplanarBlend) * abs(vLayerWorldNormal.z) - homeTriplanarBlend, 0.0, 1.0);
vec3 homeDetailWorld = mix(homeWorldAB, homeWorldC, homeWeightZ);
vec3 homeDetailTangent = vec3(dot(homeT, homeDetailWorld), dot(homeB, homeDetailWorld), dot(vLayerWorldNormal, homeDetailWorld));
homeDetailTangent.xy *= homeDetailIntensity;
vec3 homeBaseN = layeredRG(${sample('N', 'vLayerUv0 * homeBaseTiling')}, homeBaseNormalIntensity, 1.0);
vec3 homeInnerN = layeredRNM(homeBaseN, homeDetailTangent);
vec2 homeTopUV = vLayerUv0 * homeTopTiling;
vec3 homeTopN = ${sample('N2', 'homeTopUV')}.rgb * 2.0 - 1.0;
homeTopN.xy *= homeTopNormalIntensity;
float homeTopWeight = vLayerColor.r;
layeredNormal = normalize(mix(homeInnerN, homeTopN, homeTopWeight));
vec3 homeBaseColor = ${sample('D', 'vLayerUv0 * homeBaseColorTiling')}.rgb;
vec3 homeDecodedTop = homeArrayLinear(${sample('D2', 'homeTopUV')}.rgb * homeTopColor);
diffuseColor.rgb = clamp(mix(homeBaseColor, homeDecodedTop, homeTopWeight), 0.0, 1.0);
vec2 homeBaseOR = ${sample('O', 'vLayerUv0 * homeBaseTiling')}.rg;
vec2 homeTopOR = ${sample('O2', 'homeTopUV')}.rg;
layeredOcclusion = clamp(mix(homeBaseOR.r, homeTopOR.r, homeTopWeight), 0.0, 1.0);
layeredRoughness = clamp(mix(homeBaseOR.g, homeTopOR.g, homeTopWeight), 0.0, 1.0);
layeredMetal = 0.0;
layeredEmission = vec3(0.0);
layeredSpecularValue = clamp(0.5 + homeTopWeight * (homeTopSpecular - 0.5), 0.0, 1.0);`;
}
