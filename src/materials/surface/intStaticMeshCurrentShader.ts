import {
	ClampToEdgeWrapping,
	DoubleSide,
	FrontSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshPhysicalMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NearestMipmapNearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector3,
	Vector4,
	type Texture,
} from 'three';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';
import { intStaticMeshCurrentMath } from './intStaticMeshCurrentSource.js';

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

export interface FurnitureIntStaticMeshCurrent {
	collection: {
		ready: number
		limitedDirection: [number, number, number]
		sunColor: [number, number, number]
		swapLightFactor: number
		globalFactor: number
		glintMode: number
	}
	variant:
		| 'coating'
		| 'coating-matcap'
		| 'pattern'
		| 'pattern-matcap'
		| 'pattern-layer'
		| 'pattern-layer-glint'
	version: 1
	family: 'int-static-mesh-current'
	uniforms: number[][]
	textures: Record<string, SourceTexture>
	requiredUV: number[]
	twoSided: boolean
	approximation: string
}

export interface IntStaticMeshCurrentRuntime {
	primaryDirection: [number, number, number]
	primaryColor: [number, number, number]
	ready: number
	limitedDirection: [number, number, number]
	sunColor: [number, number, number]
	normalOverride: [number, number, number, number]
	preExposure: number
	nativeCullingSign: 1 | -1
	nativePrimitiveDeterminantSign: 1 | -1
	nativeFrontFaceParity: 1 | -1
	gameTime?: number
	unpausedTime?: number
	textureMipBias?: number
	timeOfDayHours?: number
	swapLightFactor?: number
	globalFactor?: number
	glintMode?: number
}

export function readFurnitureIntStaticMeshCurrent(value: unknown): FurnitureIntStaticMeshCurrent | null {
	const p = value as FurnitureIntStaticMeshCurrent;
	const count = {
		coating: 12,
		'coating-matcap': 14,
		pattern: 17,
		'pattern-matcap': 20,
		'pattern-layer': 21,
		'pattern-layer-glint': 34,
	}[p?.variant];
	if (
		!p ||
		p.version !== 1 ||
		p.family !== 'int-static-mesh-current' ||
		!count ||
		p.uniforms?.length !== count ||
		!p.uniforms.every((r) => r.length === 4 && r.every(Number.isFinite)) ||
		!['N', 'N1', 'O', 'T', 'D', 'S'].every((role) => p.textures?.[role]) ||
		!p.collection ||
		![
			p.collection.ready,
			p.collection.swapLightFactor,
			p.collection.globalFactor,
			p.collection.glintMode,
			...p.collection.limitedDirection,
			...p.collection.sunColor,
		].every(Number.isFinite)
	) return null;

	const required = ['N', 'N1', 'O', 'T', 'D', 'S'];
	if (p.variant !== 'coating' && p.variant !== 'coating-matcap')
		required.push('N2', 'D1', 'T1', 'O2');

	if (
		p.variant === 'coating-matcap' ||
		p.variant === 'pattern-matcap' ||
		p.variant === 'pattern-layer-glint'
	)
		required.push('O1');

	if (p.variant === 'pattern-layer' || p.variant === 'pattern-layer-glint') required.push('M', 'D2');
	if (p.variant === 'pattern-layer-glint') required.push('B');
	if (!required.every((role) => p.textures[role]) || !p.textures.S!.cube) return null;

	return p;
}

const declarations = /* glsl */ `
${nativeWorldFrameGLSL}
${intStaticMeshCurrentMath}
varying vec3 vISWorld,vISTangent,vISNormal; varying vec4 vISUV,vISUV23; varying float vISSign,vISInstanceSign;
uniform vec4 isMaterial[IS_COUNT],isNormalOverride;
INT_STATIC_SAMPLERS
uniform vec3 isPrimaryDirection,isPrimaryColor,isLimitedDirection,isSunColor;
uniform float isReady,isPreExposure,isCullingSign,isPrimitiveSign,isFrontParity,isCubeScale;
uniform float isGameTime,isUnpausedTime,isMipBias,isTODHours,isSwapLightFactor,isGlobalFactor,isGlintMode;
vec3 isNormal,isBase,isEmission; float isMetalness,isRoughness,isSpecular,isAO;
#if IS_COUNT==12 || IS_COUNT==14
void intStaticEvaluateBase() {
  vec3 view=isOrthographic?furnitureNativeWorld(-vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])):furnitureNativeWorld(normalize(cameraPosition-vISWorld));
  vec3 t=furnitureNativeWorld(vISTangent),n=furnitureNativeWorld(vISNormal),b=cross(n,t)*vISSign;
  vec2 detailUV=mix(vISUV.xy,vISUV.zw,isMaterial[0].z)*isMaterial[1].xy;
  vec3 rn=intStaticRNM(texture2D(isN,vISUV.xy).rg,texture2D(isN1,detailUV).rg,isMaterial[0],isMaterial[1]);
  rn=normalize(rn*isNormalOverride.w+isNormalOverride.xyz);
  float facing=(gl_FrontFacing?1.0:-1.0)*isFrontParity*isCullingSign*isPrimitiveSign*vISInstanceSign;
  isNormal=normalize(mat3(t,b,n)*rn)*facing;
  vec4 attr=texture2D(isO,vISUV.xy);
  float ndotv=dot(isNormal,view),front=max(ndotv,0.0),edge=max(abs(1.0-front),.0001);
  float edgeValue=1.0-min(front,1.0);
  float edgePower=edgeValue<=0.0?0.0:exp2(log2(edgeValue)*isMaterial[3].x);
  vec3 edgeColor=(1.0+(attr.a-1.0)*isMaterial[2].x)*isMaterial[2].yzw*edgePower;
  float coat=exp2(log2(edge)*isMaterial[4].w)*isMaterial[5].x+isMaterial[5].y;
  coat+=(1.0-2.0*coat)*isMaterial[5].z;
  vec3 reflection=2.0*ndotv*isNormal-view;
  vec2 cubeUV=vec2(fract(atan(-reflection.x,-reflection.z)/6.28318530718),1.0-acos(clamp(reflection.y,-1.0,1.0))/3.14159265359);
  vec3 coating=coat*isMaterial[6].rgb*texture2D(isS,cubeUV).rgb*isCubeScale*attr.a;
  vec4 emissive=texture2D(isT,vISUV.xy);
  vec3 emission=emissive.rgb*emissive.a*isMaterial[4].rgb+edgeColor*isMaterial[3].y+coating*max(isMaterial[6].w,1.0)*isMaterial[7].x;
  bool mpc=abs(isReady)>.00001 && isReady>=0.0;
  vec3 light=max(mpc?isSunColor:isPrimaryColor,vec3(.12));
  vec3 dir=mpc?isLimitedDirection:isPrimaryDirection;
  light=clamp(mix(light,vec3(dot(light,vec3(.3,.59,.11))),.35),.1,1.0);
  emission*=mix(vec3(1.0),light*max(dot(isNormal,dir),isMaterial[7].y),isMaterial[7].z);
  if(isPreExposure>1.0) emission/=max(.1,mix(1.0,isPreExposure,isMaterial[7].w));
  isEmission=max(mix(emission,isMaterial[8].yzw,isMaterial[8].x),0.0);
  vec3 albedo=texture2D(isD,vISUV.xy).rgb*isMaterial[9].rgb;
#if IS_COUNT==14
  vec3 viewGL=mat3(viewMatrix)*vec3(view.x,-view.y,view.z),normalGL=mat3(viewMatrix)*vec3(isNormal.x,-isNormal.y,isNormal.z);
  vec2 matcapUV=intStaticMatcapUV(vec3(viewGL.xy,-viewGL.z),vec3(normalGL.xy,-normalGL.z));
  vec3 capSample=texture2D(isO1,matcapUV).rgb;
  vec3 cap=capSample*mix(isMaterial[10].rgb,isMaterial[11].rgb,clamp(dot(isNormal,dir),0.0,1.0));
  vec3 combined=mix(albedo+cap,albedo*cap,isMaterial[11].w);
  isBase=clamp(mix(albedo,combined,isMaterial[12].x)+edgeColor+coating,0.0,1.0);
  isMetalness=clamp(mix(isMaterial[12].z,isMaterial[12].y,attr.r),0.0,1.0);
  isRoughness=clamp(1.0-mix(isMaterial[13].x,isMaterial[12].w,attr.g),0.0,1.0);
  isSpecular=clamp(isMaterial[13].y,0.0,1.0);isAO=clamp(isMaterial[13].z,0.0,1.0);
#else
  isBase=clamp(albedo+edgeColor+coating,0.0,1.0);
  isMetalness=clamp(mix(isMaterial[10].x,isMaterial[9].w,attr.r),0.0,1.0);
  isRoughness=clamp(1.0-mix(isMaterial[10].z,isMaterial[10].y,attr.g),0.0,1.0);
  isSpecular=clamp(isMaterial[10].w,0.0,1.0);isAO=clamp(isMaterial[11].x,0.0,1.0);
#endif
}
#endif
`;

const extendedDeclarations = /* glsl */ `
vec3 isCubeSample(vec3 r){vec2 uv=vec2(fract(atan(-r.x,-r.z)/6.28318530718),1.0-acos(clamp(r.y,-1.0,1.0))/3.14159265359);return texture2D(isS,uv).rgb*isCubeScale;}
vec3 isRNMPattern(vec3 base,vec2 rg,vec4 p){
  vec3 a=mix(vec3(0.0,0.0,1.0),base,isMaterial[2].x);a.z+=1.0;
  vec2 xy=rg*2.0-1.0;vec3 b=vec3(-xy*p.z,sqrt(1.0-min(dot(xy*p.w,xy*p.w),1.0)));
  return a*dot(a,b)-a.z*b;
}
vec3 isLitEmission(vec3 e,vec3 normal,vec3 dir,vec3 light,vec4 p){
  light=clamp(mix(max(light,vec3(.12)),vec3(dot(max(light,vec3(.12)),vec3(.3,.59,.11))),.35),.1,1.0);
  return e*mix(vec3(1.0),light*max(dot(normal,dir),p.y),p.z);
}
#if IS_COUNT==34
vec3 isActiveGlint(vec3 color,vec3 view,vec3 n,vec3 primitiveN,vec3 dir,float ndotv,float ndotl){
  vec2 first=mix(vISUV.xy,vISUV.zw,isMaterial[8].x);
  float mask=texture2D(isB,first,isMipBias).r;
  vec2 cells=mix(vISUV.xy,vISUV.zw,isMaterial[8].z)*isMaterial[9].xy;
  vec3 h=fract(floor(cells).xyx*vec3(.114286,.152381,.123810));h+=dot(h.zyx,h.yzx+33.330002);h=fract(h*(h.yxx+h.zzy));
  vec3 c=h*(vec3(.5,1.2,1.5)+isMaterial[8].y*vec3(.5,-.5,-.5));
  c=clamp(c+(vec3(dot(c,vec3(.3,.59,.11)))-c)*(-10.0),0.0,1.0);
  c=mix(vec3(1.0),c,isMaterial[9].z)*isMaterial[10].rgb;
  color=mix(c,c*color,isMaterial[18].w);
  float radius=mix(isMaterial[19].y,isMaterial[19].x,h.y)*.5;
  float circle=length(fract(cells)-.5)<=radius?1.0:0.0;
  float angle=dot(normalize(view+dir),primitiveN)+mod(isUnpausedTime,60.0)*isMaterial[19].w+h.y;
  float phase=abs(fract(angle*isMaterial[20].x)-.5)*2.0;
  float shape=intStaticGlintShape(phase,isMaterial[20].y);
  vec3 glint=circle*h.y*isMaterial[19].z*shape*mask*color;
  float edgeWeight=intStaticGlintEdge(ndotv,isMaterial[21].x);
  glint*=mix(isMaterial[20].z,isMaterial[20].w,edgeWeight)*mix(isMaterial[21].y,1.0,clamp(ndotl,0.0,1.0));
  glint*=isMaterial[21].z*clamp((isSwapLightFactor+1.0)*.5+isMaterial[21].w,0.0,1.0);
  float peak=max(max(glint.x,max(glint.y,glint.z)),.001);vec3 chroma=glint/peak;
  float triangle=1.0-abs(isTODHours/12.0-1.0);
  float day=triangle<=0.0?0.0:min(4.0*exp2(log2(triangle)*isMaterial[0].x),1.0);
  vec3 unit=glint*inversesqrt(max(dot(glint,glint),.001));
  switch(int(isGlintMode)){
    case 5:glint*=mix(isMaterial[22].z,mix(isMaterial[22].y,isMaterial[22].x,day),isGlobalFactor);break;
    case 1:glint=min(unit*((isSwapLightFactor+1.0)*25.0+50.0),glint*isMaterial[22].w);break;
    case 9:glint=min(glint,unit*isMaterial[23].x);break;
    case 11:glint=chroma*min(peak,99999.0);break;
    case 10:glint=chroma*min(peak,15.0);break;
  }
  return glint;
}
#endif
#if IS_COUNT!=12 && IS_COUNT!=14
void intStaticEvaluateExtended(){
  vec3 view=isOrthographic?furnitureNativeWorld(-vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])):furnitureNativeWorld(normalize(cameraPosition-vISWorld));
  vec3 t=furnitureNativeWorld(vISTangent),n=furnitureNativeWorld(vISNormal),b=cross(n,t)*vISSign;
  vec2 detailUV=mix(vISUV.xy,vISUV.zw,isMaterial[0].z)*isMaterial[1].xy;
  vec3 rn=intStaticRNM(texture2D(isN,vISUV.xy).rg,texture2D(isN1,detailUV).rg,isMaterial[0],isMaterial[1]);
  vec2 patternUV=(vISUV.xy*isMaterial[2].y+vISUV.zw*isMaterial[2].z+vISUV23.xy*isMaterial[2].w+vISUV23.zw*isMaterial[3].x)*isMaterial[3].yz+isMaterial[4].xy;
  vec4 pattern=texture2D(isD1,patternUV);rn=mix(rn,isRNMPattern(rn,texture2D(isN2,patternUV).rg,isMaterial[4]),pattern.a);
  vec4 layer=vec4(0.0);vec3 layerWeights=vec3(0.0);
#if IS_COUNT==21 || IS_COUNT==34
  vec2 layerUV=(vISUV.xy*isMaterial[5].x+vISUV.zw*isMaterial[5].y+vISUV23.xy*isMaterial[5].z+vISUV23.zw*isMaterial[5].w)*isMaterial[6].xy+isMaterial[6].zw;
  layerUV-=.6*isMaterial[7].x*vec2(dot(t,view),dot(b,view));
  vec2 layerRG=texture2D(isM,layerUV).rg*2.0-1.0;
  layer=texture2D(isD2,layerUV);layerWeights=clamp(layer.a*isMaterial[7].yzw,0.0,1.0);
  rn=mix(rn,vec3(layerRG,sqrt(max(1.0-dot(layerRG,layerRG),0.0))),layerWeights.z);
#endif
  rn=normalize(rn*isNormalOverride.w+isNormalOverride.xyz);isNormal=normalize(mat3(t,b,n)*rn);
#if IS_COUNT==34
  isNormal*=(gl_FrontFacing?1.0:-1.0)*isFrontParity*isCullingSign*isPrimitiveSign*vISInstanceSign;
#endif
  bool mpc=abs(isReady)>.00001&&isReady>=0.0;vec3 dir=mpc?isLimitedDirection:isPrimaryDirection,light=mpc?isSunColor:isPrimaryColor;
  float ndotv=dot(isNormal,view),front=max(ndotv,0.0),edge=max(abs(1.0-front),.0001),edgeValue=1.0-min(front,1.0);
  vec4 attr=texture2D(isO,vISUV.xy),edgeParams,coatParams,coatTint,litParams,forced;vec3 edgeTint,emissiveTint,patternEmissionTint,albedoTint;
  float edgePower,edgeEmission,coatPower,coatEmission;
#if IS_COUNT==17 || IS_COUNT==20
  edgeParams=isMaterial[5];edgeTint=edgeParams.yzw;edgePower=isMaterial[6].x;edgeEmission=isMaterial[6].y;
  emissiveTint=isMaterial[7].rgb;patternEmissionTint=isMaterial[8].rgb;coatPower=isMaterial[8].w;coatParams=isMaterial[9];coatTint=isMaterial[10];
  coatEmission=isMaterial[11].x;litParams=isMaterial[11];forced=isMaterial[12];albedoTint=isMaterial[13].rgb;
#elif IS_COUNT==21
  edgeParams=vec4(isMaterial[8].y,isMaterial[9].rgb);edgeTint=isMaterial[9].rgb;edgePower=isMaterial[9].w;edgeEmission=isMaterial[10].x;
  emissiveTint=isMaterial[10].yzw;patternEmissionTint=isMaterial[11].rgb;coatPower=isMaterial[12].x;coatParams=isMaterial[12].yzwx;coatTint=isMaterial[13];
  coatEmission=isMaterial[14].x;litParams=isMaterial[14];forced=isMaterial[15];albedoTint=isMaterial[16].rgb;
#else
  edgeParams=vec4(isMaterial[16].y,isMaterial[17].rgb);edgeTint=isMaterial[17].rgb;edgePower=isMaterial[17].w;edgeEmission=isMaterial[23].z;
  emissiveTint=isMaterial[24].rgb;patternEmissionTint=isMaterial[25].rgb;coatPower=isMaterial[10].w;coatParams=isMaterial[11];coatTint=isMaterial[12];
  coatEmission=isMaterial[26].y;litParams=vec4(coatEmission,isMaterial[26].zw,isMaterial[27].x);forced=vec4(isMaterial[27].y,isMaterial[28].rgb);albedoTint=isMaterial[13].rgb;
#endif
  float rim=edgeValue<=0.0?0.0:exp2(log2(edgeValue)*edgePower);
  vec3 edgeColor=(1.0+(attr.a-1.0)*edgeParams.x)*edgeTint*rim;
  float coat=exp2(log2(edge)*coatPower)*coatParams.x+coatParams.y;coat+=(1.0-2.0*coat)*coatParams.z;
  vec3 coating=coat*coatTint.rgb*isCubeSample(2.0*ndotv*isNormal-view)*attr.a;
  vec4 e=texture2D(isT,vISUV.xy),pe=texture2D(isT1,patternUV);
  vec3 emission=e.rgb*e.a*emissiveTint+edgeColor*edgeEmission+pe.rgb*pe.a*patternEmissionTint;
#if IS_COUNT==21
  emission=mix(layer.rgb*isMaterial[8].x,emission,isMaterial[11].w);
#elif IS_COUNT==34
  emission=mix(layer.rgb*isMaterial[23].y,emission,isMaterial[25].w);
#endif
#if IS_COUNT==34
  emission+=coating*max(isMaterial[26].x,1.0)*coatEmission;
#else
  emission+=coating*max(coatTint.a,1.0)*coatEmission;
#endif
  emission=isLitEmission(emission,isNormal,dir,light,litParams);
  vec3 albedo=texture2D(isD,vISUV.xy).rgb*albedoTint,cap=vec3(0.0);
#if IS_COUNT==20 || IS_COUNT==34
  vec3 viewGL=mat3(viewMatrix)*vec3(view.x,-view.y,view.z),normalGL=mat3(viewMatrix)*vec3(isNormal.x,-isNormal.y,isNormal.z);
  vec3 c=texture2D(isO1,intStaticMatcapUV(vec3(viewGL.xy,-viewGL.z),vec3(normalGL.xy,-normalGL.z))).rgb;
  cap=c*mix(isMaterial[14].rgb,isMaterial[15].rgb,clamp(dot(isNormal,dir),0.0,1.0));
  albedo=mix(albedo,mix(albedo+cap,albedo*cap,isMaterial[15].w),isMaterial[16].x);
#endif
  vec3 color=albedo+edgeColor;
#if IS_COUNT==17
  vec3 paint=mix(pattern.rgb,pattern.rgb*color,isMaterial[13].w);color=mix(color,paint,pattern.a*isMaterial[14].x);
  vec2 mg=vec2(mix(isMaterial[14].z,isMaterial[14].y,attr.r),mix(isMaterial[15].x,isMaterial[14].w,attr.g));
  vec3 patM=texture2D(isO2,patternUV).rgb;mg=mix(mg,vec2(mix(patM.r,patM.b,isMaterial[15].y),patM.g),pattern.a*isMaterial[15].z);
  isSpecular=isMaterial[15].w;isAO=isMaterial[16].y;
#elif IS_COUNT==20
  vec3 paint=mix(pattern.rgb,mix(pattern.rgb+cap,pattern.rgb*cap,isMaterial[15].w),isMaterial[16].y);
  paint=mix(paint,paint*color,isMaterial[16].z);color=mix(color,paint,pattern.a*isMaterial[16].w);
  vec2 mg=vec2(mix(isMaterial[17].y,isMaterial[17].x,attr.r),mix(isMaterial[17].w,isMaterial[17].z,attr.g));
  vec3 patM=texture2D(isO2,patternUV).rgb;mg=mix(mg,vec2(mix(patM.r,patM.b,isMaterial[18].x),patM.g),pattern.a*isMaterial[18].y);
  isSpecular=isMaterial[18].z;isAO=isMaterial[19].x;
#elif IS_COUNT==21
  vec3 paint=mix(pattern.rgb,pattern.rgb*color,isMaterial[16].w);color=mix(color,paint,pattern.a*isMaterial[17].x);color=mix(color,layer.rgb,layerWeights.x);
  vec2 mg=vec2(mix(isMaterial[17].z,isMaterial[17].y,attr.r),mix(isMaterial[18].x,isMaterial[17].w,attr.g));
  vec3 patM=texture2D(isO2,patternUV).rgb;mg=mix(mg,vec2(mix(patM.r,patM.b,isMaterial[18].y),patM.g),pattern.a*isMaterial[18].z);
  mg=vec2(mix(mg.x,isMaterial[19].x,layerWeights.y),1.0-mix(1.0-mg.y,isMaterial[19].y,layerWeights.y));
  isSpecular=isMaterial[19].w;isAO=isMaterial[20].x;
#else
  vec3 paint=mix(pattern.rgb,mix(pattern.rgb+cap,pattern.rgb*cap,isMaterial[15].w),isMaterial[18].x);
  paint=mix(paint,paint*color,isMaterial[18].y);color=mix(color,paint,pattern.a*isMaterial[18].z);color=mix(color,layer.rgb,layerWeights.x);
  color+=coating;
  vec3 glint=isActiveGlint(color,view,isNormal,n,dir,ndotv,dot(isNormal,dir));
  emission+=glint;
  color+=glint*isMaterial[28].w;
  vec2 mg=vec2(mix(isMaterial[29].y,isMaterial[29].x,attr.r),mix(isMaterial[29].w,isMaterial[29].z,attr.g));
  vec3 patM=texture2D(isO2,patternUV).rgb;mg=mix(mg,vec2(mix(patM.r,patM.b,isMaterial[30].x),patM.g),pattern.a*isMaterial[30].y);
  mg=vec2(mix(mg.x,isMaterial[32].x,layerWeights.y),1.0-mix(1.0-mg.y,isMaterial[32].y,layerWeights.y));
  isSpecular=isMaterial[32].w;isAO=isMaterial[33].x;
#endif
#if IS_COUNT!=34
  color+=coating;
#endif
  if(isPreExposure>1.0)emission/=max(.1,mix(1.0,isPreExposure,litParams.w));
  isEmission=max(mix(emission,forced.yzw,forced.x),0.0);isBase=clamp(color,0.0,1.0);
  isMetalness=clamp(mg.x,0.0,1.0);isRoughness=clamp(1.0-mg.y,0.0,1.0);isSpecular=clamp(isSpecular,0.0,1.0);isAO=clamp(isAO,0.0,1.0);
}
#endif
void intStaticEvaluate(){
#if IS_COUNT==12 || IS_COUNT==14
  intStaticEvaluateBase();
#else
  intStaticEvaluateExtended();
#endif
}
`;

export function createIntStaticMeshCurrentMaterial(
	p: FurnitureIntStaticMeshCurrent,
	sources: Partial<Record<string, Texture | null>>,
	runtime: IntStaticMeshCurrentRuntime,
	update: MeshPhysicalMaterial['onBeforeRender'],
): MeshPhysicalMaterial {
	if (!readFurnitureIntStaticMeshCurrent(p)) throw new Error('[IntStaticMesh] actual current source profile required');

	const uniforms: Record<string, { value: unknown }> = {
		isMaterial: { value: p.uniforms.map((r) => new Vector4().fromArray(r)) },
		isCubeScale: { value: p.textures.S!.rgbScale },
	};

	const clones: Texture[] = [];
	const samplers = new Map<string, { role: string; texture: Texture }>();
	const samplerRoles: string[] = [];
	const samplerAliases: string[] = [];

	const wrap = (value: string) => {
		switch (value) {
		case 'TA_Wrap':
			return RepeatWrapping;
		case 'TA_Clamp':
			return ClampToEdgeWrapping;
		case 'TA_Mirror':
			return MirroredRepeatWrapping;
		default:
			throw new Error('[IntStaticMesh] native sampler required');
		}
	};

	for (const [role, contract] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source?.isTexture) throw new Error(`[IntStaticMesh] actual ${role} source required`);
		// Sampling coordinates/bias remain at each call site. Identical image and
		// sampler state need one uniform, not one fragment texture unit per role.
		const key = JSON.stringify([
			source.source.uuid,
			source.type,
			source.format,
			source.internalFormat,
			source.flipY,
			source.premultiplyAlpha,
			source.unpackAlignment,
			source.anisotropy,
			contract.sRGB,
			contract.addressX,
			contract.addressY,
			contract.mipmaps,
			contract.nearest,
		]);
		const shared = samplers.get(key);
		if (shared) {
			uniforms[`is${role}`] = { value: shared.texture };
			samplerAliases.push(`#define is${role} is${shared.role}`);
			continue;
		}

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
		uniforms[`is${role}`] = { value: texture };
		samplers.set(key, { role, texture });
		samplerRoles.push(`is${role}`);
	}

	const samplerDeclarations = `uniform sampler2D ${samplerRoles.join(',')};\n${samplerAliases.join('\n')}`;
	const material = new MeshPhysicalMaterial({ side: p.twoSided ? DoubleSide : FrontSide });

	const refresh = () => {
		const values = [
			runtime.ready,
			runtime.preExposure,
			...runtime.primaryDirection,
			...runtime.primaryColor,
			...runtime.limitedDirection,
			...runtime.sunColor,
			...runtime.normalOverride,
		];

		if (!values.every(Number.isFinite) || runtime.preExposure <= 0) throw new Error('[IntStaticMesh] explicit actual View/MPC environment required');
		if (
			p.variant === 'pattern-layer-glint' &&
			![
				runtime.gameTime,
				runtime.unpausedTime,
				runtime.textureMipBias,
				runtime.timeOfDayHours,
				runtime.swapLightFactor,
				runtime.globalFactor,
				runtime.glintMode,
			].every(Number.isFinite)
		) throw new Error('[IntStaticMesh] actual dual editor clocks/manual TOD and source MPC glint fields required');

		const fields: Record<string, unknown> = {
			isPrimaryDirection: new Vector3().fromArray(runtime.primaryDirection),
			isPrimaryColor: new Vector3().fromArray(runtime.primaryColor),
			isLimitedDirection: new Vector3().fromArray(runtime.limitedDirection),
			isSunColor: new Vector3().fromArray(runtime.sunColor),
			isReady: runtime.ready,
			isPreExposure: runtime.preExposure,
			isNormalOverride: new Vector4().fromArray(runtime.normalOverride),
			isCullingSign: runtime.nativeCullingSign,
			isPrimitiveSign: runtime.nativePrimitiveDeterminantSign,
			isFrontParity: runtime.nativeFrontFaceParity,
		};

		Object.assign(fields, {
			isGameTime: runtime.gameTime,
			isUnpausedTime: runtime.unpausedTime,
			isMipBias: runtime.textureMipBias,
			isTODHours: runtime.timeOfDayHours,
			isSwapLightFactor: runtime.swapLightFactor,
			isGlobalFactor: runtime.globalFactor,
			isGlintMode: runtime.glintMode,
		});
		for (const [key, value] of Object.entries(fields)) {
			if (uniforms[key]) uniforms[key]!.value = value;
			else uniforms[key] = { value };
		}
	};

	material.userData.intStaticMeshCurrent = p;
	material.userData.intStaticMeshCurrentRefreshUniforms = refresh;
	material.userData.intStaticMeshCurrentUniforms = uniforms;
	material.onBeforeRender = update;
	refresh();
	material.onBeforeCompile = (shader) => {
		refresh();
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec4 intStaticNativeTangent;attribute vec3 intStaticNativeNormal;attribute vec2 intStaticUV1;
attribute vec4 intStaticUV23;
varying vec3 vISWorld,vISTangent,vISNormal;varying vec4 vISUV,vISUV23;varying float vISSign,vISInstanceSign;`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
mat4 isWorld=modelMatrix;vISInstanceSign=1.0;
#ifdef USE_INSTANCING
isWorld=isWorld*instanceMatrix;vISInstanceSign=sign(determinant(mat3(instanceMatrix)));
#endif
mat3 isUnscaled=mat3(normalize(isWorld[0].xyz),normalize(isWorld[1].xyz),normalize(isWorld[2].xyz));
vISWorld=(isWorld*vec4(transformed,1.0)).xyz;vISTangent=isUnscaled*intStaticNativeTangent.xyz;vISNormal=isUnscaled*intStaticNativeNormal;
vISSign=-intStaticNativeTangent.w*sign(determinant(mat3(isWorld)));vISUV=vec4(uv,intStaticUV1);vISUV23=intStaticUV23;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>\n#define IS_COUNT ${p.uniforms.length}\n${declarations.replace('INT_STATIC_SAMPLERS', samplerDeclarations)}\n${extendedDeclarations}`,
			)
			.replace('#include <map_fragment>', 'intStaticEvaluate();diffuseColor=vec4(isBase,1.0);')
			.replace(
				'#include <normal_fragment_maps>',
				'normal=mat3(viewMatrix)*vec3(isNormal.x,-isNormal.y,isNormal.z);',
			)
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=max(isRoughness,.0525);')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor=isMetalness;')
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=isEmission;')
			.replace(
				'#include <lights_physical_fragment>',
				`#include <lights_physical_fragment>
material.specularColor=vec3(.08*isSpecular);material.specularColorBlended=mix(material.specularColor,diffuseColor.rgb,metalnessFactor);`,
			)
			.replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse*=isAO;');
	};
	material.customProgramCacheKey = () => `int-static-mesh-current:${p.variant}:${p.twoSided}:${samplerDeclarations}`;
	material.addEventListener('dispose', () => clones.forEach((t) => t.dispose()));
	return material;
}
