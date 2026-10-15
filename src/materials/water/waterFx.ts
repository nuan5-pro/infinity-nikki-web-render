import {
	AddEquation,
	CustomBlending,
	OneFactor,
	OneMinusSrcAlphaFactor,
	SrcAlphaFactor,
	ZeroFactor,
	type Material,
	type BufferGeometry,
	type Texture,
	type CubeTexture,
} from 'three';

export interface WaterFX {
	blend: 'translucent' | 'additive';
	material: number[][];
	textures: Record<string, string>;
	shader: string;
	requires: string[];
	resources?: import('./waterFxResources.js').WaterFxNativeResource[];
	transport?: 'x6fx-native-resource-views-v1';
}

export const waterFxTextureKeys = [
	'NormalMap',
	'TurbulenceMap',
	'BaseMap',
	'MaskMap',
	'SMaskMap',
	'OccMap',
	'REFMap',
	'DissolveMap',
	'Cubemap',
] as const;

export function waterFxActiveInputs(config: WaterFX, baseColorLighting: boolean) {
	const m = config.material;
	const baseEmission = m[25]![0] !== 0 || m[19]![0] !== 0;
	const shapedBase = baseEmission || baseColorLighting;
	const reflection =
		m[25]![0] !== 1 &&
		m[22]![3] !== 0 &&
		m[21]!.slice(0, 3).some((v) => v !== 0) &&
		[m[21]![3], ...m[22]!.slice(0, 3)].some((v) => v !== 0);
	const active = new Set<string>(['DissolveMap']);
	if (shapedBase || m[27]![1] !== 0) active.add('BaseMap');
	if (shapedBase || m[27]![0] !== 0) active.add('MaskMap');
	if (shapedBase && m[15]!.slice(1).some((v) => v !== 0)) active.add('SMaskMap');
	if (shapedBase && m[18]!.slice(1).some((v) => v !== 0)) active.add('OccMap');
	if (reflection) {
		active.add('NormalMap');
		active.add('REFMap');
		active.add('Cubemap');
	}

	if (baseColorLighting) active.add('NormalMap');
	// Keep distortion whenever any active downstream path can consume it.
	const distortion = m[4]![2] !== 0 || m[5]!.slice(0, 2).some((v) => v !== 0);
	if (
		distortion &&
		(active.has('BaseMap') ||
			active.has('OccMap') ||
			m[9]![2] !== 0 ||
			m[9]![3] !== 0 ||
			m[28]![1] !== 0)
	)
		active.add('TurbulenceMap');

	return {
		textures: active,
		reflection,
		baseColorLighting,
		sourceTOD: reflection,
		uv1: m[13]![1] !== 0,
		depth: true,
		camera: m[34]![2] !== 0,
		vertexRGBA: true,
		deadTextureKeys: waterFxTextureKeys.filter((key) => !active.has(key)),
	};
}

export function readWaterFX(value: unknown): WaterFX | null {
	if (!value || typeof value !== 'object') return null;

	const row = value as WaterFX;
	if (!['translucent', 'additive'].includes(row.blend)) return null;

	const shader =
		row.blend === 'additive'
			? 'cd1d929db9a76a43e10b8bfe42bc8abbf6845982'
			: '549f719395aeeeb3f7f1a79c1607c9968af25f90';
	if (
		row.shader !== shader ||
		!Array.isArray(row.material) ||
		row.material.length !== 35 ||
		!row.material.every((v) => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)) ||
		!row.textures ||
		!waterFxTextureKeys.every((key) => typeof row.textures[key] === 'string' && !!row.textures[key]) ||
		!Array.isArray(row.requires) ||
		!row.requires.every((key) => typeof key === 'string')
	) return null;

	return row;
}

// cd1d929d L690-694 premultiplies RGB and emits alpha=0. Do not use
// Three AdditiveBlending (SrcAlpha/One), or multiply coverage a second time.
export function applyWaterFxBlend(material: Material, config: WaterFX): void {
	material.transparent = true;
	material.depthWrite = false;
	material.alphaTest = 0;
	material.premultipliedAlpha = false;
	material.blending = CustomBlending;
	material.blendEquation = AddEquation;
	material.blendEquationAlpha = AddEquation;
	material.blendSrc = config.blend === 'additive' ? OneFactor : SrcAlphaFactor;
	material.blendDst = config.blend === 'additive' ? OneFactor : OneMinusSrcAlphaFactor;
	// UE BasePassRendering.cpp L337/L343 stores destination transmittance in
	// alpha. Additive alpha0 naturally leaves it unchanged through (1-alpha).
	material.blendSrcAlpha = ZeroFactor;
	material.blendDstAlpha = OneMinusSrcAlphaFactor;
	material.needsUpdate = true;
}

export function assertWaterFxGeometry(config: WaterFX, geometry: BufferGeometry): void {
	const color = geometry.getAttribute('ueWaterFxColor');
	if (!color || color.itemSize !== 4 || color.count !== geometry.getAttribute('position')?.count) throw new Error('X6FX requires captured VM COLOR RGBA');
	if (!geometry.getAttribute('uv')) throw new Error('X6FX requires source UV0');
	if (config.material[13]![1] !== 0 && !geometry.getAttribute('uv1')) throw new Error('X6FX UseUV2 requires source UV1');
}

// Texture transfer, original headers, mip ownership and clock stay with caller.
// Cubemap is the captured source cube, not a renderer environment substitute.
export function waterFxUniforms(
	config: WaterFX,
	textures: Record<string, Texture | CubeTexture>,
	active = new Set<string>(waterFxTextureKeys),
) {
	const uniforms: Record<string, { value: unknown }> = { fxM: { value: config.material.flat() } };
	for (const key of waterFxTextureKeys) {
		if (!active.has(key)) continue;
		const texture = textures[key];
		if (!texture || (key === 'Cubemap' && !(texture as CubeTexture).isCubeTexture)) throw new Error(`X6FX missing captured resource: ${key} (${config.textures[key]})`);

		uniforms[`fx${key}`] = { value: texture };
	}

	return uniforms;
}

// Authored parameters are immutable. Folding the captured ABI enables real
// compiler dead-code elimination; absent dead samplers are never bound to fake
// white resources. The raw reusable helper remains available for diagnostic ABI.
export function waterFxStaticShader(config: WaterFX): string {
	const literal = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));
	const rows = config.material.map((row) => `vec4(${row.map(literal).join(',')})`).join(',\n');
	return waterFxShader.replace('uniform vec4 fxM[35];', `const vec4 fxM[35]=vec4[35](\n${rows});`);
}

/** CPU counterpart of the native output/blend contract, in linear radiance. */
export function compositeWaterFx(blend: WaterFX['blend'], source: number[], coverage: number, destination: number[]) {
	const alpha = Math.min(1, Math.max(0, coverage));
	return destination.map((background, i) => source[i]! * alpha + background * (blend === 'additive' ? 1 : 1 - alpha));
}

export interface WaterFxCoverageInputs {
	baseR: number;
	baseA: number;
	maskR: number;
	maskA: number;
	dissolveR: number;
	uv: [number, number];
	vertexAlpha: number;
	tangentViewZ: number;
	depthDeltaCm: number;
	cameraDistanceCm: number;
	upCloseFade: number;
}

export function sampleWaterFxCoverage(config: WaterFX, input: WaterFxCoverageInputs): number {
	const m = config.material;
	const sat = (v: number) => Math.min(1, Math.max(0, v));
	const mix = (a: number, b: number, v: number) => a + (b - a) * v;
	const pow = (v: number, p: number) => (v <= 0 ? 0 : Math.pow(v, p));
	let coverage = mix(1, input.maskR * input.maskA, m[27]![0]!);
	coverage *= mix(m[27]![2]!, input.baseR * input.baseA, m[27]![1]!);

	const threshold = mix(m[30]![1]!, -1, m[30]![2]!);
	const uvThreshold = input.uv[0] * m[30]![3]! * m[32]![0]! + input.uv[1] * m[32]![1]! * m[32]![2]!;
	coverage *= sat(input.dissolveR * m[30]![1]! - threshold - uvThreshold);
	coverage *= sat(input.depthDeltaCm * m[32]![3]!);
	coverage = pow(coverage, m[33]![0]!);
	coverage *= pow(mix(1, Math.abs(input.tangentViewZ), m[33]![1]!), m[33]![2]!) * input.vertexAlpha;

	let fade = sat((input.cameraDistanceCm - m[33]![3]!) / m[34]![0]!);
	fade = mix(fade, 1 - fade, m[34]![1]!);
	fade = mix(fade, 1, input.upCloseFade);
	return sat(coverage * mix(1, fade, m[34]![2]!) * m[34]![3]!);
}

// 549f7193 / cd1d929d L111-402. Caller provides source-space TBN / view
// inputs, current opaque linear depth delta (UE cm), source time-of-day and
// up-close primitive fade. None may be replaced by a fabricated white COLOR.
// Output is native unlit emissive + coverage, before fog/exposure/tone mapping.
export const waterFxShader = /* glsl */ `
uniform vec4 fxM[35];
uniform sampler2D fxNormalMap, fxTurbulenceMap, fxBaseMap, fxMaskMap;
uniform sampler2D fxSMaskMap, fxOccMap, fxREFMap, fxDissolveMap;
uniform samplerCube fxCubemap;
uniform float fxMipBias;
float fxPow(float v, float p) { return v <= 0.0 ? 0.0 : pow(v, p); }
vec3 fxPow3(vec3 v, float p) { return vec3(fxPow(v.r,p),fxPow(v.g,p),fxPow(v.b,p)); }
vec2 fxClampUV(vec2 uv, float amount) { return mix(uv,clamp(uv,0.0,1.0),amount); }
vec2 fxRotate(vec2 uv, vec2 cs) {
  uv -= 0.5;
  return vec2(uv.x*cs.x-uv.y*cs.y,uv.y*cs.x+uv.x*cs.y)+0.5;
}
vec2 fxST(vec2 uv, vec4 st) { return uv*st.xz+st.yw; }
// Source ALL_Speed_Param multiplies Y only. X panners remain independent.
vec2 fxPan(vec2 uv, vec2 speed, float time) { return uv+vec2(speed.x,speed.y*fxM[0].x)*time; }
struct WaterFxSample { vec3 emission; vec3 baseColor; float coverage; vec3 normal; };
WaterFxSample sampleWaterFx(vec2 uv0, vec2 uv1, vec4 vertexColor,
  mat3 tbn, vec3 viewDir, float faceSign, vec4 nativeNormalBiasScale,
  float time, float depthDeltaCm, float cameraDistanceCm, float upCloseFade,
  float sourceTimeOfDay, float sourceEmissiveScale, float sourcePreExposure) {
  vec2 nUv=fxPan(uv0,fxM[0].zy,time)*vec2(fxM[0].w,fxM[1].y)+fxM[1].xz;
  vec2 nxy=texture2D(fxNormalMap,fxClampUV(nUv,fxM[1].w),fxMipBias).xy*2.0-1.0;
  vec3 nt=vec3(nxy,sqrt(max(0.0,1.0-dot(nxy,nxy))));
  nt=mix(vec3(1.0),nt+fxM[2].xyz,vertexColor.b);
  nt=normalize(nt*nativeNormalBiasScale.w+nativeNormalBiasScale.xyz);
  vec3 n=normalize(tbn*nt)*faceSign;
  vec3 reflected=reflect(-viewDir,n);
  vec2 turbUv=fxPan(uv0,vec2(fxM[3].x,fxM[2].w),time)*fxM[3].yw+vec2(fxM[3].z,fxM[4].x);
  vec4 turb=texture2D(fxTurbulenceMap,fxClampUV(turbUv,fxM[4].y),fxMipBias);
  vec2 distortion=turb.r*turb.a*(fxM[5].xy+fxM[4].z);
  vec2 baseUv=fxRotate(fxPan(uv0,fxM[5].wz,time)+distortion,fxM[6].xy);
  baseUv=baseUv*vec2(fxM[6].z,fxM[7].x)+vec2(fxM[6].w,fxM[7].y);
  vec4 base=texture2D(fxBaseMap,fxClampUV(baseUv,fxM[7].z),fxMipBias);
  vec3 emission=fxPow3(base.rgb*fxM[7].w,fxM[8].x)*fxM[8].yzw;
  vec2 maskOrigin=fxPan(uv0,fxM[9].yx,time);
  vec2 maskDist=distortion*fxM[9].z+distortion*fxM[9].w;
  vec2 maskUv=mix(maskOrigin+maskDist,maskOrigin,fxM[10].x);
  maskUv=maskUv*fxM[10].yw+vec2(fxM[10].z,fxM[11].x);
  vec4 mask=texture2D(fxMaskMap,fxClampUV(maskUv,fxM[11].y),fxMipBias);
  float maskRA=mask.r*mask.a;
  emission+=maskRA*vertexColor.g*fxM[12].xyz;
  vec2 selectedUv=mix(uv0,uv1,fxM[13].y);
  vec2 smUv=fxRotate(fxPan(selectedUv,vec2(fxM[13].x,fxM[12].w),time)+maskDist,fxM[13].zw);
  vec4 sm=texture2D(fxSMaskMap,fxClampUV(fxST(smUv,fxM[14]),fxM[15].x),fxMipBias);
  emission+=sm.r*sm.a*vertexColor.g*fxM[15].yzw;
  vec2 occUv=fxPan(uv0,fxM[16].yx,time)+distortion;
  occUv=occUv*vec2(fxM[16].z,fxM[17].x)+vec2(fxM[16].w,fxM[17].y);
  vec3 occ=texture2D(fxOccMap,fxClampUV(occUv,fxM[17].z),fxMipBias).rgb;
  emission+=fxPow3(occ*fxM[17].w,fxM[18].x)*vertexColor.g*fxM[18].yzw;
  vec3 back=emission*fxM[19].x*(1.0-clamp(faceSign,0.0,1.0));
  vec3 tangentView=vec3(dot(tbn[0],viewDir),dot(tbn[1],viewDir),dot(tbn[2],viewDir));
  vec3 customRef=2.0*dot(tangentView,fxM[20].xyz)*fxM[20].xyz-tangentView;
  vec3 cube=textureCube(fxCubemap,customRef+reflected).rgb*fxM[21].xyz;
  float tod=clamp(sourceTimeOfDay*4.0,0.0,1.0);
  float strength=mix(fxM[22].x,fxM[21].w,tod);
  strength=mix(strength,fxM[22].y,clamp(sourceTimeOfDay*4.0-1.0,0.0,1.0));
  strength=mix(strength,fxM[22].z,clamp(sourceTimeOfDay*4.0-2.0,0.0,1.0));
  strength=mix(strength,fxM[22].x,clamp(sourceTimeOfDay*4.0-3.0,0.0,1.0));
  cube*=strength*fxM[22].w;
  vec3 axis=vec3(0.577350);
  vec3 chroma=cube-axis*dot(axis,cube);
  cube=chroma*cos(fxM[19].y)+cross(chroma,axis)*sin(fxM[19].y)+axis*dot(axis,cube);
  cube=mix(cube,vec3(dot(cube,vec3(0.3,0.59,0.11))),fxM[23].x);
  vec2 refUv=fxPan(uv0,fxM[23].zy,time);
  refUv=mix(refUv+maskDist,refUv,fxM[10].x);
  refUv=refUv*vec2(fxM[23].w,fxM[24].y)+fxM[24].xz;
  vec4 ref=texture2D(fxREFMap,fxClampUV(refUv,fxM[24].w),fxMipBias);
  vec3 combined=mix(cube*ref.r*ref.a*vertexColor.r,emission,fxM[25].x)+back;
  combined*=sourceEmissiveScale*sourcePreExposure;
  combined=mix(combined,fxM[26].xyz,fxM[25].y);
  // L312 is a distinct base-color input to native scene lighting. Expose it,
  // never add albedo straight into unlit emissive or fake a source light rig.
  float coverage=mix(1.0,maskRA,fxM[27].x);
  coverage*=mix(fxM[27].z,base.r*base.a,fxM[27].y);
  vec2 disUv=fxPan(selectedUv,vec2(fxM[28].x,fxM[27].w),time);
  disUv+=distortion*fxM[28].y+distortion*fxM[9].w;
  disUv=fxST(fxRotate(disUv,fxM[28].zw),fxM[29]);
  float dis=texture2D(fxDissolveMap,fxClampUV(disUv,fxM[30].x),fxMipBias).r;
  float threshold=mix(fxM[30].y,-1.0,fxM[30].z);
  float uvThreshold=uv0.x*fxM[30].w*fxM[32].x+uv0.y*fxM[32].y*fxM[32].z;
  coverage*=clamp(dis*fxM[30].y-threshold-uvThreshold,0.0,1.0);
  coverage*=clamp(depthDeltaCm*fxM[32].w,0.0,1.0);
  coverage=fxPow(coverage,fxM[33].x);
  coverage*=fxPow(mix(1.0,abs(tangentView.z),fxM[33].y),fxM[33].z)*vertexColor.a;
  float distanceFade=clamp((cameraDistanceCm-fxM[33].w)/fxM[34].x,0.0,1.0);
  distanceFade=mix(distanceFade,1.0-distanceFade,fxM[34].y);
  distanceFade=mix(distanceFade,1.0,upCloseFade);
  coverage*=mix(1.0,distanceFade,fxM[34].z);
  WaterFxSample result;
  result.emission=max(combined,vec3(0.0));
  result.baseColor=clamp(emission*fxM[26].w,0.0,1.0);
  result.coverage=clamp(coverage*fxM[34].w,0.0,1.0);
  result.normal=n;
  return result;
}
// 549f L694-700 / cd1d L686-694: normal translucency adds fog
// inscatter, additive only attenuates. Output exposure/clamp belong after fog.
vec4 waterFxNativeOutput(WaterFxSample value, bool additive, float fogTransmittance,
  vec3 fogInscatter, vec3 sourceLighting, float holdout, float outputExposure, float hdrClamp) {
  float coverage=value.coverage*(1.0-holdout);
  vec3 radiance=(value.emission+sourceLighting)*fogTransmittance;
  if (additive) radiance*=coverage;
  else radiance+=fogInscatter;
  radiance=min(radiance*outputExposure,vec3(hdrClamp));
  return vec4(radiance,additive ? 0.0 : coverage);
}
`;
