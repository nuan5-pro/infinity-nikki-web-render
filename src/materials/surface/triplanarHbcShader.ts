import { ShaderChunk, Vector3, Vector4, type MeshStandardMaterial, type Texture } from 'three';
import type { FurnitureSurface } from './surfaceShader.js';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

/** Native world-centimetre projection and axis-normal reconstruction. */
export function applyTriplanarHbcShader(material: MeshStandardMaterial, s: FurnitureSurface, orm: Texture | null, tint: Texture | null): void {
	const c = s.triplanar;
	if (!c || !orm || !tint || !material.map || !material.normalMap) throw new Error('Triplanar HBC requires D/N/O/T');

	material.color.setRGB(1, 1, 1);
	material.aoMap = orm;
	material.aoMapIntensity = 1;
	material.emissive.setRGB(0, 0, 0);
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, {
			triD: { value: material.map },
			triN: { value: material.normalMap },
			triO: { value: orm },
			triT: { value: tint },
			triScale: { value: s.uvScale },
			triBlend: { value: c.blend },
			triFlatten: { value: c.flattenZ },
			triStrength: { value: s.normalIntensity ?? 1 },
			triColor: { value: new Vector3(...s.color) },
			triX: { value: new Vector3().fromArray(c.axisTint[0]) },
			triY: { value: new Vector3().fromArray(c.axisTint[1]) },
			triZ: { value: new Vector3().fromArray(c.axisTint[2]) },
			triHeight: { value: new Vector4(...c.heightColor) },
			triSpecular: { value: s.specular?.[0] ?? 0.5 },
		});
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
#ifndef USE_UV2
attribute vec2 uv2;
#endif
varying vec3 vTriWorld;
varying vec3 vTriNormal;
varying vec2 vTriPalette;
${nativeWorldFrameGLSL}`,
			)
			.replace(
				'#include <worldpos_vertex>',
				`#include <worldpos_vertex>
vec4 triPosition = vec4(transformed,1.0);
vec3 triNormal = objectNormal;
#ifdef USE_INSTANCING
triPosition = instanceMatrix*triPosition;
triNormal = furnitureUnscaledBasis(instanceMatrix)*triNormal;
#endif
triPosition = modelMatrix*triPosition;
triNormal = furnitureUnscaledBasis(modelMatrix)*triNormal;
// Prepared geometry and instance matrices are already Z-up centimetres.
// Only the scene's Y reflection separates editor world from native world.
vTriWorld = furnitureNativeWorld(triPosition.xyz);
vTriNormal = furnitureNativeWorld(triNormal);
vTriPalette = uv2;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec3 vTriWorld, vTriNormal;
varying vec2 vTriPalette;
${nativeWorldFrameGLSL}
uniform sampler2D triD, triN, triO, triT;
uniform float triScale, triBlend, triFlatten, triStrength, triSpecular;
uniform vec3 triColor, triX, triY, triZ;
uniform vec4 triHeight;
vec3 triWeights, triPosition;
vec4 triOrm;
vec3 triDecode(vec2 rg) {
 vec2 xy = rg*2.0-1.0;
 return vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));
}`,
			)
			.replace(
				'#include <map_fragment>',
				`
 triPosition = -vTriWorld*(0.01*triScale);
triWeights = pow(abs(normalize(vTriNormal)),vec3(triBlend));
triWeights /= max(dot(triWeights,vec3(1.0)),0.000001);
vec3 triBase = texture2D(triD,triPosition.yz).rgb*triWeights.x*triX + texture2D(triD,triPosition.xz).rgb*triWeights.y*triY + texture2D(triD,triPosition.yx).rgb*triWeights.z*triZ;
float triGray = dot(triBase,vec3(0.3,0.59,0.11));
vec3 triAdjusted = mix(triBase,vec3(triGray),triHeight.z)*triHeight.w;
float triRange = triHeight.y-triHeight.x;
 float triH = clamp((vTriWorld.z-triHeight.x)/(abs(triRange)<0.000001 ? 0.000001 : triRange),0.0,1.0);
triBase = mix(triBase,triAdjusted,triH)*triColor;
vec3 triPalette = texture2D(triT,vTriPalette).rgb;
diffuseColor.rgb = clamp(mix(2.0*triBase*triPalette,1.0-2.0*(1.0-triBase)*(1.0-triPalette),step(vec3(0.5),triBase)),0.0,1.0);
triOrm = texture2D(triO,triPosition.yz)*triWeights.x + texture2D(triO,triPosition.xz)*triWeights.y + texture2D(triO,triPosition.yx)*triWeights.z;`,
			)
			.replace(
				'#include <normal_fragment_maps>',
				`
vec3 triGeom = normalize(vTriNormal);
vec3 triNX = triDecode(texture2D(triN,triPosition.yz).rg);
vec3 triNY = triDecode(texture2D(triN,triPosition.xz).rg);
vec3 triNZ = triDecode(texture2D(triN,triPosition.yx).rg);
vec3 triWorldN = vec3(triNX.z*triGeom.x,triGeom.y-triNX.x,triGeom.z-triNX.y)*triWeights.x;
triWorldN += vec3(triGeom.x-triNY.x,triNY.z*triGeom.y,triGeom.z-triNY.y)*triWeights.y;
triWorldN += mix(vec3(triGeom.xy+triNZ.xy,triNZ.z*triGeom.z),triGeom,triFlatten)*triWeights.z;
triWorldN = normalize(mix(triGeom,normalize(triWorldN),triStrength));
normal = normalize(mat3(viewMatrix)*furnitureNativeWorld(triWorldN));`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				'float roughnessFactor = clamp(triOrm.g,0.0,1.0);',
			)
			.replace(
				'#include <metalnessmap_fragment>',
				'float metalnessFactor = clamp(triOrm.b,0.0,1.0);',
			)
			.replace(
				'#include <aomap_fragment>',
				ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'triOrm.r'),
			)
			.replace(
				'#include <lights_physical_fragment>',
				ShaderChunk.lights_physical_fragment.replace(
					'material.specularColor = vec3( 0.04 );',
					'material.specularColor = vec3(0.08*clamp(triSpecular,0.0,1.0));',
				),
			);
	};
	material.customProgramCacheKey = () => 'source_triplanar_hbc_native_cm_v2';
	material.needsUpdate = true;
}
