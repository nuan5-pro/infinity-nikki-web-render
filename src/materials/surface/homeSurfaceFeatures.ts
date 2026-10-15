import {
	Vector2,
	Vector3,
	Vector4,
	type Matrix4,
	type MeshStandardMaterial,
	type Texture,
} from 'three';
import type { FurnitureSurface } from './surfaceShader.js';

/** Native X/Z axes through the component transform and the final geometry frame.
 * Unit conversion and root translation do not belong to ObjectScale. */
export function homeWallBasis(sourceMatrix: Matrix4): [number[], number[]] {
	const e = sourceMatrix.elements;
	// Source GLTF (native X/Z/Y) -> prepared geometry (Y/-X/Z).
	return [
		[e[2]!, -e[0]!, e[1]!],
		[e[6]!, -e[4]!, e[5]!],
	];
}

/** Source HomeWallUV, additive detail-normal and cloth-fuzz branches. */
export function applyHomeSurfaceFeatures(material: MeshStandardMaterial, surface: FurnitureSurface, detail: Texture | null, raw: number): void {
	const wall = surface.homeUv;
	const normal = surface.detail;
	const fuzz = surface.fuzz;
	if (!wall && !normal && !fuzz) return;
	if (normal && !detail) throw new Error('Home detail-normal consumer requires N1');

	const basis = material.userData.homeWallBasis as number[][] | undefined;
	if (
		wall &&
		(!Array.isArray(basis) ||
			basis.length !== 2 ||
			basis.some(
				(axis) =>
					!Array.isArray(axis) ||
					axis.length !== 3 ||
					!axis.every(Number.isFinite) ||
					!axis.some((value) => value !== 0),
			))
	) throw new Error('HomeWallUV requires its component X/Z transform basis');

	const compile = material.onBeforeCompile;
	const cache = material.customProgramCacheKey.bind(material);
	const key = cache();
	material.onBeforeCompile = (shader, renderer) => {
		compile.call(material, shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
#ifndef USE_UV1
attribute vec2 uv1;
#endif
#ifndef USE_UV3
attribute vec2 uv3;
#endif
uniform vec4 homeWallTransform;
uniform vec2 homeWallControl;
uniform vec3 homeWallBasisX, homeWallBasisZ;
uniform float homeRaw;
uniform vec4 homeDetailUV;
uniform vec2 homeDetailScale;
varying vec2 vHomeDetailUV;
varying vec2 vHomeSourceUV;`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vHomeSourceUV = uv;
vHomeDetailUV = ${normal ? '(uv*homeDetailUV.x + uv1*homeDetailUV.y + uv2*homeDetailUV.z + uv3*homeDetailUV.w)*homeDetailScale' : 'uv'};`,
			);
		if (wall) {
			shader.vertexShader = shader.vertexShader.replace(
				'vSurfaceUv = uv * homeUvScale + homeUvOffset;',
				`
// Native VS 8a3dfcf1 packs primitive X/Z axis lengths in TEXCOORD1.zw,
// not mesh UV3. Keep component axes after merging and use each instance's TRS.
mat3 homeWallWorld = mat3(modelMatrix);
#ifdef USE_INSTANCING
homeWallWorld = homeWallWorld * mat3(instanceMatrix);
#endif
vec2 homeWallScale = vec2(length(homeWallWorld * homeWallBasisX), length(homeWallWorld * homeWallBasisZ));
vSurfaceUv = mix(uv,uv1,homeWallControl.y)*vec2(homeWallScale.x,mix(1.0,homeWallScale.y,homeWallControl.x));
vSurfaceUv = vSurfaceUv*homeWallTransform.xy + homeWallTransform.zw;
vSurfaceUv.x += homeRaw >= 100.0 ? 0.5 : 0.0;`,
			);
		}

		Object.assign(shader.uniforms, {
			homeWallTransform: { value: new Vector4(...(wall?.transform ?? [1, 1, 0, 0])) },
			homeWallControl: { value: new Vector2(wall?.isWall ?? 1, wall?.mirror ?? 0) },
			homeRaw: { value: raw },
			homeWallBasisX: { value: new Vector3().fromArray(basis?.[0] ?? [0, 0, 0]) },
			homeWallBasisZ: { value: new Vector3().fromArray(basis?.[1] ?? [0, 0, 0]) },
			homeDetail: { value: detail },
			homeDetailUV: { value: new Vector4(...(normal?.uvWeights ?? [1, 0, 0, 0])) },
			homeDetailScale: { value: new Vector2(...(normal?.uvScale ?? [1, 1])) },
			homeDetailIntensity: { value: normal?.intensity ?? 1 },
			homeFuzzColor: { value: new Vector4(...(fuzz?.color ?? [0, 0, 0, 0])) },
			homeFuzzControls: {
				value: new Vector4(fuzz?.roughness ?? 0.5, fuzz?.smoothness ?? 0.5, fuzz?.useBaseColor ?? 0, fuzz?.baseOutput ?? 0),
			},
		});
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			`#include <common>
varying vec2 vHomeDetailUV;
varying vec2 vHomeSourceUV;
uniform sampler2D homeDetail;
uniform float homeDetailIntensity;
uniform vec4 homeFuzzColor, homeFuzzControls;`,
		);
		if (normal) {
			shader.fragmentShader = shader.fragmentShader.replace(
				'mapN.xy *= normalScale;',
				`
vec2 homeDetailRG = texture2D(homeDetail,vHomeDetailUV).rg*2.0-1.0;
vec3 homeDetailN = vec3(homeDetailRG,sqrt(max(1.0-dot(homeDetailRG,homeDetailRG),0.0)));
homeDetailN = mix(vec3(0.0,0.0,1.0),homeDetailN,homeDetailIntensity);
mapN = vec3(mapN.xy+homeDetailN.xy,mapN.z*homeDetailN.z);
mapN.xy *= normalScale;`,
			);
		}

		if (fuzz) {
			shader.fragmentShader = shader.fragmentShader.replace(
				'PhysicalMaterial material;',
				`
#if NUM_DIR_LIGHTS > 0
vec3 homeFuzzL = normalize(directionalLights[0].direction);
vec3 homeFuzzV = isOrthographic ? vec3(0.0,0.0,1.0) : normalize(vViewPosition);
float homeNL = dot(normal,homeFuzzL), homeNV = dot(normal,homeFuzzV);
float homeVL = dot(homeFuzzV,homeFuzzL);
float homeHalfLength = inversesqrt(max(2.0+2.0*homeVL,0.000001));
float homeNH = clamp((homeNL+homeNV)*homeHalfLength,0.0,1.0);
float homeInvR = 1.0/homeFuzzControls.x;
float homeD = clamp((homeInvR+2.0)*pow(max(1.0-homeNH*homeNH,0.0078125),homeInvR*0.5)*0.159154943,0.0,1.0);
float homeAbsNV = min(abs(homeNV)+0.00001,1.0);
float homeVis = 1.0/max(4.0*(homeAbsNV+homeNL-homeAbsNV*homeNL),0.000001);
float homeFresnel = pow(1.0-clamp((1.0+homeVL)*homeHalfLength,0.0,1.0),5.0);
vec3 homeFuzzBase = homeFuzzColor.rgb*mix(vec3(1.0),furnitureSurfaceBase,homeFuzzControls.z);
vec3 homeFuzz = clamp(mix(homeFuzzBase,vec3(1.0),homeFresnel),0.0,1.0)*homeD*homeVis*homeNL*homeFuzzColor.a*clamp(homeNL,0.0,1.0)*3.141592654;
float homeSmooth = clamp(fract(sin(dot(vHomeSourceUV,vec2(12.083533,38.036007))*6.283185)*50000.0)*0.3+homeFuzzControls.y,0.0,1.0);
homeFuzz *= homeSmooth;
diffuseColor.rgb = clamp(diffuseColor.rgb+homeFuzz*homeFuzzControls.w,0.0,1.0);
totalEmissiveRadiance += homeFuzz*(1.0-homeFuzzControls.w);
#endif
PhysicalMaterial material;`,
			);
		}
	};
	material.customProgramCacheKey = () => `${key}_home_v2_${!!wall}_${!!normal}_${!!fuzz}`;
	material.needsUpdate = true;
}
