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
import type {
	FurnitureIntStaticMeshCurrent,
	IntStaticMeshCurrentRuntime,
} from '../surface/intStaticMeshCurrentShader.js';

export interface FurnitureSceneJewelCurrent extends Omit<FurnitureIntStaticMeshCurrent, 'family' | 'variant'> {
	family: 'scene-jewel-current';
}

export type SceneJewelCurrentRuntime = IntStaticMeshCurrentRuntime;

export function readFurnitureSceneJewelCurrent(value: unknown): FurnitureSceneJewelCurrent | null {
	const p = value as FurnitureSceneJewelCurrent;
	if (
		!p ||
		p.version !== 1 ||
		p.family !== 'scene-jewel-current' ||
		p.uniforms?.length !== 22 ||
		!p.uniforms.every((r) => r.length === 4 && r.every(Number.isFinite)) ||
		!['N', 'D', 'O', 'S'].every((k) => p.textures?.[k]) ||
		!p.textures.S!.cube ||
		!p.collection ||
		![
			p.collection.ready,
			p.collection.swapLightFactor,
			...p.collection.limitedDirection,
			...p.collection.sunColor,
		].every(Number.isFinite)
	) return null;

	return p;
}

const declarations = /* glsl */ `
${nativeWorldFrameGLSL}
varying vec3 vSJWorld,vSJTangent,vSJNormal;varying vec4 vSJUV,vSJUV23;varying float vSJSign;
uniform vec4 sjMaterial[22],sjNormalOverride;uniform sampler2D sjN,sjD,sjO,sjS;
uniform vec3 sjPrimaryDirection,sjPrimaryColor,sjLimitedDirection,sjSunColor;
uniform float sjReady,sjPreExposure,sjCubeScale,sjSwapLightFactor;
vec3 sjNormal,sjBase,sjEmission;
vec3 sjCube(vec3 r){vec2 uv=vec2(fract(atan(-r.x,-r.z)/6.28318530718),1.0-acos(clamp(r.y,-1.0,1.0))/3.14159265359);return texture2D(sjS,uv).rgb*sjCubeScale;}
float sjPow(float x,float p){return x<=0.0?0.0:exp2(log2(x)*p);}
void sceneJewelEvaluate(){
  vec3 view=isOrthographic?furnitureNativeWorld(-vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])):furnitureNativeWorld(normalize(cameraPosition-vSJWorld));
  vec3 t=furnitureNativeWorld(vSJTangent),n=furnitureNativeWorld(vSJNormal),b=cross(n,t)*vSJSign;
  vec2 rg=texture2D(sjN,vSJUV.xy*sjMaterial[5].x).rg*2.0-1.0;
  vec3 raw=mix(vec3(rg,sqrt(max(1.0-dot(rg,rg),0.0))),vec3(0.0,0.0,1.0),sjMaterial[5].y);
  vec3 adjusted=normalize(raw*sjNormalOverride.w+sjNormalOverride.xyz);sjNormal=normalize(mat3(t,b,n)*adjusted);
  float ndotv=dot(sjNormal,view),edge=max(abs(1.0-max(ndotv,0.0)),.0001);
  vec2 uv=(vSJUV.xy*sjMaterial[7].w+vSJUV.zw*sjMaterial[8].x+vSJUV23.xy*sjMaterial[8].y+vSJUV23.zw*sjMaterial[8].z)*sjMaterial[8].w;
  vec4 diffuse=texture2D(sjD,uv);vec3 base=mix(sjMaterial[7].rgb,sjMaterial[6].rgb,sjPow(edge,sjMaterial[5].z))*diffuse.rgb;
  bool mpc=abs(sjReady)>.00001&&sjReady>=0.0;vec3 dir=mpc?sjLimitedDirection:sjPrimaryDirection,light=mpc?sjSunColor:sjPrimaryColor;
  vec3 reflection=2.0*ndotv*sjNormal-view;
  vec3 highlight=sjPow(1.0-abs(dot(dir,reflection)),sjMaterial[9].x)*sjMaterial[9].yzw*base;
  vec3 refraction=-normalize(view+mat3(t,b,n)*raw*sjMaterial[10].x);
  float alpha=diffuse.a+(1.0-diffuse.a)*sjMaterial[11].x;
  vec3 color=mix(base,sjCube(refraction)*sjMaterial[10].yzw*base,alpha*sjMaterial[11].y);
  color+=sjCube(reflection)*(.04+.96*sjPow(edge,sjMaterial[11].z))*sjMaterial[12].rgb*base;
  vec2 detailUV=(rg-.5)*sjMaterial[12].w+vSJUV.xy;detailUV*=sjMaterial[13].x;
  detailUV-=.6*sjMaterial[13].y*vec2(dot(t,view),dot(b,view));
  vec3 detail=texture2D(sjO,detailUV).rgb;float mask=dot(detail,vec3(sjMaterial[13].zw,sjMaterial[14].x));
  mask*=1.0+(alpha-1.0)*sjMaterial[14].y;color+=mask*base*sjMaterial[15].rgb+highlight;
  float tod=mix(sjMaterial[16].w,sjMaterial[16].z,clamp(1.0-sjSwapLightFactor,0.0,1.0));
  vec3 emission=color*mix(max(light,vec3(.12)),vec3(1.0),sjMaterial[15].w)*max(sjMaterial[16].x,1.0)*sjMaterial[16].y*tod*sjMaterial[17].x;
  if(sjPreExposure>1.0)emission/=max(.1,mix(1.0,sjPreExposure,sjMaterial[17].y));
  sjEmission=max(mix(emission,sjMaterial[19].rgb,sjMaterial[18].w),0.0);sjBase=clamp(color*tod,0.0,1.0);
}
`;

export function createSceneJewelCurrentMaterial(
	p: FurnitureSceneJewelCurrent,
	sources: Partial<Record<string, Texture | null>>,
	runtime: SceneJewelCurrentRuntime,
	update: MeshPhysicalMaterial['onBeforeRender'],
): MeshPhysicalMaterial {
	if (!readFurnitureSceneJewelCurrent(p)) throw new Error('[SceneJewel] current native source profile required');

	const uniforms: Record<string, { value: unknown }> = {
		sjMaterial: { value: p.uniforms.map((r) => new Vector4().fromArray(r)) },
		sjCubeScale: { value: p.textures.S!.rgbScale },
	};

	const clones: Texture[] = [];

	const wrap = (v: string) => {
		switch (v) {
		case 'TA_Wrap':
			return RepeatWrapping;
		case 'TA_Clamp':
			return ClampToEdgeWrapping;
		case 'TA_Mirror':
			return MirroredRepeatWrapping;
		default:
			throw new Error('[SceneJewel] actual sampler required');
		}
	};

	for (const [role, c] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source?.isTexture) throw new Error(`[SceneJewel] ${role} source required`);

		const tex = source.clone();
		tex.colorSpace = c.sRGB ? SRGBColorSpace : NoColorSpace;
		tex.wrapS = wrap(c.addressX);
		tex.wrapT = wrap(c.addressY);
		tex.generateMipmaps = c.mipmaps;
		tex.magFilter = c.nearest ? NearestFilter : LinearFilter;
		tex.minFilter = c.mipmaps
			? c.nearest
				? NearestMipmapNearestFilter
				: LinearMipmapLinearFilter
			: tex.magFilter;
		tex.needsUpdate = true;
		clones.push(tex);
		uniforms[`sj${role}`] = { value: tex };
	}

	const material = new MeshPhysicalMaterial({
		side: p.twoSided ? DoubleSide : FrontSide,
		metalness: 0.3,
		roughness: Math.min(1, Math.max(0.0525, p.uniforms[20]![3]!)),
	});

	const refresh = () => {
		const values = [
			runtime.ready,
			runtime.preExposure,
			runtime.swapLightFactor,
			...runtime.primaryDirection,
			...runtime.primaryColor,
			...runtime.limitedDirection,
			...runtime.sunColor,
			...runtime.normalOverride,
		];

		if (!values.every(Number.isFinite) || runtime.preExposure <= 0) throw new Error('[SceneJewel] actual View/primary/manual TOD required');

		const fields = {
			sjPrimaryDirection: new Vector3().fromArray(runtime.primaryDirection),
			sjPrimaryColor: new Vector3().fromArray(runtime.primaryColor),
			sjLimitedDirection: new Vector3().fromArray(runtime.limitedDirection),
			sjSunColor: new Vector3().fromArray(runtime.sunColor),
			sjNormalOverride: new Vector4().fromArray(runtime.normalOverride),
			sjReady: runtime.ready,
			sjPreExposure: runtime.preExposure,
			sjSwapLightFactor: runtime.swapLightFactor,
		};

		for (const [k, value] of Object.entries(fields)) {
			if (uniforms[k]) uniforms[k]!.value = value;
			else uniforms[k] = { value };
		}
	};

	material.userData.sceneJewelCurrent = p;
	material.userData.sceneJewelCurrentUniforms = uniforms;
	material.userData.sceneJewelCurrentRefreshUniforms = refresh;
	material.onBeforeRender = update;
	refresh();
	material.onBeforeCompile = (shader) => {
		refresh();
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec4 sceneJewelNativeTangent,sceneJewelUV23;attribute vec3 sceneJewelNativeNormal;attribute vec2 sceneJewelUV1;
varying vec3 vSJWorld,vSJTangent,vSJNormal;varying vec4 vSJUV,vSJUV23;varying float vSJSign;`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
mat4 sjWorld=modelMatrix;
#ifdef USE_INSTANCING
sjWorld=sjWorld*instanceMatrix;
#endif
mat3 sjUnscaled=mat3(normalize(sjWorld[0].xyz),normalize(sjWorld[1].xyz),normalize(sjWorld[2].xyz));
vSJWorld=(sjWorld*vec4(transformed,1.0)).xyz;vSJTangent=sjUnscaled*sceneJewelNativeTangent.xyz;vSJNormal=sjUnscaled*sceneJewelNativeNormal;
vSJSign=-sceneJewelNativeTangent.w*sign(determinant(mat3(sjWorld)));vSJUV=vec4(uv,sceneJewelUV1);vSJUV23=sceneJewelUV23;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${declarations}`)
			.replace('#include <map_fragment>', 'sceneJewelEvaluate();diffuseColor=vec4(sjBase,1.0);')
			.replace(
				'#include <normal_fragment_maps>',
				'normal=mat3(viewMatrix)*vec3(sjNormal.x,-sjNormal.y,sjNormal.z);',
			)
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=sjEmission;')
			.replace(
				'#include <lights_physical_fragment>',
				`#include <lights_physical_fragment>
material.specularColor=vec3(.08);material.specularColorBlended=mix(material.specularColor,diffuseColor.rgb,metalnessFactor);`,
			);
	};
	material.customProgramCacheKey = () => `scene-jewel-current:${p.twoSided}`;
	material.addEventListener('dispose', () => clones.forEach((t) => t.dispose()));
	return material;
}
