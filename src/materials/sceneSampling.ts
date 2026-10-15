export interface SceneEdge {
	color: [number, number, number, number];
	range: number;
	useCoatingMask: number;
}

export interface SceneDetailNormal {
	adjust: [number, number, number, number];
	mipmaps: boolean;
	srgb?: boolean;
}

const saturate = (value: number) => Math.max(0, Math.min(1, value));

export function sceneDetailUV(uv0: [number, number], uv1: [number, number], adjust: SceneDetailNormal['adjust']): [number, number] {
	return [
		(uv0[0] + (uv1[0] - uv0[0]) * adjust[0]) * adjust[1],
		(uv0[1] + (uv1[1] - uv0[1]) * adjust[0]) * adjust[2],
	];
}

export function sceneDetailNormal(
	baseRG: [number, number],
	detailRG: [number, number],
	normalIntensity: number,
	detailIntensity: number,
	maskAlpha: number,
): [number, number, number] {
	const bx = baseRG[0] * 2 - 1;
	const by = baseRG[1] * 2 - 1;
	const bz = Math.sqrt(Math.max(1 - bx * bx - by * by, 0));
	const t = [bx * normalIntensity, by * normalIntensity, bz + 1];
	const dx = detailRG[0] * 2 - 1;
	const dy = detailRG[1] * 2 - 1;
	const safeIntensity = saturate(detailIntensity);

	const u = [
		-dx * detailIntensity,
		-dy * detailIntensity,
		Math.sqrt(1 - Math.min((dx * dx + dy * dy) * safeIntensity * safeIntensity, 1)),
	];

	const dot = t.reduce((sum, value, index) => sum + value * u[index]!, 0);
	const base = [t[0]!, t[1]!, bz];
	return base.map((value, index) => value + maskAlpha * (t[index]! * dot - u[index]! * t[2]! - value)) as [number, number, number];
}

export function sceneEdgeRGB(edge: SceneEdge, normalDotView: number, maskAlpha: number): [number, number, number] {
	const base = 1 - saturate(normalDotView);
	const fresnel = base <= 0 ? 0 : Math.pow(base, edge.range);
	const mask = 1 + (maskAlpha - 1) * edge.useCoatingMask;
	return edge.color.slice(0, 3).map((value) => value * mask * fresnel) as [number, number, number];
}

export const sceneSamplingShader = /* glsl */ `
vec3 sceneSourceDetailNormal(vec2 baseRG, vec2 detailRG, float baseIntensity, float detailIntensity, float maskAlpha) {
  vec2 baseXY = baseRG * 2.0 - 1.0;
  float baseZ = sqrt(max(1.0 - dot(baseXY, baseXY), 0.0));
  vec3 t = vec3(baseXY * baseIntensity, baseZ + 1.0);
  vec2 detailXY = detailRG * 2.0 - 1.0;
  vec2 detailZXY = detailXY * clamp(detailIntensity, 0.0, 1.0);
  vec3 u = vec3(-detailXY * detailIntensity, sqrt(1.0 - min(dot(detailZXY, detailZXY), 1.0)));
  // Native c9f8/63dad L96-103 retains the RNM numerator before the ORM.a
  // lerp. Dividing by t.z or normalizing either endpoint changes that blend.
  vec3 rnm = t * dot(t, u) - u * t.z;
  return mix(vec3(t.xy, baseZ), rnm, maskAlpha);
}
vec3 sceneSourceEdgeRGB(vec3 color, float range, float useCoatingMask, float maskAlpha, float dotNV) {
  float base = 1.0 - clamp(dotNV, 0.0, 1.0);
  float fresnel = base <= 0.0 ? 0.0 : pow(base, range);
  return color * (1.0 + (maskAlpha - 1.0) * useCoatingMask) * fresnel;
}
`;
