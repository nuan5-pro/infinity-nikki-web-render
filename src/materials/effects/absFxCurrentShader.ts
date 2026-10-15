import {
	ClampToEdgeWrapping,
	DoubleSide,
	FrontSide,
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
	Vector4,
	type Texture,
} from 'three';
import { absFxCurrentCoverageBinding, absFxCurrentMath } from './absFxCurrentSource.js';

interface SourceTexture {
	parameter: string
	sRGB: boolean
	rgbScale: number
	addressX: string
	addressY: string
	mipmaps: boolean
	nearest: boolean
	cube: boolean
}

export interface ABSFXCurrentCollection {
	baseColor: [number, number, number, number]
	emissiveColor: [number, number, number, number]
	saturation: number
	gamma: number
	post: [number, number, number, number]
}

export interface FurnitureABSFXCurrent {
	version: 1
	family: 'abs-fx-current'
	uniforms: number[][]
	textures: Record<string, SourceTexture>
	requiredUV: number[]
	twoSided: boolean
	collection: ABSFXCurrentCollection
	approximation: string
}

export interface ABSFXCurrentRuntime {
	gameTime: number
	unpausedTime: number
	textureMipBias: number
	inversePreExposure: number
	preExposure: number
	opacitySuppression?: number
	nativeCullingSign: 1 | -1
	nativePrimitiveDeterminantSign: 1 | -1
	nativeFrontFaceParity: 1 | -1
	collection: ABSFXCurrentCollection
}

export function readFurnitureABSFXCurrent(value: unknown): FurnitureABSFXCurrent | null {
	const p = value as FurnitureABSFXCurrent;
	if (
		!p ||
		p.version !== 1 ||
		p.family !== 'abs-fx-current' ||
		p.uniforms?.length !== 52 ||
		!p.uniforms.every((r) => r.length === 4 && r.every(Number.isFinite)) ||
		!['D', 'D1', 'D2', 'T', 'T1', 'O', 'O1', 'O2', 'S'].every((k) => p.textures?.[k]) ||
		!p.collection
	) return null;

	return p;
}

const declarations = /* glsl */ `
varying vec3 vFXWorld,vFXNormal,vFXPivot;varying vec4 vFXUV;varying vec2 vFXUV2;varying float vFXRadius,vFXInstanceSign;
uniform vec4 fxMaterial[52],fxBaseColor,fxEmissiveColor,fxPost;
uniform sampler2D fxD,fxD1,fxD2,fxT,fxT1,fxO,fxO1,fxO2,fxS;
uniform float fxGameTime,fxUnpausedTime,fxMipBias,fxInversePreExposure,fxPreExposure,fxSaturation,fxGamma;
uniform float fxCullingSign,fxPrimitiveSign,fxFrontParity;uniform bool fxOpacityBound;uniform float fxOpacitySuppression;
${absFxCurrentMath}
vec4 absFxEvaluate(){
  vec2 uv=vFXUV.xy;
  float glintTime=absFxClock(fxMaterial[1].x)*fxMaterial[1].y,time=absFxClock(fxMaterial[4].x);
  float densityDelta=fxMaterial[0].y-fxMaterial[0].z;
  vec3 color=absFxGlint(uv,fxMaterial[0].z+densityDelta*fxMaterial[0].x,glintTime,fxMaterial[1].z)*fxMaterial[3].w;
  vec2 occUV=absFxUV(uv+time*fxMaterial[4].yz,vec2(fxMaterial[4].w,fxMaterial[5].y),vec2(fxMaterial[5].x,fxMaterial[5].z),fxMaterial[5].w);
  float occ=texture2D(fxD,occUV,fxMipBias).g*fxMaterial[6].x;
  vec4 mask=texture2D(fxD1,uv,fxMipBias);
  float emissionMask=(occ+mask.b)*mix(1.0,mask.g,fxMaterial[6].y);
  color*=emissionMask;
  vec2 noiseUV=absFxUV(uv+time*vec2(fxMaterial[7].w,fxMaterial[8].x),fxMaterial[8].yw,vec2(fxMaterial[8].z,fxMaterial[9].x),fxMaterial[9].y);
  float noise=texture2D(fxD2,noiseUV,fxMipBias).g*fxMaterial[9].z*fxMaterial[9].w;
  vec2 eUV=absFxUV(uv+time*fxMaterial[10].yz,vec2(fxMaterial[10].w,fxMaterial[11].y),vec2(fxMaterial[11].x,fxMaterial[11].z),fxMaterial[11].w)-.5;
  eUV=vec2(dot(eUV,fxMaterial[12].xy),dot(eUV,fxMaterial[12].zw))+.5+noise*fxMaterial[10].x;
  vec4 eSample=texture2D(fxT,eUV,fxMipBias);
  vec3 emission=absFxDesaturate(eSample.rgb,fxMaterial[13].x)*fxMaterial[13].y;
  vec2 secondUV=absFxUV(uv+noise*fxMaterial[14].x+time*fxMaterial[13].zw,fxMaterial[14].yw,vec2(fxMaterial[14].z,fxMaterial[15].x),fxMaterial[15].y);
  vec3 second=texture2D(fxT1,secondUV,fxMipBias).rgb;
  float secondLuma=dot(second,vec3(.3,.59,.11));
  float secondMask=mix(1.0,mix(1.0,secondLuma,fxMaterial[15].z),fxMaterial[15].w);
  color+=emissionMask*fxMaterial[7].rgb*emission*secondMask*fxMaterial[16].x;
  vec3 base=absFxPower(mask.g,fxMaterial[16].y)*fxMaterial[17].rgb+mask.b*emission*fxMaterial[18].rgb;
  vec3 secondColor=absFxDesaturate(second,fxMaterial[18].w)*mask.b*fxMaterial[19].rgb*fxMaterial[15].w;
  base=mix(base+secondColor,base+base*secondColor,fxMaterial[19].w);
  float maskedOcc=mix(occ,occ*mask.r,fxMaterial[20].x);
  float occGate=mix(1.0,maskedOcc,fxMaterial[20].y);
  vec2 mainUV=absFxUV(uv+noise*fxMaterial[21].x+time*fxMaterial[20].zw,fxMaterial[21].yw,vec2(fxMaterial[21].z,fxMaterial[22].x),fxMaterial[22].y);
  vec3 main=absFxPower(absFxDesaturate(texture2D(fxO,mainUV,fxMipBias).rgb,fxMaterial[22].z)*fxMaterial[22].w,fxMaterial[23].x);
  color+=base+main*fxMaterial[23].yzw*occGate;
  vec3 view=isOrthographic?-vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]):normalize(cameraPosition-vFXWorld);
  float facing=(gl_FrontFacing?1.0:-1.0)*fxFrontParity*fxCullingSign*fxPrimitiveSign*vFXInstanceSign;
  float ndotv=dot(vFXNormal*facing,view);
  float fresnel=min(absFxPower(abs(mix(1.0-ndotv,ndotv,fxMaterial[24].x)),fxMaterial[24].y),1.0)*fxMaterial[24].z;
  color+=fresnel*fxMaterial[25].rgb;
  vec2 selectedUV=mix(mix(uv,vFXUV.zw,fxMaterial[26].z),vFXUV2,fxMaterial[26].w);
  vec2 dissolveUV=selectedUV*fxMaterial[27].xy+time*fxMaterial[26].xy+fxMaterial[27].zw+noise*fxMaterial[25].w;
  vec4 dissolveSample=textureLod(fxO1,dissolveUV,fxMipBias-1.0)*fxMaterial[28];
  float dissolve=absFxPower(clamp(dot(dissolveSample,vec4(1.0)),0.0,1.0),fxMaterial[29].x)*fxMaterial[29].y;
  float signal=mix(dissolve,selectedUV.x,fxMaterial[29].z)-mix(fxMaterial[30].y,fxMaterial[30].x,fxMaterial[29].w);
  float rim=absFxSmooth(clamp((abs(signal)-fxMaterial[30].z)/(-.01-fxMaterial[30].z),0.0,1.0));
  float poweredRim=absFxPower(rim,fxMaterial[30].w);
  float edge=rim*fxMaterial[32].x+poweredRim;
  float edgeWidth=(signal<0.0?1.0:0.0)*fxMaterial[32].y;
  // Native saturate maps the zero-width 0/0 boundary to zero.
  float sharp=edgeWidth==0.0?0.0:clamp((abs(signal)-edgeWidth)/(-edgeWidth),0.0,1.0);
  float glow=clamp(edge+absFxSmooth(sharp)*fxMaterial[32].z,0.0,1.0);
  float stepped=roundEven(glow*16.0)*.0625;
  vec3 dissolveGlint=absFxGlint(uv,fxMaterial[0].z+densityDelta*stepped,glintTime,clamp(glow*fxMaterial[32].w,0.0,1.0))*glow;
  color+=(dissolveGlint+edge*mix(fxMaterial[34].rgb,fxMaterial[33].rgb,dissolve))*fxMaterial[34].w;
  color*=fxEmissiveColor.a;
  color=absFxDesaturate(color,fxMaterial[35].x)*fxMaterial[35].yzw*fxMaterial[36].x;
  color=absFxDesaturate(color,fxMaterial[36].y)/fxInversePreExposure;
  float breath=absFxPower(sin((time*fxMaterial[36].z+fxMaterial[37].x)*6.283185)*.5+.5,fxMaterial[37].y);
  color*=mix(fxMaterial[37].w,fxMaterial[37].z,breath);
  float average=dot(color,vec3(.333333));
  vec3 post=(color+clamp(fxSaturation+fxPost.x,-1.0,1.0)*(color-average))*fxEmissiveColor.rgb;
  post=absFxPower(post,clamp(fxGamma-fxPost.y,.2,5.0));
  bool todEnabled=abs(fxBaseColor.y-2.0)<=.00001;
  float desat=todEnabled?absFxTODCurve(fxMaterial[38],fxBaseColor.x):0.0;
  post=absFxDesaturate(post,desat)*(todEnabled?absFxTODCurve(fxMaterial[39],fxBaseColor.x):1.0);
  float postWeight=clamp(fxMaterial[40].x,0.0,1.0);
  color=mix(mix(color,post,postWeight),fxMaterial[41].rgb,fxMaterial[40].y);
  vec2 alphaUV=absFxUV(uv+noise*fxMaterial[42].y+time*vec2(fxMaterial[41].w,fxMaterial[42].x),vec2(fxMaterial[42].z,fxMaterial[43].x),vec2(fxMaterial[42].w,fxMaterial[43].y),fxMaterial[43].z);
  float secondOcc=texture2D(fxO2,alphaUV,fxMipBias).r,secondCoverage=secondOcc*fxMaterial[43].w;
  float alpha=(secondCoverage+mix(mask.r,mask.a,fxMaterial[44].x))*fxMaterial[44].y*(1.0+fresnel*fxMaterial[44].z);
  float eMask=clamp(dot(eSample,fxMaterial[45]),0.0,1.0);
  float aMask=mix(1.0,eMask,fxMaterial[46].x);
  alpha*=mix(1.0,(signal+glow)*aMask,fxMaterial[46].y);
  alpha+=secondCoverage*fxMaterial[46].z;
  float extra=maskedOcc*main.r;
  extra=mix(extra,extra*secondCoverage,fxMaterial[46].w);
  alpha+=extra*fxMaterial[47].x;
  // Unbound is permitted only in the exact runtime collection-alpha-zero domain.
  if(fxOpacityBound)alpha*=fxBaseColor.a*clamp(1.0-fxOpacitySuppression,0.0,1.0);else alpha=0.0;
  alpha*=mix(fxMaterial[47].z,fxMaterial[47].y,breath)*fxMaterial[47].w;
  alpha=mix(alpha,alpha*min(max(fxPost.z,1.0),fxMaterial[48].x),postWeight);
  float dissolveMap=texture2D(fxS,uv*fxMaterial[48].y).r;
  float radial=clamp(length(vFXWorld-vFXPivot)/(vFXRadius*fxMaterial[49].w),0.0,1.0);
  radial=mix(radial,1.0-radial,fxMaterial[50].x);
  radial=clamp(radial-dissolveMap*fxMaterial[50].y,0.0,1.0);
  radial=mix(dissolveMap,radial,fxMaterial[50].z)-fxMaterial[50].w;
  float spatial=absFxSmooth(clamp((radial-fxMaterial[51].x)/(-fxMaterial[51].x),0.0,1.0));
  float coverage=clamp(alpha*spatial,0.0,1.0);
  // Grey-transmittance current PS applies the same loose input again at o0.w, without saturating this final factor.
  if(fxOpacityBound)coverage*=1.0-fxOpacitySuppression;
  return vec4(max(color,0.0)*fxPreExposure,coverage);
}
`;

export function createABSFXCurrentMaterial(
	p: FurnitureABSFXCurrent,
	sources: Partial<Record<string, Texture | null>>,
	runtime: ABSFXCurrentRuntime,
	update: MeshBasicMaterial['onBeforeRender'],
): MeshBasicMaterial {
	if (!readFurnitureABSFXCurrent(p)) throw new Error('[ABSFX] actual current source profile required');

	const uniforms: Record<string, { value: unknown }> = {
		fxMaterial: { value: p.uniforms.map((r) => new Vector4().fromArray(r)) },
		fxOpacitySuppression: { value: NaN },
	};

	const clones: Texture[] = [];

	const wrap = (value: string) => {
		switch (value) {
		case 'TA_Wrap':
			return RepeatWrapping;
		case 'TA_Clamp':
			return ClampToEdgeWrapping;
		case 'TA_Mirror':
			return MirroredRepeatWrapping;
		default:
			throw new Error('[ABSFX] native sampler required');
		}
	};

	for (const [role, contract] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source?.isTexture) throw new Error(`[ABSFX] actual ${role} RGBA source required`);

		const texture = source.clone();
		texture.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = wrap(contract.addressX);
		texture.wrapT = wrap(contract.addressY);
		texture.generateMipmaps = contract.mipmaps;
		texture.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = contract.mipmaps
			? contract.nearest
				? NearestMipmapNearestFilter
				: LinearMipmapLinearFilter
			: texture.magFilter;
		texture.needsUpdate = true;
		clones.push(texture);
		uniforms[`fx${role}`] = { value: texture };
	}

	const material = new MeshBasicMaterial({
		transparent: true,
		depthWrite: false,
		blending: NormalBlending,
		side: p.twoSided ? DoubleSide : FrontSide,
	});
	material.forceSinglePass = true;

	const refresh = () => {
		const c = runtime.collection;

		const values = [
			runtime.gameTime,
			runtime.unpausedTime,
			runtime.textureMipBias,
			runtime.inversePreExposure,
			runtime.preExposure,
			c.saturation,
			c.gamma,
			...c.baseColor,
			...c.emissiveColor,
			...c.post,
		];

		if (
			!values.every(Number.isFinite) ||
			runtime.inversePreExposure <= 0 ||
			runtime.preExposure <= 0
		) throw new Error('[ABSFX] explicit actual clocks/View/collection required');

		const binding = absFxCurrentCoverageBinding(c.baseColor[3], runtime.opacitySuppression);

		const fields: Record<string, unknown> = {
			fxGameTime: runtime.gameTime,
			fxUnpausedTime: runtime.unpausedTime,
			fxMipBias: runtime.textureMipBias,
			fxInversePreExposure: runtime.inversePreExposure,
			fxPreExposure: runtime.preExposure,
			fxSaturation: c.saturation,
			fxGamma: c.gamma,
			fxBaseColor: new Vector4().fromArray(c.baseColor),
			fxEmissiveColor: new Vector4().fromArray(c.emissiveColor),
			fxPost: new Vector4().fromArray(c.post),
			fxCullingSign: runtime.nativeCullingSign,
			fxPrimitiveSign: runtime.nativePrimitiveDeterminantSign,
			fxFrontParity: runtime.nativeFrontFaceParity,
			fxOpacityBound: binding.bound,
		};

		fields.fxOpacitySuppression = binding.bound ? binding.suppression : NaN;
		for (const [key, value] of Object.entries(fields)) {
			if (uniforms[key]) uniforms[key]!.value = value;
			else uniforms[key] = { value };
		}
	};

	material.userData.absFxCurrent = p;
	material.userData.absFxCurrentUniforms = uniforms;
	material.userData.absFxCurrentRefreshUniforms = refresh;
	material.onBeforeRender = update;
	refresh();
	material.onBeforeCompile = (shader) => {
		refresh();
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec3 absFxNativeNormal,absFxDissolvePivot;attribute vec2 absFxUV1,absFxUV2;attribute vec4 absFxPrimitiveBounds;
varying vec3 vFXWorld,vFXNormal,vFXPivot;varying vec4 vFXUV;varying vec2 vFXUV2;varying float vFXRadius,vFXInstanceSign;`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
mat4 fxWorld=modelMatrix;vFXInstanceSign=1.0;
#ifdef USE_INSTANCING
fxWorld=fxWorld*instanceMatrix;vFXInstanceSign=sign(determinant(mat3(instanceMatrix)));
#endif
mat3 fxFrame=mat3(normalize(fxWorld[0].xyz),normalize(fxWorld[1].xyz),normalize(fxWorld[2].xyz));
vFXNormal=fxFrame*absFxNativeNormal;vFXWorld=(fxWorld*vec4(transformed,1.0)).xyz;vFXPivot=(fxWorld*vec4(absFxDissolvePivot,1.0)).xyz;
vFXRadius=absFxPrimitiveBounds.w*max(max(length(fxWorld[0].xyz),length(fxWorld[1].xyz)),length(fxWorld[2].xyz));vFXUV=vec4(uv,absFxUV1);vFXUV2=absFxUV2;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${declarations}`)
			.replace('#include <map_fragment>', 'diffuseColor=absFxEvaluate();');
	};
	material.customProgramCacheKey = () => `abs-fx-current:${p.twoSided}`;
	material.addEventListener('dispose', () => clones.forEach((t) => t.dispose()));
	return material;
}
