import {
	MeshStandardMaterial,
	Vector2,
	Vector4,
	type BufferGeometry,
	type Material,
	type Texture,
} from 'three';
import { cloneTextureInput, type TextureInput } from '../textureInputs.js';
import { longFeatherNormalSigns } from '../cloth/longFeatherShader.js';

type RGBA = [number, number, number, number];

const roles = ['N', 'N1', 'D1', 'M', 'D2', 'D', 'T', 'O'];

export interface FurnitureMirror {
	version: 1;
	family: 'magical-mirror-single-pass';
	uniforms: RGBA[];
	requiredUV: number[];
	textures: Record<string, TextureInput>;
	roughness: number;
	metalness: number;
}

export function readFurnitureMirror(value: unknown): FurnitureMirror | null {
	if (!value || typeof value !== 'object') return null;

	const c = value as FurnitureMirror;
	if (
		c.version !== 1 ||
		c.family !== 'magical-mirror-single-pass' ||
		!Array.isArray(c.uniforms) ||
		c.uniforms.length !== 28 ||
		!c.uniforms.every((row) => Array.isArray(row) && row.length === 4 && row.every(Number.isFinite)) ||
		!Array.isArray(c.requiredUV) ||
		!c.requiredUV.includes(0) ||
		!c.requiredUV.includes(2) ||
		!c.requiredUV.every((uv) => Number.isInteger(uv) && uv >= 0 && uv <= 3) ||
		![c.roughness, c.metalness].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ||
		!roles.every((role) => c.textures?.[role])
	) return null;
	if (c.textures.N?.normalEncoding !== 'native-rg' || c.textures.N1?.normalEncoding !== 'native-rg') return null;

	return c;
}

export function validateMirrorGeometry(geometry: BufferGeometry, c: FurnitureMirror) {
	const count = geometry.getAttribute('position')?.count;
	if (!count) throw new Error('Mirror requires source positions');

	for (const [key, size] of [
		['normal', 3],
		['tangent', 4],
		...c.requiredUV.map((uv) => [uv === 0 ? 'uv' : `uv${uv}`, 2]),
	] as Array<[string, number]>) {
		const a = geometry.getAttribute(key);
		if (!a || a.itemSize !== size || a.count !== count) throw new Error(`Mirror requires source ${key}`);
	}
}

const declarations = /* glsl */ `
varying vec3 vMirrorPosition, vMirrorNormal, vMirrorTangent, vMirrorBitangent;
varying vec2 vMirrorUV0, vMirrorUV1, vMirrorUV2, vMirrorUV3;
uniform vec4 mirrorUniforms[28];
uniform sampler2D mirrorN, mirrorN1, mirrorD1, mirrorM, mirrorD2, mirrorD, mirrorT, mirrorO;
uniform vec2 mirrorNormalSigns;
vec2 mirrorUV(vec4 selectUV) {
  return vMirrorUV0*selectUV.x + vMirrorUV1*selectUV.y + vMirrorUV2*selectUV.z + vMirrorUV3*selectUV.w;
}
vec3 mirrorDecode(vec2 sampled, vec3 scale) {
  vec2 xy = sampled*2.0-1.0;
  return vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)))*scale;
}
vec3 mirrorRNM(vec3 a, vec3 b) {
  vec3 t = a+vec3(0,0,1), u=b*vec3(-1,-1,1);
  return t*dot(t,u)-u*t.z;
}
`;

// Captured 22143 PS: material CB6[0..27], ASM26..284. Ripple uses
// frozen source time=0; TBN/view parallax and the two sampled layers remain.
const normalCore = /* glsl */ `
vec2 radial = vMirrorUV0-vec2(0.5);
float radius = length(radial)+mirrorUniforms[0].x;
float rippleGate = smoothstep(mirrorUniforms[0].z,mirrorUniforms[0].y,radius);
float ripplePhase = smoothstep(mirrorUniforms[1].x,mirrorUniforms[0].w,1.0-radius)*mirrorUniforms[1].y;
float ripple = (sin(ripplePhase*6.28318530718)-sin((ripplePhase-0.1*mirrorUniforms[1].z)*6.28318530718))*rippleGate;
vec2 rippleXY = (length(radial)>0.000001 ? radial/length(radial) : vec2(0))*ripple;
vec3 rippleN = normalize(vec3(rippleXY,sqrt(max(1.0-dot(rippleXY,rippleXY),0.0)))*mirrorUniforms[2].xyz);
vec3 baseN = mirrorDecode(texture2D(mirrorN,mirrorUV(vec4(mirrorUniforms[2].w,mirrorUniforms[3].xyz))).rg,mirrorUniforms[4].xyz);
vec3 patternN = mirrorDecode(texture2D(mirrorN1,vMirrorUV2*mirrorUniforms[5].yz).rg,vec3(mirrorUniforms[5].w,mirrorUniforms[5].w,1));
vec3 detailN = mirrorRNM(mirrorRNM(rippleN,baseN),patternN);
float patternWeight = smoothstep(mirrorUniforms[6].z,mirrorUniforms[6].y,vMirrorUV2.y);
vec3 tangentN = mix(rippleN,mix(baseN,detailN,patternWeight),clamp(rippleGate*10.0,0.0,1.0));
mat3 mirrorBasis = mat3(normalize(vMirrorTangent),normalize(vMirrorBitangent),normalize(vMirrorNormal));
tangentN.xy *= mirrorNormalSigns;
normal = normalize(mirrorBasis*normalize(tangentN));
`;

const layerCore = /* glsl */ `
vec3 mirrorView = normalize(-vMirrorPosition);
vec3 tangentView = vec3(dot(mirrorBasis[0],mirrorView),dot(mirrorBasis[1],mirrorView),dot(mirrorBasis[2],mirrorView));
tangentView.xy *= mirrorNormalSigns;
float denom = -tangentView.z;
denom = abs(denom)<0.000001 ? (denom<0.0 ? -0.000001 : 0.000001) : denom;
vec2 backgroundUV = vMirrorUV0*mirrorUniforms[20].xy+mirrorUniforms[20].zw + tangentView.xy*(mirrorUniforms[21].x/denom);
backgroundUV += tangentN.xy*mirrorUniforms[19].z;
vec3 background = texture2D(mirrorD,backgroundUV).rgb;
vec2 foregroundUV = vMirrorUV0*mirrorUniforms[21].y + tangentView.xy*(mirrorUniforms[21].z/denom) + mirrorUniforms[22].xy;
vec4 foreground = texture2D(mirrorT,foregroundUV);
vec2 inBounds = 1.0-min(abs(floor(foregroundUV)),vec2(1));
float foregroundGate = inBounds.x*inBounds.y;
background = mix(background,foreground.rgb*foregroundGate,foreground.a*foregroundGate);
vec3 baseColor = clamp(background*mirrorUniforms[23].rgb,0.0,1.0);
vec2 globalCoords = mirrorUV(vec4(mirrorUniforms[12].w,mirrorUniforms[13].xyz));
vec3 globalMask = texture2D(mirrorM,globalCoords).rgb;
vec2 glintUV = mirrorUV(vec4(mirrorUniforms[7].zw,mirrorUniforms[8].xy))*mirrorUniforms[8].z;
float parallaxDepth = mix(mirrorUniforms[9].y,mirrorUniforms[9].x,clamp(length(vMirrorPosition)*mirrorUniforms[8].w,0.0,1.0))*0.25-0.125;
vec2 glintFirst = texture2D(mirrorD1,glintUV+tangentView.xy*parallaxDepth).rg;
vec2 glintSecond = texture2D(mirrorD1,glintUV+tangentView.xy*parallaxDepth+normalize(vMirrorPosition).xy*mirrorUniforms[10].x).gr;
vec2 glint = glintSecond*glintFirst.gr;
vec3 glint2 = pow(max(glint.x,0.0),mirrorUniforms[10].y)*mirrorUniforms[11].rgb;
float glint1Weight = pow(max(glint.y,0.0),mirrorUniforms[11].w);
vec3 glintColor = mix(glint2,glint1Weight*mirrorUniforms[12].rgb,glint1Weight)*globalMask.b*mirrorUniforms[13].w;
vec2 emissiveUV = mirrorUV(vec4(mirrorUniforms[14].zw,mirrorUniforms[15].xy))*mirrorUniforms[15].zw;
float gradientUV = mix(emissiveUV.x,emissiveUV.y,mirrorUniforms[16].x);
float gradient = smoothstep(mirrorUniforms[16].z,mirrorUniforms[16].y,gradientUV);
vec3 emission = texture2D(mirrorD2,emissiveUV).rgb*globalMask.r*mix(mirrorUniforms[18].rgb,mirrorUniforms[17].rgb,gradient)*mirrorUniforms[19].y;
totalEmissiveRadiance += glintColor+emission+baseColor*mirrorUniforms[23].w;
diffuseColor.rgb = baseColor;
vec2 ormUV = mirrorUV(vec4(mirrorUniforms[26].yzw,mirrorUniforms[27].x));
diffuseColor.a = clamp(texture2D(mirrorO,ormUV).r*mirrorUniforms[27].y,0.0,1.0)*clamp(globalMask.g*(1.0+mirrorUniforms[25].w)*mirrorUniforms[26].x,0.0,1.0);
`;

export function createMirrorMaterial(c: FurnitureMirror, textures: Partial<Record<string, Texture | null>>, source: Material) {
	if (!readFurnitureMirror(c)) throw new Error('Invalid Mirror source contract');

	for (const role of roles)
		if (!textures[role]) throw new Error(`Mirror missing source texture ${role}`);

	const sampling = Object.fromEntries(roles.map((role) => [role, cloneTextureInput(textures[role]!, c.textures[role]!)]));
	const signs = longFeatherNormalSigns(source);
	const material = new MeshStandardMaterial({
		transparent: true,
		depthWrite: false,
		forceSinglePass: true,
		roughness: c.roughness,
		metalness: c.metalness,
	});
	material.userData = { ...source.userData, mirror: c };
	material.addEventListener('dispose', () => Object.values(sampling).forEach((t) => t.dispose()));
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => validateMirrorGeometry(geometry, c);
	material.onBeforeCompile = (shader) => {
		shader.uniforms.mirrorUniforms = { value: c.uniforms.map((v) => new Vector4(...v)) };
		shader.uniforms.mirrorNormalSigns = { value: new Vector2(...signs) };
		for (const role of roles) shader.uniforms[`mirror${role}`] = { value: sampling[role] };

		const uv = (n: number) => (c.requiredUV.includes(n) ? (n === 0 ? 'uv' : `uv${n}`) : 'vec2(0)');
		const attributes = [1, 2, 3]
			.filter((n) => c.requiredUV.includes(n))
			.map((n) => `#ifndef USE_UV${n}\nattribute vec2 uv${n};\n#endif`)
			.join('\n');
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>\n#ifndef USE_TANGENT\nattribute vec4 tangent;\n#endif\n${attributes}\nvarying vec3 vMirrorPosition,vMirrorNormal,vMirrorTangent,vMirrorBitangent;\nvarying vec2 vMirrorUV0,vMirrorUV1,vMirrorUV2,vMirrorUV3;`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>\nvMirrorPosition=mvPosition.xyz;\nvMirrorNormal=normalize(transformedNormal);\nvec3 mirrorObjectTangent=tangent.xyz;\n#ifdef USE_INSTANCING\nmirrorObjectTangent=mat3(instanceMatrix)*mirrorObjectTangent;\n#endif\nvMirrorTangent=normalize(mat3(modelViewMatrix)*mirrorObjectTangent);\nvMirrorBitangent=normalize(cross(vMirrorNormal,vMirrorTangent))*tangent.w;\nvMirrorUV0=${uv(0)};vMirrorUV1=${uv(1)};vMirrorUV2=${uv(2)};vMirrorUV3=${uv(3)};`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${declarations}`)
			.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${normalCore}`)
			.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${layerCore}`);
	};
	material.customProgramCacheKey = () => `magical-mirror-single-pass-1:${c.requiredUV.join(',')}`;
	return material;
}
