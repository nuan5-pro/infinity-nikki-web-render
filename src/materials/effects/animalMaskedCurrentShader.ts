import {
	ClampToEdgeWrapping,
	DoubleSide,
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
import { characterJewelNativeMath } from '../jewel/characterJewelSource.js';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

interface AnimalMaskedTexture {
	parameter: string
	sRGB: boolean
	rgbScale: number
	addressX: string
	addressY: string
	mipmaps: boolean
	nearest: boolean
	cube: boolean
}

export interface FurnitureAnimalMaskedCurrent {
	version: 1
	family: 'animal-masked-current'
	uniforms: number[][]
	textures: Record<string, AnimalMaskedTexture>
	collection: {
		ready: number
		aaMethod: number
		globalFactor: number
		fillIntensity: number
		fillSkyColor: number[]
		fillGroundColor: number[]
		resolvedSunColor: number[]
		dirLightVectorLimited: number[]
	}
	requiredUV: number[]
	twoSided: true
	approximation: string
}

export interface AnimalMaskedCurrentRuntime {
	primaryDirection: number[]
	primaryColor: number[]
	sunDirection: number[]
	swapLightFactor: number
	cameraSign: number
}

export function readFurnitureAnimalMaskedCurrent(value: unknown): FurnitureAnimalMaskedCurrent | null {
	const p = value as FurnitureAnimalMaskedCurrent;
	if (
		!p ||
		p.version !== 1 ||
		p.family !== 'animal-masked-current' ||
		p.twoSided !== true ||
		p.uniforms?.length !== 57 ||
		!p.uniforms.every((r) => r.length === 4 && r.every(Number.isFinite)) ||
		!p.collection ||
		!['N', 'N1', 'N2', 'D', 'D1', 'O', 'O1', 'T', 'B', 'C', 'O2', 'M', 'T1', 'D2', 'S'].every((role) => p.textures?.[role])
	) return null;

	return p;
}

const fragment = /* glsl */ `
${nativeWorldFrameGLSL}
${characterJewelNativeMath}
uniform vec4 amMaterial[57];
uniform sampler2D amN,amN1,amD,amD1,amO,amO1,amT,amB,amC,amO2,amM,amT1,amD2,amS;
uniform float amCubeScale,amReady,amFillIntensity,amSwap,amCameraSign;
uniform vec3 amPrimaryDirection,amPrimaryColor,amSunDirection,amSunColor,amSky,amGround;
varying vec4 vAMUV01,vAMUV23;
varying vec3 vAMWorld,vAMTangent,vAMNormal;
varying float vAMSign,vAMInstanceSign;
vec3 amBase,amNormal,amEmission;float amMetal,amRough,amSpec;
vec2 amUV(vec4 w){return vAMUV01.xy*w.x+vAMUV01.zw*w.y+vAMUV23.xy*w.z+vAMUV23.zw*w.w;}
vec3 amDecode(vec2 rg){vec2 xy=rg*2.0-1.0;return vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));}
vec3 amCube(vec3 direction){
  vec3 d=normalize(direction);
  return texture2D(amS,vec2(fract(atan(-d.x,-d.z)/6.28318530718),1.0-acos(clamp(d.y,-1.0,1.0))/3.14159265359)).rgb*amCubeScale;
}
void amEvaluate(){
  vec3 view=isOrthographic?furnitureNativeWorld(-vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])):furnitureNativeWorld(normalize(cameraPosition-vAMWorld));
  vec3 tangent=normalize(furnitureNativeWorld(vAMTangent)),geometric=normalize(furnitureNativeWorld(vAMNormal));
  vec3 bitangent=normalize(cross(geometric,tangent))*vAMSign;
  mat3 frame=mat3(tangent,bitangent,geometric);
  vec2 mainUV=amUV(amMaterial[7])*amMaterial[8].x;
  vec3 normalSample=texture2D(amN,mainUV).rgb;
  vec2 rg=(normalSample.rg*2.0-1.0)*amMaterial[8].y;
  vec2 zRG=(normalSample.rg*2.0-1.0)*amMaterial[8].z;
  vec3 nt=normalize(vec3(rg,sqrt(1.0-min(dot(zRG,zRG),1.0))));
  vec2 patternUV=(vAMUV01.xy*amMaterial[8].w+vAMUV01.zw*amMaterial[9].x+vAMUV23.xy*amMaterial[9].y+vAMUV23.zw*amMaterial[9].z)*amMaterial[10].xy+amMaterial[10].zw;
  patternUV-=.6*amMaterial[11].x*vec2(dot(tangent,view),dot(bitangent,view));
  vec4 pattern=texture2D(amD1,patternUV),weights=clamp(pattern.a*amMaterial[12],0.0,1.0);
  nt=normalize(mix(nt,amDecode(texture2D(amN1,patternUV).rg),weights.z));
  float face=(gl_FrontFacing?-1.0:1.0)*amCameraSign*vAMInstanceSign;
  amNormal=normalize(frame*nt)*face;
  vec3 light=characterJewelSourceLight(amPrimaryDirection,amSunDirection,amReady);
  vec3 lightColor=characterJewelSourceLight(amPrimaryColor,amSunColor,amReady);
  float front=clamp(dot(amNormal,view),0.0,1.0),edge=max(1.0-front,.0001);
  vec4 extra=texture2D(amO,amUV(amMaterial[13]));
  vec4 mga=texture2D(amO1,mainUV),body=texture2D(amD,mainUV);
  float extraMask=clamp(extra.g,.01,1.0);
  float rimWeight=characterJewelPositivePower(1.0-front,amMaterial[18].x);
  rimWeight=mix(1.0-rimWeight,rimWeight,amMaterial[18].y);
  vec3 rim=mga.b*amMaterial[17].yzw*mix(1.0,extra.r,amMaterial[17].x)*rimWeight;
  vec3 emission=texture2D(amT,mainUV).rgb*amMaterial[19].rgb*(1.0-amMaterial[18].w*(amSwap+1.0)*.5)+rim*amMaterial[18].z;
  vec3 patternColor=characterJewelSourceHDR(pattern.rgb,amMaterial[22].x,0.0)*amMaterial[22].yzw;
  emission=mix(emission,patternColor*amMaterial[23].x,weights.w);
  vec3 reflected=reflect(-view,amNormal);
  vec3 cameraUp=furnitureNativeWorld(vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]));
  vec3 right=cross(-view,cameraUp);
  right=dot(right,right)>.00000001?normalize(right):tangent;
  vec3 up=normalize(cross(-view,right));
  vec3 rainbow=vec3(0.0);
  #ifdef ANIMAL_MASKED_RAINBOW
  vec2 rainbowUV=vec2(dot(reflected,right),-dot(reflected,up))*.5*amMaterial[24].y+.5;
  rainbowUV+=texture2D(amB,vAMUV01.xy*2.0*amMaterial[23].w).rg*amMaterial[24].x;
  rainbow=texture2D(amC,rainbowUV).rgb*amMaterial[25].rgb;
  emission+=rainbow*extraMask*max(amMaterial[25].w,1.0)*amMaterial[26].x;
  #endif
  vec3 coat=vec3(0.0);
  #ifdef ANIMAL_MASKED_COATING
  float coating=characterJewelPositivePower(edge,amMaterial[26].y)*amMaterial[26].z+amMaterial[26].w;
  coating=mix(coating,1.0-coating,amMaterial[27].x);
  coat=amCube(reflected)*coating*amMaterial[27].yzw*extra.r;
  emission+=coat*max(amMaterial[28].x,1.0)*amMaterial[28].y;
  #endif
  vec3 base=body.rgb*amMaterial[30].yzw+rim;
  base=mix(base,body.rgb*amMaterial[30].yzw*clamp(rim,0.0,1.0),amMaterial[32].x);
  base=mix(base,patternColor,weights.x);
  base=mix(base,rainbow,extraMask*amMaterial[33].x)+coat;
  float ndotl=dot(amNormal,light);
  vec3 lit=clamp(mix(max(lightColor,vec3(.12)),vec3(dot(max(lightColor,vec3(.12)),vec3(.3,.59,.11))),.35),.1,1.0);
  emission=mix(emission,emission*lit*max(ndotl,amMaterial[34].z),amMaterial[34].w);
  float noise=texture2D(amO2,vAMUV01.xy*amMaterial[37].x).r;
  float progress=noise-(amMaterial[39].x*amMaterial[39].y+amMaterial[39].z);
  float dissolve=smoothstep(amMaterial[40].x,amMaterial[39].w,progress);
  emission=mix(amMaterial[40].yzw,emission,dissolve);
  emission+=characterJewelPositivePower(edge,amMaterial[41].x)*amMaterial[41].yzw*amMaterial[42].x*amMaterial[42].y*texture2D(amM,vAMUV01.xy).r;
  // Freeze source time at zero. Panners contribute no arbitrary UV offset;
  // the source breathing triangle remains active rather than dropping Glow.
  float breath=clamp(1.0-amMaterial[44].y,0.0,1.0);
  float strength=mix(amMaterial[44].w,amMaterial[44].z,breath);
  emission+=texture2D(amT1,vAMUV01.xy*amMaterial[42].w).rgb*amMaterial[43].yzw*texture2D(amD2,vAMUV01.xy).r*strength;
  amBase=clamp(mix(amMaterial[40].yzw,base,dissolve),0.0,1.0);
  amMetal=clamp(mix(mix(amMaterial[46].z,amMaterial[46].y,mga.r),amMaterial[47].y,weights.y),0.0,1.0);
  amRough=clamp(mix(1.0-mix(amMaterial[47].x,amMaterial[46].w,mga.g),amMaterial[47].z,weights.y),0.0,1.0);
  amSpec=clamp(amMaterial[49].x,0.0,1.0);
  vec3 energy=max(vec3(1.0),2.0404*amBase-.3324-4.7951*amBase+2.7552*amBase+1.332);
  emission+=energy*(1.0-amMetal)*characterJewelSourceFill(amNormal.z,amSky,amGround,amFillIntensity,lightColor)*amBase;
  amEmission=max(emission,vec3(0.0));
  float opacity=mix(amMaterial[49].z,amMaterial[49].y,body.a);
  float edgeBase=amMaterial[49].w>=-.001?1.0-front:front;
  float edgeOpacity=characterJewelPositivePower(edgeBase+.01,amMaterial[50].x);
  opacity=mix(min(opacity,edgeOpacity),max(opacity,edgeOpacity),amMaterial[50].y);
  opacity*=smoothstep(0.0,-amMaterial[40].x,progress);
  if(opacity<.3333)discard;
}
`;

export function createAnimalMaskedCurrentMaterial(
	p: FurnitureAnimalMaskedCurrent,
	sources: Partial<Record<string, Texture | null>>,
	runtime: AnimalMaskedCurrentRuntime,
	update: MeshPhysicalMaterial['onBeforeRender'],
): MeshPhysicalMaterial {
	if (!readFurnitureAnimalMaskedCurrent(p)) throw new Error('[AnimalMasked] current masked source required');

	const c = p.collection;

	const uniforms: Record<string, { value: unknown }> = {
		amMaterial: { value: p.uniforms.map((r) => new Vector4().fromArray(r)) },
		amCubeScale: { value: p.textures.S!.rgbScale },
		amReady: { value: c.ready },
		amFillIntensity: { value: c.fillIntensity },
		amSunColor: { value: new Vector3().fromArray(c.resolvedSunColor) },
		amSky: { value: new Vector3().fromArray(c.fillSkyColor) },
		amGround: { value: new Vector3().fromArray(c.fillGroundColor) },
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
			throw new Error('[AnimalMasked] source sampler address required');
		}
	};

	for (const [role, t] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source?.isTexture) throw new Error(`[AnimalMasked] actual ${role} input required`);

		const texture = source.clone();
		texture.colorSpace = t.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = wrap(t.addressX);
		texture.wrapT = wrap(t.addressY);
		texture.generateMipmaps = t.mipmaps;
		texture.magFilter = t.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = t.mipmaps
			? t.nearest
				? NearestMipmapNearestFilter
				: LinearMipmapLinearFilter
			: texture.magFilter;
		texture.needsUpdate = true;
		clones.push(texture);
		uniforms[`am${role}`] = { value: texture };
	}

	const refresh = () => {
		if (
			![
				...runtime.primaryDirection,
				...runtime.primaryColor,
				...runtime.sunDirection,
				runtime.swapLightFactor,
				runtime.cameraSign,
			].every(Number.isFinite)
		) throw new Error('[AnimalMasked] actual Home lighting required');

		const values: Record<string, unknown> = {
			amPrimaryDirection: new Vector3().fromArray(runtime.primaryDirection),
			amPrimaryColor: new Vector3().fromArray(runtime.primaryColor),
			amSunDirection: new Vector3().fromArray(runtime.sunDirection),
			amSwap: runtime.swapLightFactor,
			amCameraSign: runtime.cameraSign,
		};

		for (const [key, value] of Object.entries(values)) {
			if (uniforms[key]) uniforms[key]!.value = value;
			else uniforms[key] = { value };
		}
	};

	const material = new MeshPhysicalMaterial({
		side: DoubleSide,
		transparent: false,
		alphaTest: 0.3333,
	});
	const rainbow = p.uniforms[33]![0] !== 0 || p.uniforms[26]![0] !== 0;
	const coating = p.uniforms[27]!.slice(1).some((v) => v !== 0);
	material.defines = {
		...(rainbow ? { ANIMAL_MASKED_RAINBOW: '' } : {}),
		...(coating ? { ANIMAL_MASKED_COATING: '' } : {}),
	};
	material.forceSinglePass = true;
	material.userData.animalMaskedCurrent = p;
	material.userData.animalMaskedCurrentUniforms = uniforms;
	material.userData.animalMaskedCurrentRefresh = refresh;
	material.onBeforeRender = update;
	refresh();
	material.onBeforeCompile = (shader) => {
		refresh();
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec4 animalMaskedNativeTangent;attribute vec3 animalMaskedNativeNormal;attribute vec2 animalMaskedUV1;attribute vec4 animalMaskedUV23;
varying vec4 vAMUV01,vAMUV23;varying vec3 vAMWorld,vAMTangent,vAMNormal;varying float vAMSign,vAMInstanceSign;`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
mat4 amWorld=modelMatrix;vAMInstanceSign=1.0;
#ifdef USE_INSTANCING
amWorld=amWorld*instanceMatrix;vAMInstanceSign=sign(determinant(mat3(instanceMatrix)));
#endif
mat3 amBasis=mat3(normalize(amWorld[0].xyz),normalize(amWorld[1].xyz),normalize(amWorld[2].xyz));
vAMWorld=(amWorld*vec4(transformed,1.0)).xyz;vAMTangent=amBasis*animalMaskedNativeTangent.xyz;vAMNormal=amBasis*animalMaskedNativeNormal;
vAMSign=-animalMaskedNativeTangent.w*sign(determinant(mat3(amWorld)));vAMUV01=vec4(uv,animalMaskedUV1);vAMUV23=animalMaskedUV23;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${fragment}`)
			.replace('#include <map_fragment>', 'amEvaluate();diffuseColor=vec4(amBase,1.0);')
			.replace(
				'#include <normal_fragment_maps>',
				'normal=mat3(viewMatrix)*vec3(amNormal.x,-amNormal.y,amNormal.z);',
			)
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=max(amRough,.0525);')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor=amMetal;')
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=amEmission;')
			.replace(
				'#include <lights_physical_fragment>',
				`#include <lights_physical_fragment>
material.specularColor=vec3(.08*amSpec);
material.specularColorBlended=mix(material.specularColor,diffuseColor.rgb,metalnessFactor);`,
			);
	};
	material.customProgramCacheKey = () => `animal-masked-current:static-glow-source-v1:${rainbow}:${coating}`;
	material.addEventListener('dispose', () => clones.forEach((t) => t.dispose()));
	return material;
}
