import {
	AdditiveBlending,
	NormalBlending,
	Color,
	DoubleSide,
	Matrix3,
	Matrix4,
	MeshStandardMaterial,
	Vector3,
	Vector4,
	type Material,
	type Texture,
	type BufferGeometry,
	type Camera,
} from 'three';
import {
	assertWaterFxGeometry,
	waterFxActiveInputs,
	waterFxStaticShader,
	waterFxUniforms,
	type WaterFX,
} from './waterFx.js';
import { type WaterFxMergedDomain } from './waterFxGeometry.js';
import { geometryRevision, sameGeometryRevision } from '../../runtime/geometryCache.js';
import { materialTime } from '../../runtime/materialClock.js';

export interface WaterFxMaterialOptions {
	lighting: 'editor-standard-preview' | 'source-unlit-proven';
	nativeBitangentSign: 1 | -1;
	// Explicit preview view/emissive domain. No helper assumes captured game
	// Scene/PreExposure constants from the fact that ordinary editor values are1.
	emissiveScale: number;
	preExposure: number;
	roughness: number;
	metalness: number;
	primitiveHoldout: number;
	// Source Primitive.ObjectWorldPosition is the component bounds center;
	// caller supplies its proven imported local center, not the group origin.
	objectCenter: [number, number, number];
	nativePrimitiveSign: 1 | -1;
	geometryProofSlot?: number;
	previewTimeOfDay?: number;
}

/** Local transparent preview: authored flow/masks/TBN, without depth intersection or native HDR transport. */
export function createLightweightWaterFxMaterial(
	config: WaterFX,
	textures: Record<string, Texture>,
	options: WaterFxMaterialOptions,
	source?: Material,
): MeshStandardMaterial {
	if (
		!options.objectCenter.every(Number.isFinite) ||
		![
			options.emissiveScale,
			options.preExposure,
			options.roughness,
			options.metalness,
			options.primitiveHoldout,
		].every(Number.isFinite) ||
		options.preExposure <= 0 ||
		options.emissiveScale < 0 ||
		![1, -1].includes(options.nativeBitangentSign) ||
		![1, -1].includes(options.nativePrimitiveSign) ||
		options.primitiveHoldout < 0 ||
		options.primitiveHoldout > 1
	) throw new Error('X6FX factory requires valid basis signs and finite preview parameters');

	const active = waterFxActiveInputs(config, options.lighting === 'editor-standard-preview');
	if (
		options.previewTimeOfDay !== undefined &&
		(!Number.isFinite(options.previewTimeOfDay) ||
			options.previewTimeOfDay < 0 ||
			options.previewTimeOfDay > 1)
	) throw new Error('X6FX local preview TOD must be a normalized static selection');

	const endpoints = [config.material[21]?.[3], ...config.material[22]!.slice(0, 3)];
	if (
		active.sourceTOD &&
		options.previewTimeOfDay === undefined &&
		!endpoints.every((value) => value === endpoints[0])
	) throw new Error('X6FX local preview requires an explicit static TOD selection');

	const uniforms = {
		...waterFxUniforms(config, textures, active.textures),
		fxTime: { value: 0 },
		fxMipBias: { value: 0 },
		fxTimeOfDay: { value: 0 },
		fxNormalBiasScale: { value: new Vector4(0, 0, 0, 1) },
		fxInverseView: { value: new Matrix4() },
		fxSceneOrthographic: { value: false },
		fxSceneUnits: { value: 1 },
		fxWorldToNative: { value: new Matrix3().set(0, -1, 0, 1, 0, 0, 0, 0, 1) },
		fxBitangentSign: { value: options.nativeBitangentSign },
		fxPrimitiveSign: { value: options.nativePrimitiveSign },
		fxEmissiveScale: { value: options.emissiveScale },
		fxPreExposure: { value: options.preExposure },
		fxHoldout: { value: options.primitiveHoldout },
		fxObjectCenter: { value: new Vector3(...options.objectCenter) },
	};

	const material = new MeshStandardMaterial({
		color: new Color(1, 1, 1),
		roughness: options.roughness,
		metalness: options.metalness,
		side: source?.side ?? DoubleSide,
		forceSinglePass: true,
	});
	material.defines = { USE_TANGENT: '' };
	if (config.material[13]![1] !== 0) material.defines.USE_UV1 = '';
	material.name = source?.name ?? 'Native X6FX preview';
	material.userData = {
		...source?.userData,
		waterFx: config,
	};
	if (source) {
		material.depthTest = source.depthTest;
		material.colorWrite = source.colorWrite;
		material.visible = source.visible;
	}

	material.transparent = true;
	material.depthWrite = false;
	material.alphaTest = 0;
	material.premultipliedAlpha = false;
	material.name = source?.name ?? 'Local flow preview';
	material.toneMapped = true;
	material.blending = config.blend === 'additive' ? AdditiveBlending : NormalBlending;
	uniforms.fxTimeOfDay.value = options.previewTimeOfDay ?? 0;

	const checkedGeometry = new WeakMap<BufferGeometry, unknown[]>();

	const assertGeometry = (geometry: BufferGeometry) => {
		const revision = [
			...geometryRevision(geometry),
			geometry.userData.waterFxDomains,
			geometry.userData.waterFxColorProof,
		];

		const previous = checkedGeometry.get(geometry);
		if (previous && sameGeometryRevision(previous, revision)) return;

		assertWaterFxGeometry(config, geometry);

		const count = geometry.getAttribute('position')?.count;
		for (const [key, size] of [
			['normal', 3],
			['tangent', 4],
			['uv', 2],
		] as const) {
			const attribute = geometry.getAttribute(key);
			if (!attribute || attribute.itemSize !== size || attribute.count !== count) throw new Error(`X6FX requires proven source ${key}`);
		}

		if (options.geometryProofSlot !== undefined) {
			const domain = geometry.userData.waterFxDomains?.[options.geometryProofSlot] as
				| WaterFxMergedDomain
				| undefined;
			if (
				!domain?.color.projectionBasisVerified ||
				domain.source.shader !== config.shader ||
				domain.checkedVertices !== domain.color.checkedVertices ||
				domain.vertexStart < 0 ||
				domain.vertexStart + domain.checkedVertices > count! ||
				domain.objectCenter.some((value, index) => value !== options.objectCenter[index])
			) throw new Error('X6FX merged material slot has no native RGBA/TBN/component admission');

			const groups = geometry.groups.filter((group) => group.materialIndex === options.geometryProofSlot);
			if (
				!geometry.index ||
				groups.reduce((sum, group) => sum + group.count, 0) !== domain.source.streams.indices?.count
			) throw new Error('X6FX merged topology no longer matches its admitted native slot');

			for (const group of groups)
				for (let index = group.start; index < group.start + group.count; index++) {
					const vertex = geometry.index.getX(index);
					if (
						vertex < domain.vertexStart ||
						vertex >= domain.vertexStart + domain.checkedVertices
					) throw new Error('X6FX draw references non-FX merge padding instead of native source vertices');
				}
		} else if (!geometry.userData.waterFxColorProof?.projectionBasisVerified) throw new Error('X6FX full-RGBA/TBN carrier has no native admission proof');

		checkedGeometry.set(geometry, revision);
	};

	material.onBeforeRender = (renderer, _scene, camera, geometry) => {
		assertGeometry(geometry);
		uniforms.fxTime.value = materialTime(renderer);
		uniforms.fxInverseView.value.copy(camera.matrixWorld);
		uniforms.fxSceneOrthographic.value = (camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
	};

	const programKey = `local_flow_v1_${config.shader}_${options.lighting}_${JSON.stringify(config.material)}`;
	material.customProgramCacheKey = () => programKey;
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec4 ueWaterFxColor;
varying vec4 vFxColor;
varying vec2 vFxUv0, vFxUv1;
varying float vFxDeterminant, vFxTangentSign;`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vFxColor=ueWaterFxColor;
vFxTangentSign=tangent.w;
vFxUv0=uv;
vFxUv1=${config.material[13]![1] !== 0 ? 'uv1' : 'uv'};
mat3 fxInstanceBasis=mat3(modelMatrix);
#ifdef USE_BATCHING
fxInstanceBasis=fxInstanceBasis*mat3(batchingMatrix);
#endif
#ifdef USE_INSTANCING
fxInstanceBasis=fxInstanceBasis*mat3(instanceMatrix);
#endif
vFxDeterminant=sign(determinant(fxInstanceBasis));`,
			);
		shader.vertexShader = shader.vertexShader
			.replace(
				'varying float vFxDeterminant, vFxTangentSign;',
				'varying float vFxDeterminant, vFxTangentSign;\nuniform vec3 fxObjectCenter;\nvarying float vFxObjectWorldZ;',
			)
			.replace(
				'#include <worldpos_vertex>',
				`#include <worldpos_vertex>
vec4 fxCenterWorld=vec4(fxObjectCenter,1.0);
#ifdef USE_BATCHING
fxCenterWorld=batchingMatrix*fxCenterWorld;
#endif
#ifdef USE_INSTANCING
fxCenterWorld=instanceMatrix*fxCenterWorld;
#endif
vFxObjectWorldZ=(modelMatrix*fxCenterWorld).z;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec4 vFxColor;
varying vec2 vFxUv0, vFxUv1;
varying float vFxDeterminant, vFxTangentSign;
varying float vFxObjectWorldZ;
uniform float fxTime, fxTimeOfDay, fxBitangentSign, fxPrimitiveSign;
uniform float fxEmissiveScale, fxPreExposure, fxHoldout;
uniform mat4 fxInverseView;
uniform mat3 fxWorldToNative;
uniform vec4 fxNormalBiasScale;
  uniform bool fxSceneOrthographic; uniform float fxSceneUnits;
  ${waterFxStaticShader(config).replace('coverage*=clamp(depthDeltaCm*fxM[32].w,0.0,1.0);', '')}`,
			)
			.replace(
				'#include <normal_fragment_maps>',
				`
mat3 fxViewToNative=fxWorldToNative*mat3(fxInverseView);
// Native PS reconstructs B from interpolated N/T, not Three's separately
// interpolated vertex bitangent. Native VS o1.w includes primitive determinant.
vec3 fxNativeT=fxViewToNative*vTangent;
vec3 fxNativeN=fxViewToNative*vNormal;
mat3 fxNativeFrame=mat3(fxNativeT,cross(fxNativeN,fxNativeT)*vFxTangentSign*fxBitangentSign*vFxDeterminant,fxNativeN);
vec3 fxViewDir=fxSceneOrthographic ? vec3(0.0,0.0,1.0) : normalize(vViewPosition);
float fxFaceSign=(gl_FrontFacing ? 1.0 : -1.0)*vFxDeterminant*fxPrimitiveSign;
WaterFxSample fxValue=sampleWaterFx(vFxUv0,vFxUv1,vFxColor,fxNativeFrame,normalize(fxViewToNative*fxViewDir),fxFaceSign,
  fxNormalBiasScale,fxTime,0.0,length(vViewPosition)*fxSceneUnits,
  clamp((cameraPosition.z-vFxObjectWorldZ)*fxSceneUnits,0.0,1.0),
  fxTimeOfDay,fxEmissiveScale,fxPreExposure);
// Convert native-frame world normal back to view coordinates without double
// face/TBN handedness multiplication.
normal=normalize(transpose(fxViewToNative)*fxValue.normal);
diffuseColor.rgb=fxValue.baseColor;
diffuseColor.a=fxValue.coverage;`,
			)
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=fxValue.emission;')
			.replace(
				'#include <opaque_fragment>',
				`
gl_FragColor=vec4(${options.lighting === 'source-unlit-proven' ? 'fxValue.emission' : 'outgoingLight'},fxValue.coverage*(1.0-fxHoldout));`,
			);
	};
	return material;
}
