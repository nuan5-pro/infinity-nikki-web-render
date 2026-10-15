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
import { characterJewelNativeMath, type CharacterJewelLighting } from './characterJewelSource.js';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

interface CharacterTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureCharacterJewel {
	collection: {
		ready: number;
		aaMethod: number;
		globalFactor: number;
		fillIntensity: number;
		fillSkyColor: [number, number, number];
		fillGroundColor: [number, number, number];
		resolvedSunColor: [number, number, number];
		dirLightVectorLimited: [number, number, number];
	};
	version: 1;
	family: 'character-jewel-current';
	uniforms: number[][];
	textures: Record<string, CharacterTexture>;
	requiredUV: number[];
	twoSided: boolean;
	variant: 'surface' | 'vfx-base-attenuation';
	vertexFactory: 'FLocalVertexFactory' | 'TGPUSkinVertexFactoryDefault';
}

export interface CharacterJewelRuntime {
	lighting: CharacterJewelLighting;
	gameTime: number;
	aaMethod: number;
	globalFactor: number;
	swapLightFactor: number;
	timeOfDayHours: number;
	materialTextureMipBias: number;
	preExposure: number;
	inversePreExposure: number;
	nativeCullingSign: 1 | -1;
	nativePrimitiveDeterminantSign: 1 | -1;
	nativeFrontFaceParity: 1 | -1;
	normalOverride: [number, number, number, number];
	viewportSize: [number, number];
	inverseProjectionX: number;
}

export function readFurnitureCharacterJewel(value: unknown): FurnitureCharacterJewel | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureCharacterJewel;
	const c = p.collection;
	if (
		p.version !== 1 ||
		p.family !== 'character-jewel-current' ||
		p.uniforms?.length !== 39 ||
		!p.uniforms.every((row) => row.length === 4 && row.every(Number.isFinite)) ||
		!['surface', 'vfx-base-attenuation'].includes(p.variant) ||
		typeof p.twoSided !== 'boolean' ||
		!['FLocalVertexFactory', 'TGPUSkinVertexFactoryDefault'].includes(p.vertexFactory) ||
		!['N', 'D1', 'D', 'B', 'T', 'N1', 'T1', 'O'].every((role) => p.textures?.[role]) ||
		!c ||
		![c.ready, c.aaMethod, c.globalFactor, c.fillIntensity].every(Number.isFinite) ||
		![c.fillSkyColor, c.fillGroundColor, c.resolvedSunColor, c.dirLightVectorLimited].every(
			(v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
		)
	) return null;

	return p;
}

const fragmentDeclarations = /* glsl */ `
${nativeWorldFrameGLSL}
${characterJewelNativeMath}
varying vec3 vCJWorld,vCJTangent,vCJNormal,vCJLocalCM,vCJPrimitiveOrigin,vCJDissolvePivot;
varying vec4 vCJUV01,vCJUV23;
varying float vCJSign,vCJInstanceSign;
uniform vec4 cjMaterial[39],cjNormalOverride;
uniform sampler2D cjN,cjD1,cjD,cjB,cjT,cjN1,cjT1,cjO;
uniform vec3 cjPrimaryDirection,cjPrimaryColor,cjLimitedDirection,cjSunColor,cjSkyColor,cjGroundColor;
uniform float cjReady,cjFillIntensity,cjGameTime,cjGlobalFactor,cjSwapLightFactor,cjMipBias,cjPreExposure,cjInversePreExposure;
uniform float cjCullingSign,cjPrimitiveSign,cjFrontParity,cjCubeScale,cjInverseProjectionX;
uniform vec2 cjViewportSize;
varying float vCJPrimitiveRadius;
uniform float cjTimeOfDayHours;
uniform int cjAAMethod;
uniform bool cjTwoSided,cjVFX;
vec3 cjCube(vec3 nativeDirection) {
  vec3 d=nativeDirection;
  float u=atan(-d.x,-d.z)/6.28318530718;
  float v=1.0-acos(clamp(d.y,-1.0,1.0))/3.14159265359;
  return texture2D(cjO,vec2(fract(u),v)).rgb*cjCubeScale;
}
vec3 cjPow(vec3 c,float e) {
  return vec3(characterJewelPositivePower(c.x,e),characterJewelPositivePower(c.y,e),characterJewelPositivePower(c.z,e));
}
vec3 cjSurfaceNormal,cjBase,cjEmission;
float cjMetalness,cjSpecular,cjRoughness;
void cjEvaluate() {
  vec3 view=isOrthographic?furnitureNativeWorld(-vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])):
    furnitureNativeWorld(normalize(cameraPosition-vCJWorld));
  vec3 t=furnitureNativeWorld(vCJTangent),n=furnitureNativeWorld(vCJNormal);
  vec3 b=cross(n,t)*vCJSign;
  mat3 frame=mat3(t,b,n);
  float face=(gl_FrontFacing?1.0:-1.0)*cjFrontParity;
  float nativeSign=cjCullingSign*cjPrimitiveSign*face*vCJInstanceSign;
  vec2 normalUV=vCJUV01.xy*cjMaterial[6].x;
  vec2 rg=texture2D(cjN,normalUV,cjMaterial[6].y).rg;
  cjSurfaceNormal=characterJewelSourceNormal(rg,cjMaterial[6].z,frame,nativeSign,cjMaterial[6].w,cjTwoSided,cjNormalOverride);
  float ndotv=dot(cjSurfaceNormal,view);
  vec3 light=characterJewelSourceLight(cjPrimaryDirection,cjLimitedDirection,cjReady);
  vec3 lightColor=characterJewelSourceLight(cjPrimaryColor,cjSunColor,cjReady);
  vec3 highlights=characterJewelSourceHighlights(cjSurfaceNormal,view,light,cjMaterial[7],cjMaterial[8]);
  vec3 twoU=texture2D(cjD1,vCJUV01.zw,cjMipBias).rgb;
  vec2 uv=(vCJUV01.xy*cjMaterial[9].y+vCJUV01.zw*cjMaterial[9].z+
    vCJUV23.xy*cjMaterial[9].w+vCJUV23.zw*cjMaterial[10].x)*cjMaterial[10].y;
  vec4 diffuse=texture2D(cjD,uv);
  vec3 base=clamp(twoU+cjMaterial[9].x,0.0,1.0)*diffuse.rgb;
  vec4 mask=texture2D(cjB,vCJUV01.xy,cjMipBias);
  float projection=(cjViewportSize.x/cjViewportSize.y)/cjInverseProjectionX*.6;
  float start=projection*(75.0-25.0*(1.0-cjGlobalFactor));
  float distanceBlend=clamp((distance(cameraPosition,vCJPrimitiveOrigin)-start)/(300.0+200.0*(1.0-cjGlobalFactor)),0.0,1.0);
  float dayTriangle=1.0-abs(cjTimeOfDayHours*(1.0/12.0)-1.0);
  float vertexFactor=dayTriangle<=0.0?0.0:min(4.0*exp2(log2(dayTriangle)*cjMaterial[5].w),1.0);
  vec3 glint=characterJewelSourceGlint(vCJLocalCM,mask.g,ndotv,distanceBlend,vertexFactor,cjGameTime,
    cjAAMethod,cjGlobalFactor,cjSwapLightFactor,base,cjMaterial);
  vec2 ray=vec2(dot(t,view),dot(b,view));
  vec2 refractRG=texture2D(cjN,normalUV+ray*(cjMaterial[16].x*.1-.05),cjMaterial[6].y).rg;
  vec3 refraction=cjCube(characterJewelSourceRefractionDirection(refractRG,frame,view,cjMaterial[16].y));
  vec3 reflection=cjCube(2.0*ndotv*cjSurfaceNormal-view);
  vec4 bump=texture2D(cjT,vCJUV01.xy*cjMaterial[21].x+ray*(cjMaterial[21].y*.1-.05));
  vec3 c=characterJewelSourceColor(diffuse,twoU,refraction,reflection,bump.rgb,ndotv,highlights,glint,cjMaterial);
  vec3 diy=(twoU*cjMaterial[23].rgb+cjMaterial[23].a)*cjMaterial[24].x*mix(c,vec3(dot(c,vec3(.3,.59,.11))),.9);
  c=mix(c,diy,cjMaterial[9].x);
  if(cjVFX) c*=1.0-cjMaterial[24].y;
  vec4 tod=mix(vec4(1.0),cjMaterial[25],cjGlobalFactor);
  c=cjPow(mix(vec3(dot(c,vec3(.3,.59,.11))),c,tod.x)*tod.y,tod.z);
  vec3 emission=c*clamp(lightColor,.15,1.0)*mix(cjMaterial[26].x,1.0,clamp(dot(cjSurfaceNormal,light),0.0,1.0))*cjMaterial[26].y*cjInversePreExposure;
  float edge=max(abs(1.0-max(ndotv,0.0)),.0001);
  vec3 force=mix(cjMaterial[28].rgb,cjMaterial[27].rgb,edge*edge*edge);
  emission=mix(emission,force*2.0,cjMaterial[28].a);
  float noise=texture2D(cjN1,vCJUV01.xy*cjMaterial[29].x).r;
  float spatial=clamp(distance(vCJWorld,vCJDissolvePivot)/(vCJPrimitiveRadius*cjMaterial[30].x),0.0,1.0);
  spatial=mix(spatial,1.0-spatial,cjMaterial[30].y);
  float dissolveNoise=mix(noise,clamp(spatial-noise*cjMaterial[30].z,0.0,1.0),cjMaterial[30].w);
  float d=clamp((dissolveNoise-(cjMaterial[32].x*cjMaterial[32].y+cjMaterial[32].z)-cjMaterial[33].x)/(cjMaterial[32].w-cjMaterial[33].x),0.0,1.0);
  d=d*d*(3.0-2.0*d);
  emission=mix(cjMaterial[33].yzw,emission,d);
  emission+=exp2(log2(edge)*cjMaterial[34].x)*cjMaterial[34].yzw*cjMaterial[35].x*
    texture2D(cjT1,vCJUV01.xy,cjMipBias).r*cjMaterial[35].y;
  if(cjPreExposure>1.0) emission/=max(.1,mix(1.0,cjPreExposure,cjMaterial[35].z));
  c=mix(c,force,cjMaterial[28].a);
  c=mix(cjMaterial[33].yzw,c,d);
  c=clamp(c*(1.0+(cjMaterial[36].rgb-1.0)*cjMaterial[36].a*cjMaterial[35].y),0.0,1.0);
  cjMetalness=clamp(mix(cjMaterial[37].y,cjMaterial[37].x,bump.a),0.0,1.0);
  vec3 energy=max(vec3(1.0),2.0404*c-.3324-4.7951*c+2.7552*c+1.332);
  emission+=energy*(1.0-cjMetalness)*characterJewelSourceFill(cjSurfaceNormal.z,cjSkyColor,cjGroundColor,cjFillIntensity,lightColor)*c;
  cjEmission=max(mix(emission,cjMaterial[38].rgb,cjMaterial[37].z),0.0);
  cjBase=c;cjSpecular=clamp(tod.w,0.0,1.0);cjRoughness=clamp(mask.r*cjMaterial[38].a,0.0,1.0);
}
`;

export function createCharacterJewelMaterial(
	p: FurnitureCharacterJewel,
	sources: Partial<Record<string, Texture | null>>,
	runtime: CharacterJewelRuntime,
	update: MeshPhysicalMaterial['onBeforeRender'],
): MeshPhysicalMaterial {
	if (!readFurnitureCharacterJewel(p)) throw new Error('[CharacterJewel] current source profile required');

	const uniforms: Record<string, { value: unknown }> = {
		cjMaterial: { value: p.uniforms.map((row) => new Vector4().fromArray(row)) },
		cjTwoSided: { value: p.twoSided },
		cjVFX: { value: p.variant === 'vfx-base-attenuation' },
		cjCubeScale: { value: p.textures.O!.rgbScale },
	};

	const clones: Texture[] = [];

	const wrap = (name: string) => {
		switch (name) {
		case 'TA_Wrap':
			return RepeatWrapping;
		case 'TA_Clamp':
			return ClampToEdgeWrapping;
		case 'TA_Mirror':
			return MirroredRepeatWrapping;
		default:
			throw new Error('[CharacterJewel] native sampler address required');
		}
	};

	for (const [role, contract] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source?.isTexture) throw new Error(`[CharacterJewel] actual ${role} input required`);

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
		uniforms[`cj${role}`] = { value: texture };
	}

	const material = new MeshPhysicalMaterial({
		side: p.twoSided ? DoubleSide : FrontSide,
		transparent: false,
	});
	material.userData.characterJewel = p;
	material.onBeforeRender = update;

	const refresh = () => {
		const lighting = runtime.lighting;

		const values = [
			runtime.gameTime,
			runtime.aaMethod,
			runtime.globalFactor,
			runtime.swapLightFactor,
			runtime.materialTextureMipBias,
			runtime.preExposure,
			runtime.inversePreExposure,
			...runtime.viewportSize,
			runtime.inverseProjectionX,
			runtime.timeOfDayHours,
			lighting.ready,
			lighting.fillIntensity,
		];

		if (
			!values.every(Number.isFinite) ||
			runtime.preExposure <= 0 ||
			runtime.inversePreExposure <= 0 ||
			runtime.viewportSize.some((size) => size <= 0) ||
			runtime.inverseProjectionX <= 0
		) throw new Error('[CharacterJewel] actual finite View/MPC/primitive provider required');

		const supplied: Record<string, unknown> = {
			cjPrimaryDirection: new Vector3().fromArray(lighting.primaryDirection),
			cjPrimaryColor: new Vector3().fromArray(lighting.primaryColor),
			cjLimitedDirection: new Vector3().fromArray(lighting.dirLightVectorLimited),
			cjSunColor: new Vector3().fromArray(lighting.resolvedSunColor),
			cjSkyColor: new Vector3().fromArray(lighting.fillSkyColor),
			cjGroundColor: new Vector3().fromArray(lighting.fillGroundColor),
			cjReady: lighting.ready,
			cjFillIntensity: lighting.fillIntensity,
			cjGameTime: runtime.gameTime,
			cjAAMethod: runtime.aaMethod,
			cjGlobalFactor: runtime.globalFactor,
			cjSwapLightFactor: runtime.swapLightFactor,
			cjMipBias: runtime.materialTextureMipBias,
			cjTimeOfDayHours: runtime.timeOfDayHours,
			cjPreExposure: runtime.preExposure,
			cjInversePreExposure: runtime.inversePreExposure,
			cjCullingSign: runtime.nativeCullingSign,
			cjPrimitiveSign: runtime.nativePrimitiveDeterminantSign,
			cjFrontParity: runtime.nativeFrontFaceParity,
			cjNormalOverride: new Vector4().fromArray(runtime.normalOverride),
			cjViewportSize: runtime.viewportSize,
			cjInverseProjectionX: runtime.inverseProjectionX,
		};

		for (const [key, value] of Object.entries(supplied)) {
			if (uniforms[key]) uniforms[key]!.value = value;
			else uniforms[key] = { value };
		}
	};

	material.userData.characterJewelUniforms = uniforms;
	material.userData.characterJewelRefreshUniforms = refresh;
	refresh();
	material.onBeforeCompile = (shader) => {
		refresh();
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec4 characterNativeTangent; attribute vec3 characterNativeNormal;
attribute vec2 characterUV1; attribute vec4 characterUV23,characterPrimitiveBounds;
attribute vec3 characterLocalCM,characterDissolvePivot;
varying vec3 vCJWorld,vCJTangent,vCJNormal,vCJLocalCM,vCJPrimitiveOrigin,vCJDissolvePivot;
varying vec4 vCJUV01,vCJUV23; varying float vCJSign,vCJPrimitiveRadius,vCJInstanceSign;`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
mat4 cjWorld=modelMatrix;
vCJInstanceSign=1.0;
#ifdef USE_INSTANCING
cjWorld=cjWorld*instanceMatrix;
vCJInstanceSign=sign(determinant(mat3(instanceMatrix)));
#endif
mat3 cjUnscaled=mat3(normalize(cjWorld[0].xyz),normalize(cjWorld[1].xyz),normalize(cjWorld[2].xyz));
vCJWorld=(cjWorld*vec4(transformed,1.0)).xyz;
vCJPrimitiveOrigin=(cjWorld*vec4(characterPrimitiveBounds.xyz,1.0)).xyz;
vCJDissolvePivot=(cjWorld*vec4(characterDissolvePivot,1.0)).xyz;
vCJPrimitiveRadius=characterPrimitiveBounds.w*max(length(cjWorld[0].xyz),max(length(cjWorld[1].xyz),length(cjWorld[2].xyz)));
vCJLocalCM=characterLocalCM;
vCJTangent=cjUnscaled*characterNativeTangent.xyz;vCJNormal=cjUnscaled*characterNativeNormal;
vCJSign=-characterNativeTangent.w*sign(determinant(mat3(cjWorld)));
vCJUV01=vec4(uv,characterUV1);vCJUV23=characterUV23;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${fragmentDeclarations}`)
			.replace('#include <map_fragment>', 'cjEvaluate();diffuseColor=vec4(cjBase,1.0);')
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=max(cjRoughness,.0525);')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor=cjMetalness;')
			.replace(
				'#include <normal_fragment_maps>',
				'normal=mat3(viewMatrix)*vec3(cjSurfaceNormal.x,-cjSurfaceNormal.y,cjSurfaceNormal.z);',
			)
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=cjEmission;')
			.replace(
				'#include <lights_physical_fragment>',
				`#include <lights_physical_fragment>
material.specularColor=vec3(.08*cjSpecular);
material.specularColorBlended=mix(material.specularColor,diffuseColor.rgb,metalnessFactor);`,
			);
	};
	material.customProgramCacheKey = () => `character-jewel-current:${p.vertexFactory}:${p.variant}:${p.twoSided}`;
	material.addEventListener('dispose', () => clones.forEach((texture) => texture.dispose()));
	return material;
}
