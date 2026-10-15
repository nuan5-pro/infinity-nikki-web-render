import {
	ClampToEdgeWrapping,
	DoubleSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshBasicMaterial,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector4,
	type Texture,
} from 'three';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

interface WaterTexture {
	parameter: string
	sRGB: boolean
	rgbScale: number
	addressX: string
	addressY: string
	mipmaps: boolean
	nearest: boolean
	cube: boolean
}

export interface FurnitureWaterSmallProp {
	version: 1
	family: 'water-small-prop'
	requiredUv: number[]
	scalars: Record<string, number>
	colors: Record<string, [number, number, number, number]>
	textures: Record<string, WaterTexture>
	proxyDepth: number
	approximation?: string
}

const scalars = [
	'DeepDepthScale',
	'DepthDeepHardness',
	'CubeMap_Contrast',
	'LocalUV',
	'NormalScale',
	'NormalIntensity',
	'CubeMap_Fresnel',
	'Brightness-Day',
	'EdgeDepthScale',
	'EdgeHardness',
	'Opacity',
	'UseMultiplyBlend',
	'WPO',
];

const colors = ['Color_Shallow', 'Color_Deep', 'NormalFlowDirection', 'CubeMap_Tint'];
const uniformName = (key: string) => `wsp${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;

export function readFurnitureWaterSmallProp(value: unknown): FurnitureWaterSmallProp | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureWaterSmallProp;
	if (
		p.version !== 1 ||
		p.family !== 'water-small-prop' ||
		!Number.isFinite(p.proxyDepth) ||
		p.proxyDepth <= 0 ||
		!Array.isArray(p.requiredUv) ||
		p.requiredUv.length !== 1 ||
		p.requiredUv[0] !== 0 ||
		!p.scalars ||
		!p.colors ||
		!p.textures ||
		scalars.some((key) => !Number.isFinite(p.scalars[key])) ||
		colors.some(
			(key) =>
				!Array.isArray(p.colors[key]) ||
				p.colors[key]!.length !== 4 ||
				!p.colors[key]!.every(Number.isFinite),
		)
	) return null;
	if (
		p.scalars.UseMultiplyBlend !== 0 ||
		p.scalars.WPO !== 0 ||
		p.scalars.DeepDepthScale! <= 0 ||
		p.scalars.EdgeDepthScale! <= 0 ||
		p.scalars.NormalScale! <= 0 ||
		p.scalars.CubeMap_Fresnel! < 0 ||
		p.scalars.CubeMap_Contrast! < 0
	) return null;

	for (const role of ['N', 'O']) {
		const texture = p.textures[role];
		if (
			!texture ||
			texture.parameter !== (role === 'N' ? 'NormalTex' : 'CubeMap') ||
			typeof texture.sRGB !== 'boolean' ||
			!Number.isFinite(texture.rgbScale) ||
			texture.rgbScale < 1 ||
			texture.cube !== (role === 'O') ||
			typeof texture.mipmaps !== 'boolean' ||
			typeof texture.nearest !== 'boolean' ||
			![texture.addressX, texture.addressY].every((address) => ['TA_Wrap', 'TA_Clamp'].includes(address))
		) return null;
	}

	return p;
}

const declarations = /* glsl */ `
${nativeWorldFrameGLSL}
varying vec3 vWSPPosition, vWSPNormal, vWSPWorld;
varying vec2 vWSPUV;
uniform sampler2D wspNormal, wspCube;
uniform float wspTime, wspCubeScale, wspProxyDepth;
float wspPow(float value, float exponent) { return value > 0.0 ? pow(value, exponent) : 0.0; }
vec3 wspDecode(vec2 uv) {
  vec2 rg=texture2D(wspNormal,uv).rg*2.0-1.0;
  rg.y=-rg.y;
  return vec3(rg,sqrt(max(1.0-dot(rg,rg),0.0)));
}
mat3 wspFrame(vec3 n) {
  vec3 dx=dFdx(vWSPPosition),dy=dFdy(vWSPPosition);
  vec2 ux=dFdx(vWSPUV),uy=dFdy(vWSPUV);
  vec3 t=cross(dy,n)*ux.x+cross(n,dx)*uy.x;
  vec3 b=cross(dy,n)*ux.y+cross(n,dx)*uy.y;
  float magnitude=max(dot(t,t),dot(b,b));
  if(magnitude<.00000001) {
    t=normalize(cross(abs(n.z)<.9?vec3(0,0,1):vec3(0,1,0),n));
    return mat3(t,cross(n,t),n);
  }
  return mat3(t*inversesqrt(magnitude),b*inversesqrt(magnitude),n);
}
`;

const colorCore = /* glsl */ `
{
vec3 view=isOrthographic?vec3(0,0,1):normalize(-vWSPPosition);
vec3 geometric=normalize(vWSPNormal);
vec2 baseUV=mix(vWSPWorld.xy*.000001,vWSPUV,wspLocalUV)*wspNormalScale;
vec3 first=wspDecode(baseUV+wspNormalFlowDirection.xy*wspTime);
vec3 second=wspDecode(baseUV+wspNormalFlowDirection.zw*wspTime);
// Native RNM combines both samples before applying XY intensity.
vec3 t=first+vec3(0,0,1),u=second*vec3(-1,-1,1);
vec3 tangentNormal=normalize((t*dot(t,u)-u*t.z)*vec3(wspNormalIntensity,wspNormalIntensity,1));
vec3 normal=normalize(wspFrame(geometric)*tangentNormal);
normal*=gl_FrontFacing?1.0:-1.0;
vec3 reflection=normalize(furnitureNativeWorld(transpose(mat3(viewMatrix))*reflect(-view,normal)));
vec2 cubeUV=vec2(fract(atan(-reflection.x,-reflection.z)/6.28318530718),1.0-acos(clamp(reflection.y,-1.0,1.0))/3.14159265359);
float cube=texture2D(wspCube,cubeUV).r*wspCubeScale;
float fresnel=wspPow(max(abs(1.0-max(dot(geometric,view),0.0)),.0001),wspCubeMap_Fresnel);
// The source contrast is a linear remap, not a power on HDR colour.
cube=clamp(cube*fresnel*(1.0+2.0*wspCubeMap_Contrast)-wspCubeMap_Contrast,0.0,1.0);
float deep=clamp(wspPow(wspProxyDepth/wspDeepDepthScale,wspDepthDeepHardness),0.0,1.0);
vec3 body=mix(wspColor_Shallow.rgb,wspColor_Deep.rgb,deep);
body+=cube*wspCubeMap_Tint.rgb*wspCubeMap_Tint.a;
// The native colour path multiplies edge depth before ordinary alpha blending.
float edge=clamp(wspPow(wspProxyDepth/wspEdgeDepthScale,wspEdgeHardness),0.0,1.0);
diffuseColor.rgb=body*wspBrightness_Day*edge;
diffuseColor.a=clamp(edge*wspOpacity,0.0,1.0);
}
`;

export function createWaterSmallPropMaterial(config: FurnitureWaterSmallProp, textures: Partial<Record<string, Texture | null>>): MeshBasicMaterial {
	if (!readFurnitureWaterSmallProp(config)) throw new Error('WaterSmallProp invalid source contract');

	for (const role of ['N', 'O'])
		if (!textures[role]) throw new Error(`WaterSmallProp missing ${role}`);

	const material = new MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		depthWrite: false,
		side: DoubleSide,
	});
	material.forceSinglePass = true;
	material.userData.waterSmallProp = config;

	const time = { value: 0 };
	const bound: Record<string, Texture> = {};
	for (const role of ['N', 'O']) {
		const source = config.textures[role]!;
		const texture = textures[role]!.clone();
		texture.colorSpace = source.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = source.cube
			? RepeatWrapping
			: source.addressX === 'TA_Clamp'
				? ClampToEdgeWrapping
				: RepeatWrapping;
		texture.wrapT = source.cube
			? ClampToEdgeWrapping
			: source.addressY === 'TA_Clamp'
				? ClampToEdgeWrapping
				: RepeatWrapping;
		texture.minFilter = source.nearest
			? NearestFilter
			: source.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		texture.magFilter = source.nearest ? NearestFilter : LinearFilter;
		texture.generateMipmaps = source.mipmaps;
		texture.flipY = false;
		texture.needsUpdate = true;
		bound[role] = texture;
	}

	material.addEventListener('dispose', () => Object.values(bound).forEach((texture) => texture.dispose()));
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		if (!geometry.getAttribute('uv')) throw new Error('WaterSmallProp missing source UV0');

		time.value = performance.now() * 0.001;
	};
	material.onBeforeCompile = (shader) => {
		shader.uniforms.wspNormal = { value: bound.N };
		shader.uniforms.wspCube = { value: bound.O };
		shader.uniforms.wspTime = time;
		shader.uniforms.wspCubeScale = { value: config.textures.O!.rgbScale };
		shader.uniforms.wspProxyDepth = { value: config.proxyDepth };
		for (const key of scalars) shader.uniforms[uniformName(key)] = { value: config.scalars[key] };

		for (const key of colors)
			shader.uniforms[uniformName(key)] = { value: new Vector4(...config.colors[key]!) };

		shader.vertexShader = shader.vertexShader
			.replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
			.replace(
				'#include <common>',
				`#include <common>
varying vec3 vWSPPosition,vWSPNormal,vWSPWorld;
varying vec2 vWSPUV;`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
vWSPPosition=mvPosition.xyz;
vWSPNormal=normalize(transformedNormal);
vWSPUV=uv;
vec4 wspWorld=vec4(transformed,1.0);
#ifdef USE_BATCHING
wspWorld=batchingMatrix*wspWorld;
#endif
#ifdef USE_INSTANCING
wspWorld=instanceMatrix*wspWorld;
#endif
wspWorld=modelMatrix*wspWorld;
vWSPWorld=vec3(wspWorld.x,-wspWorld.y,wspWorld.z);`,
			);

		const uniforms = [
			...scalars.map((key) => `uniform float ${uniformName(key)};`),
			...colors.map((key) => `uniform vec4 ${uniformName(key)};`),
		].join('\n');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${uniforms}\n${declarations}`)
			.replace('#include <color_fragment>', `#include <color_fragment>\n${colorCore}`);
	};
	material.customProgramCacheKey = () => 'water-small-prop-rnm-cube-edge-v1';
	return material;
}
