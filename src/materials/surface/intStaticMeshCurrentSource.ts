import type { CharacterJewelVec3 as Vec3, CharacterJewelVec4 as Vec4 } from '../jewel/characterJewelSource.js';

const rgb = (fn: (i: 0 | 1 | 2) => number): Vec3 => [fn(0), fn(1), fn(2)];
const saturate = (v: number) => Math.min(1, Math.max(0, v));
const positivePower = (v: number, e: number) => (v <= 0 ? 0 : v ** e);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function intStaticMeshCurrentMatcapUV(view: Vec3, normal: Vec3): readonly [number, number] {
	return [
		(view[0] * normal[2] - view[2] * normal[0]) * 0.5 + 0.5,
		(view[2] * normal[1] - view[1] * normal[2]) * 0.5 + 0.5,
	];
}

export function intStaticMeshCurrentPatternAttributes(
	base: readonly [number, number],
	pattern: Vec3,
	metalChannelMix: number,
	coverage: number,
): readonly [number, number] {
	const metal = pattern[0] + (pattern[2] - pattern[0]) * metalChannelMix;
	return [base[0] + (metal - base[0]) * coverage, base[1] + (pattern[1] - base[1]) * coverage];
}

export function intStaticMeshCurrentGlintShape(phase: number, width: number): number {
	const denominator = phase * phase * (width - 1) + 1;
	return (width / (denominator * denominator * 3.142)) ** 4;
}

export function intStaticMeshCurrentGlintEdge(ndotv: number, scale: number): number {
	return saturate((1 - ndotv) ** 4 * scale);
}

export function intStaticMeshCurrentSurface(input: {
	uniforms: readonly Vec4[];
	attribute: Vec4;
	emissive: Vec4;
	albedo: Vec3;
	matcap: Vec3;
	cube: Vec3;
	normal: Vec3;
	view: Vec3;
	primaryDirection: Vec3;
	primaryColor: Vec3;
	ready: number;
	limitedDirection: Vec3;
	sunColor: Vec3;
	preExposure: number;
}): {
	baseColor: Vec3;
	emission: Vec3;
	metalness: number;
	roughness: number;
	specular: number;
	ao: number;
} {
	const m = input.uniforms;
	if (
		(m.length !== 12 && m.length !== 14) ||
		!m.every((r) => r.length === 4 && r.every(Number.isFinite))
	) throw new Error('[IntStaticMesh] actual12/14-row base ABI required');

	const ndotv = dot(input.normal, input.view);
	const facing = Math.max(ndotv, 0);
	const edge = Math.max(Math.abs(1 - facing), 0.0001);
	const edgeScale = (1 + (input.attribute[3] - 1) * m[2]![0]) * positivePower(1 - Math.min(facing, 1), m[3]![0]);
	const edgeColor = rgb((i) => edgeScale * m[2]![i + 1]!);
	let coating = positivePower(edge, m[4]![3]) * m[5]![0] + m[5]![1];
	coating += (1 - 2 * coating) * m[5]![2];

	const coatColor = rgb((i) => coating * m[6]![i] * input.cube[i] * input.attribute[3]);
	const color = rgb((i) => input.albedo[i] * m[9]![i]);
	let emission = rgb(
		(i) =>
			input.emissive[i] * input.emissive[3] * m[4]![i] +
			edgeColor[i] * m[3]![1] +
			coatColor[i] * Math.max(m[6]![3], 1) * m[7]![0],
	);
	const select = Math.abs(input.ready) > 0.00001 && input.ready >= 0;
	const light = select ? input.sunColor : input.primaryColor;
	const dir = select ? input.limitedDirection : input.primaryDirection;
	const lightLuma =
		Math.max(light[0], 0.12) * 0.3 +
		Math.max(light[1], 0.12) * 0.59 +
		Math.max(light[2], 0.12) * 0.11;
	const lit = rgb(
		(i) =>
			Math.min(1, Math.max(0.1, Math.max(light[i], 0.12) * 0.65 + lightLuma * 0.35)) *
			Math.max(dot(input.normal, dir), m[7]![1]),
	);
	emission = rgb((i) => emission[i] * (1 + (lit[i] - 1) * m[7]![2]));
	if (input.preExposure > 1)
		emission = rgb((i) => emission[i] / Math.max(0.1, 1 + (input.preExposure - 1) * m[7]![3]));

	emission = rgb((i) => Math.max(emission[i] + (m[8]![i + 1]! - emission[i]) * m[8]![0], 0));
	if (m.length === 12) return {
		baseColor: rgb((i) => saturate(color[i] + edgeColor[i] + coatColor[i])),
		emission,
		metalness: saturate(m[10]![0] + (m[9]![3] - m[10]![0]) * input.attribute[0]),
		roughness: saturate(1 - (m[10]![2] + (m[10]![1] - m[10]![2]) * input.attribute[1])),
		specular: saturate(m[10]![3]),
		ao: saturate(m[11]![0]),
	};

	const matcap = rgb((i) => input.matcap[i] * (m[10]![i] + (m[11]![i] - m[10]![i]) * saturate(dot(input.normal, dir))));
	const baseColor = rgb((i) => {
		const cap = color[i] + matcap[i] + (color[i] * matcap[i] - color[i] - matcap[i]) * m[11]![3];
		return saturate(color[i] + (cap - color[i]) * m[12]![0] + edgeColor[i] + coatColor[i]);
	});
	return {
		baseColor,
		emission,
		metalness: saturate(m[12]![2] + (m[12]![1] - m[12]![2]) * input.attribute[0]),
		roughness: saturate(1 - (m[13]![0] + (m[12]![3] - m[13]![0]) * input.attribute[1])),
		specular: saturate(m[13]![1]),
		ao: saturate(m[13]![2]),
	};
}

export const intStaticMeshCurrentMath = /* glsl */ `
float intStaticGlintShape(float phase,float width){
  float denominator=phase*phase*(width-1.0)+1.0;
  float shape=width/(denominator*denominator*3.142);shape*=shape;return shape*shape;
}
float intStaticGlintEdge(float ndotv,float scale){float x=1.0-ndotv;x*=x;return clamp(x*x*scale,0.0,1.0);}
vec3 intStaticPositivePow(vec3 c,float e) {
  return vec3(c.x<=0.0?0.0:exp2(log2(c.x)*e),c.y<=0.0?0.0:exp2(log2(c.y)*e),c.z<=0.0?0.0:exp2(log2(c.z)*e));
}
vec2 intStaticMatcapUV(vec3 view,vec3 normal) {
  return vec2(view.x*normal.z-view.z*normal.x,view.z*normal.y-view.y*normal.z)*.5+.5;
}
vec3 intStaticRNM(vec2 baseRG,vec2 detailRG,vec4 m0,vec4 m1) {
  vec2 base=baseRG*2.0-1.0,detail=detailRG*2.0-1.0;
  vec3 a=vec3(base*m0.y,sqrt(max(1.0-dot(base,base),0.0))+1.0);
  vec3 b=vec3(-detail*m1.z,sqrt(1.0-min(dot(detail*m1.w,detail*m1.w),1.0)));
  return a*dot(a,b)-a.z*b;
}
`;
