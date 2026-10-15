import {
	DoubleSide,
	NormalBlending,
	ShaderChunk,
	Vector2,
	Vector3,
	Vector4,
	type MeshStandardMaterial,
	type Texture,
} from 'three';
import type { FurnitureSurface } from '../surface/surfaceShader.js';
import { translucentLaceNormalSigns } from './translucentLaceShader.js';

/** d3474a / b669404 shared static material core. Scene lighting and OIT are
 * editor previews; Glint is intentionally absent. Palette weight is not clamped. */
export function applyTranslucentHbcShader(
	material: MeshStandardMaterial,
	surface: FurnitureSurface,
	orm: Texture | null,
	tint: Texture | null,
	detail: Texture | null,
): void {
	const c = surface.translucent;
	if (!c || !orm || !tint || !detail || !material.map || !material.normalMap) throw new Error('Translucent HBC requires D/N/O/T/N1 and its source parameters');

	const signs = translucentLaceNormalSigns(material);
	material.color.setRGB(1, 1, 1);
	material.transparent = true;
	material.depthWrite = false;
	material.side = DoubleSide;
	material.forceSinglePass = true;
	material.blending = NormalBlending;
	material.opacity = 1;
	material.alphaTest = 0;
	material.alphaMap = null;
	material.alphaHash = false;
	material.aoMap = null;
	material.emissiveMap = null;
	material.emissiveIntensity = 1;
	material.userData.translucentLaceNormalSigns = signs;
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, {
			hbcD: { value: material.map },
			hbcN: { value: material.normalMap },
			hbcO: { value: orm },
			hbcT: { value: tint },
			hbcDetail: { value: detail },
			hbcColor: { value: new Vector3(...surface.color) },
			hbcFuzzy: { value: new Vector3(...c.fuzzy) },
			hbcOpacity: { value: new Vector4(...c.opacity) },
			hbcUV: { value: new Vector3(surface.uvScale, c.detailUvScale, c.rotation) },
			hbcDetailFlatness: { value: c.detailFlatness },
			hbcMask: { value: c.blockMask },
			hbcNormalSigns: { value: new Vector2(...signs) },
			hbcRoughness: { value: new Vector2(...surface.roughness) },
			hbcMetalness: { value: new Vector2(...surface.metalness) },
			hbcSpecular: { value: surface.specular?.[0] ?? 0.5 },
			hbcColorAlpha: { value: c.colorAlpha },
			hbcEmission: { value: new Vector3(...c.emission) },
			hbcSecondFresnel: { value: new Vector4(...c.secondFresnel) },
			hbcEmissionParams: { value: new Vector2(...c.emissionParams) },
		});
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
#ifndef USE_UV2
attribute vec2 uv2;
#endif
varying vec2 vHbcUV;
varying vec2 vHbcPaletteUV;`,
			)
			.replace(
				'#include <uv_vertex>',
				`#include <uv_vertex>
vHbcUV = uv;
vHbcPaletteUV = uv2;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec2 vHbcUV;
varying vec2 vHbcPaletteUV;
uniform sampler2D hbcD, hbcN, hbcO, hbcT, hbcDetail;
uniform vec3 hbcColor, hbcFuzzy, hbcUV, hbcEmission;
uniform vec4 hbcOpacity, hbcSecondFresnel;
uniform vec2 hbcNormalSigns, hbcRoughness, hbcMetalness, hbcEmissionParams;
uniform float hbcDetailFlatness, hbcMask, hbcSpecular, hbcColorAlpha;
vec4 hbcAlbedo, hbcOrm;
vec3 hbcEmissionResult;
vec2 hbcRotate(vec2 uv) {
  float a = hbcUV.z * 6.2831854820251465;
  vec2 p = uv - 0.5;
  return vec2(cos(a)*p.x-sin(a)*p.y, sin(a)*p.x+cos(a)*p.y) + 0.5;
}
vec3 hbcNormal(vec2 rg) {
  vec2 xy = (rg*2.0-1.0)*hbcNormalSigns;
  return vec3(xy, sqrt(max(1.0-dot(xy,xy),0.0)));
}`,
			)
			.replace(
				'#include <map_fragment>',
				`hbcAlbedo = texture2D(hbcD, hbcRotate(vHbcUV*hbcUV.x));
hbcOrm = texture2D(hbcO, vHbcUV);`,
			)
			.replace('#include <color_fragment>', '')
			.replace(
				'#include <normal_fragment_begin>',
				ShaderChunk.normal_fragment_begin
					.replace('normal *= faceDirection;', '')
					.replace('tbn[0] *= faceDirection;', '')
					.replace('tbn[1] *= faceDirection;', ''),
			)
			.replace(
				'#include <normal_fragment_maps>',
				`
vec3 hbcMainN = hbcNormal(texture2D(hbcN,hbcRotate(vHbcUV*hbcUV.x)).rg);
vec3 hbcDetailN = hbcNormal(texture2D(hbcDetail,hbcRotate(vHbcUV*hbcUV.y)).rg);
hbcDetailN = mix(hbcDetailN,vec3(0.0,0.0,1.0),hbcDetailFlatness);
vec3 hbcRNMT = hbcMainN + vec3(0.0,0.0,1.0);
vec3 hbcRNMU = hbcDetailN * vec3(-1.0,-1.0,1.0);
vec3 hbcRNM = hbcRNMT * dot(hbcRNMT,hbcRNMU) - hbcRNMU*hbcRNMT.z;
normal = normalize(tbn*hbcRNM)*faceDirection;
vec3 hbcView = isOrthographic ? vec3(0.0,0.0,1.0) : normalize(vViewPosition);
float hbcNV = clamp(dot(hbcView,normalize(tbn*vec3(hbcRNM.xy,hbcRNM.z*faceDirection))),0.0,1.0);
float hbcEdge = hbcNV < 1.0 ? pow(1.0-hbcNV,hbcFuzzy.x)*hbcFuzzy.y : 0.0;
vec3 hbcBase = hbcAlbedo.rgb*hbcColor*(1.0-hbcNV*hbcFuzzy.z+hbcEdge);
vec3 hbcPalette = texture2D(hbcT,vHbcPaletteUV).rgb;
vec3 hbcOverlay = mix(2.0*hbcBase*hbcPalette,1.0-2.0*(1.0-hbcBase)*(1.0-hbcPalette),step(vec3(0.5),hbcBase));
vec3 hbcTinted = mix(hbcBase,hbcOverlay,hbcMask);
diffuseColor.rgb = clamp(hbcTinted,0.0,1.0);
#include <color_fragment>
float hbcF = max(abs(1.0-max(dot(hbcView,normal),0.0)),0.0001);
diffuseColor.a = clamp(mix(mix(hbcOpacity.x,hbcOpacity.y,hbcAlbedo.a),pow(hbcF,hbcOpacity.z),hbcOpacity.w),0.0,1.0);
hbcEmissionResult = (hbcAlbedo.rgb*hbcColor*hbcEdge*hbcColorAlpha + hbcSecondFresnel.rgb*pow(hbcF,hbcSecondFresnel.a) + hbcEmission)*hbcOrm.a;
hbcEmissionResult *= mix(vec3(1.0),hbcTinted,hbcEmissionParams.x)*hbcEmissionParams.y;`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				'float roughnessFactor = clamp(mix(hbcRoughness.x,hbcRoughness.y,hbcOrm.g),0.0,1.0);',
			)
			.replace(
				'#include <metalnessmap_fragment>',
				'float metalnessFactor = clamp(mix(hbcMetalness.x,hbcMetalness.y,hbcOrm.b),0.0,1.0);',
			)
			.replace(
				'#include <emissivemap_fragment>',
				'totalEmissiveRadiance = max(hbcEmissionResult,vec3(0.0));',
			)
			.replace(
				'#include <lights_physical_fragment>',
				ShaderChunk.lights_physical_fragment.replace(
					'material.specularColor = vec3( 0.04 );',
					'material.specularColor = vec3(0.08*clamp(hbcSpecular,0.0,1.0));',
				),
			);
	};
	material.customProgramCacheKey = () => 'source_translucent_hbc_v1_no_glint';
	material.needsUpdate = true;
}
