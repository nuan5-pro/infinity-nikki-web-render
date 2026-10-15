import {
	ClampToEdgeWrapping,
	DoubleSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshBasicMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector4,
	type Texture,
} from 'three';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

interface LiquidTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureLiquidVolumeStatic {
	version: 1;
	family: 'liquid-volume-static';
	requiredUv: number[];
	scalars: Record<string, number>;
	colors: Record<string, [number, number, number, number]>;
	textures: Record<string, LiquidTexture>;
}

const scalarKeys = [
	'Pattern_NIntensity',
	'Global_WorldOpacityMinValue',
	'Global_MobileOpScale',
	'Main_SceneColorIntensity',
	'Fabric_CustomSpecRange',
	'Main_HDRContrast',
	'Main_HDRRange',
	'Global_WorldEmissive',
];

const colorKeys = [
	'Fabric_NInfo',
	'Pattern_NTiling&Panner_01',
	'Main_MGA',
	'Opacity_Attr_02',
	'Fabric_CustomSpec',
	'Main_HDRColorTint(A:Emissive)',
	'Main_ColorTint(A:Emissive)',
	'Pattern_ColorTint(A:Emissive)',
	'Pattern_Tiling&Panner',
	'Fabric_RimColor(A:Emissive)',
];

const roles = ['D', 'N', 'O', 'N1', 'N2', 'D1', 'D2', 'S'];
const parameter = (key: string) => `l${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;

export function readFurnitureLiquidVolumeStatic(value: unknown): FurnitureLiquidVolumeStatic | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureLiquidVolumeStatic;
	if (
		p.version !== 1 ||
		p.family !== 'liquid-volume-static' ||
		!Array.isArray(p.requiredUv) ||
		p.requiredUv.length !== 3 ||
		![0, 1, 2].every((uv) => p.requiredUv.includes(uv)) ||
		!p.scalars ||
		!p.colors ||
		!p.textures ||
		scalarKeys.some((key) => !Number.isFinite(p.scalars[key])) ||
		colorKeys.some(
			(key) =>
				!Array.isArray(p.colors[key]) ||
				p.colors[key]!.length !== 4 ||
				!p.colors[key]!.every(Number.isFinite),
		)
	) return null;

	for (const role of roles) {
		const t = p.textures[role];
		if (
			!t ||
			typeof t.parameter !== 'string' ||
			!t.parameter ||
			typeof t.sRGB !== 'boolean' ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			t.cube !== (role === 'S') ||
			!Number.isFinite(t.rgbScale) ||
			t.rgbScale < 1 ||
			(['N', 'N1', 'N2', 'S'].includes(role) && t.sRGB) ||
			![t.addressX, t.addressY].every((a) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(a))
		) return null;
	}

	return p;
}

const declarations = /* glsl */ `
${nativeWorldFrameGLSL}
varying vec3 vLiquidPosition,vLiquidNormal;
varying vec2 vLiquidUV0,vLiquidUV1,vLiquidUV2;
vec3 liquidNormal(vec2 rg,float strength) {
  rg=rg*2.0-1.0;
  vec2 zRG=rg*min(strength,1.0);
  return vec3(rg*strength,sqrt(max(1.0-min(dot(zRG,zRG),1.0),0.0)));
}
vec3 liquidRNM(vec3 a,vec3 b) {
  vec3 t=a+vec3(0,0,1),u=b*vec3(-1,-1,1);
  return t*dot(t,u)-u*t.z;
}
mat3 liquidFrame(vec3 n) {
  vec3 dx=dFdx(vLiquidPosition),dy=dFdy(vLiquidPosition);
  vec2 ux=dFdx(vLiquidUV0),uy=dFdy(vLiquidUV0);
  vec3 t=cross(dy,n)*ux.x+cross(n,dx)*uy.x;
  vec3 b=cross(dy,n)*ux.y+cross(n,dx)*uy.y;
  float magnitude=max(dot(t,t),dot(b,b));
  if(magnitude<.00000001) {
    t=normalize(cross(abs(n.z)<.9?vec3(0,0,1):vec3(0,1,0),n));
    return mat3(t,cross(n,t),n);
  }
  return mat3(t*inversesqrt(magnitude),b*inversesqrt(magnitude),n);
}
vec3 liquidCube(vec3 direction) {
  vec3 d=normalize(furnitureNativeWorld(transpose(mat3(viewMatrix))*direction));
  vec2 uv=vec2(fract(atan(-d.x,-d.z)/6.28318530718),1.0-acos(clamp(d.y,-1.0,1.0))/3.14159265359);
  return texture2D(liquidS,uv).rgb*liquidScaleS;
}
`;

const core = /* glsl */ `
{
vec3 view=isOrthographic?vec3(0,0,1):normalize(-vLiquidPosition);
vec3 geometric=normalize(vLiquidNormal);
vec3 mainNormal=liquidNormal(texture2D(liquidN,vLiquidUV0).rg,1.0);
vec3 fabricNormal=liquidNormal(texture2D(liquidN1,vLiquidUV1*lFabric_NInfo.yz).rg,lFabric_NInfo.a);
vec3 baseNormal=liquidRNM(mainNormal,fabricNormal);
vec3 patternNormal=liquidNormal(texture2D(liquidN2,vLiquidUV2*lPattern_NTiling_Panner_01.xy).rg,lPattern_NIntensity);
vec4 mask=texture2D(liquidO,vLiquidUV0);
vec3 tangentNormal=mix(baseNormal,liquidRNM(baseNormal,patternNormal),mask.a*lMain_MGA.a);
tangentNormal.y=-tangentNormal.y;
vec3 normal=normalize(liquidFrame(geometric)*tangentNormal);
float front=clamp(dot(normal,view),0.0,1.0),edge=max(abs(1.0-front),.0001);
vec4 body=texture2D(liquidD,vLiquidUV0);
float minimum=lGlobal_WorldOpacityMinValue+lGlobal_MobileOpScale;
float rawAlpha=max(pow(edge,5.0)*lOpacity_Attr_02.z,clamp(body.a*(1.0-minimum)+minimum,0.0,1.0));
float alpha=clamp(mix(lOpacity_Attr_02.x,lOpacity_Attr_02.y,rawAlpha),0.0,1.0);
alpha=clamp(alpha+mask.g*alpha*(lMain_SceneColorIntensity-1.0),0.0,1.0);
vec3 emission=body.rgb*texture2D(liquidD2,vLiquidUV1).rgb*lMain_ColorTint_A_Emissive_.rgb*lMain_ColorTint_A_Emissive_.a;
vec3 pattern=texture2D(liquidD1,vLiquidUV2*lPattern_Tiling_Panner.xy).rgb;
emission=mix(emission,lPattern_ColorTint_A_Emissive_.rgb*lPattern_ColorTint_A_Emissive_.a,clamp(pattern*mask.a*lMain_MGA.a,0.0,1.0));
vec3 hdr=pow(max(liquidCube(reflect(-view,normal)),vec3(0)),vec3(lMain_HDRContrast));
hdr*=.1+.9*pow(edge,lMain_HDRRange);
emission+=hdr*lMain_HDRColorTint_A_Emissive_.rgb*lMain_HDRColorTint_A_Emissive_.a*mask.b;
emission+=pow(edge,3.0)*lFabric_RimColor_A_Emissive_.rgb*lFabric_RimColor_A_Emissive_.a;
emission+=pow(front,lFabric_CustomSpecRange)*lFabric_CustomSpec.rgb*lFabric_CustomSpec.a;
diffuseColor=vec4(emission*lGlobal_WorldEmissive,alpha);
}
`;

export function createLiquidVolumeStaticMaterial(profile: FurnitureLiquidVolumeStatic, textures: Record<string, Texture | null | undefined>) {
	if (!readFurnitureLiquidVolumeStatic(profile)) throw new Error('[LiquidVolumeStatic] invalid source profile');

	const sampling: Record<string, Texture> = {};

	const wrap = (value: string) =>
		value === 'TA_Clamp'
			? ClampToEdgeWrapping
			: value === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const role of roles) {
		const source = textures[role];
		const contract = profile.textures[role]!;
		if (!source) throw new Error(`[LiquidVolumeStatic] missing texture ${role}`);

		const texture = source.clone();
		texture.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = contract.cube ? RepeatWrapping : wrap(contract.addressX);
		texture.wrapT = contract.cube ? ClampToEdgeWrapping : wrap(contract.addressY);
		texture.generateMipmaps = contract.mipmaps;
		texture.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = contract.nearest
			? NearestFilter
			: contract.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		if (contract.cube) texture.flipY = false;
		texture.needsUpdate = true;
		sampling[role] = texture;
	}

	const material = new MeshBasicMaterial({
		transparent: true,
		opacity: 1,
		depthWrite: false,
		side: DoubleSide,
		forceSinglePass: true,
	});
	material.userData.liquidVolumeStatic = profile;
	material.addEventListener('dispose', () => Object.values(sampling).forEach((texture) => texture.dispose()));
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		if (
			!profile.requiredUv.every((channel) => !!geometry.getAttribute(channel === 0 ? 'uv' : `uv${channel}`))
		) throw new Error('[LiquidVolumeStatic] missing active source UV channel');
	};
	material.customProgramCacheKey = () => 'liquid-volume-static-source-core-1';
	material.onBeforeCompile = (shader) => {
		let uniforms = '';
		for (const key of scalarKeys) {
			shader.uniforms[parameter(key)] = { value: profile.scalars[key] };
			uniforms += `uniform float ${parameter(key)};\n`;
		}

		for (const key of colorKeys) {
			shader.uniforms[parameter(key)] = { value: new Vector4(...profile.colors[key]!) };
			uniforms += `uniform vec4 ${parameter(key)};\n`;
		}

		for (const role of roles) {
			shader.uniforms[`liquid${role}`] = { value: sampling[role] };
			uniforms += `uniform sampler2D liquid${role};\n`;
		}

		shader.uniforms.liquidScaleS = { value: profile.textures.S!.rgbScale };
		uniforms += 'uniform float liquidScaleS;\n';
		shader.vertexShader =
			`varying vec3 vLiquidPosition,vLiquidNormal; varying vec2 vLiquidUV0,vLiquidUV1,vLiquidUV2;
#ifndef USE_UV1
attribute vec2 uv1;
#endif
#ifndef USE_UV2
attribute vec2 uv2;
#endif
` +
			shader.vertexShader
				.replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
				.replace(
					'#include <project_vertex>',
					`#include <project_vertex>
vLiquidPosition=mvPosition.xyz; vLiquidNormal=transformedNormal; vLiquidUV0=uv; vLiquidUV1=uv1; vLiquidUV2=uv2;`,
				);
		shader.fragmentShader = uniforms + declarations + shader.fragmentShader.replace('#include <map_fragment>', core);
	};
	return material;
}
