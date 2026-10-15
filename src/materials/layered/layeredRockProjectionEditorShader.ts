import { Vector2, Vector3, Vector4 } from 'three';
import type { LayeredRole } from './layeredShader.js';
import type { RockProjectionCollectionPayload } from './rockProjectionCollectionTexture.js';

type RGB = [number, number, number];

type Vec4 = [number, number, number, number];

export interface RockProjectionEditorConfig {
	version: 1;
	material: Vec4[];
	secondaryUV: 'compiled-zero';
	basis: 'native-vm-snorm8-raw-interpolated';
	viewer: {
		worldOriginUECm: RGB;
		viewTile: [number, number];
		mipBias: number;
		minFilter: 'LINEAR_MIPMAP_LINEAR';
		magFilter: 'LINEAR';
	};
	collection: {
		lands: Vec4;
		wetness: 0;
		payload: RockProjectionCollectionPayload;
	};
}

const finite = (value: unknown, count: number): value is number[] => {
	if (!Array.isArray(value) || value.length !== count) return false;

	for (let index = 0; index < count; index++) {
		const item = value[index];
		if (typeof item !== 'number' || !Number.isFinite(item)) return false;
	}

	return true;
};

export function validRockProjectionEditor(value: unknown): value is RockProjectionEditorConfig {
	if (!value || typeof value !== 'object') return false;

	const config = value as RockProjectionEditorConfig;
	if (
		config.version !== 1 ||
		config.secondaryUV !== 'compiled-zero' ||
		config.basis !== 'native-vm-snorm8-raw-interpolated' ||
		!Array.isArray(config.material) ||
		config.material.length !== 33
	) return false;

	for (let index = 0; index < 33; index++) {
		if (!finite(config.material[index], 4)) return false;
	}

	const viewer = config.viewer;
	if (
		!viewer ||
		!finite(viewer.worldOriginUECm, 3) ||
		!finite(viewer.viewTile, 2) ||
		!Number.isFinite(viewer.mipBias) ||
		viewer.minFilter !== 'LINEAR_MIPMAP_LINEAR' ||
		viewer.magFilter !== 'LINEAR'
	) return false;

	const collection = config.collection;
	if (
		!collection ||
		!finite(collection.lands, 4) ||
		collection.lands.some((value, i) => value !== [0, 0, 604800, 0][i]) ||
		collection.wetness !== 0 ||
		!collection.payload
	) return false;
	// These source terms remain fenced. The editor collection domain does not
	// authorize native wetness, temporal colour, selection or view overrides.
	const m = config.material;
	const wetness = m[28];
	const height = m[27];
	const breathing = m[18];
	const selection = m[19];
	if (
		!wetness ||
		!height ||
		!breathing ||
		!selection ||
		wetness[1] !== 0 ||
		height[1] !== 0 ||
		breathing.some((value) => value !== 0) ||
		selection.some((value) => value !== 0)
	) return false;

	return true;
}

export function rockProjectionEditorUniforms(config: RockProjectionEditorConfig) {
	if (!validRockProjectionEditor(config)) throw new Error('[RockProjectionEditor] invalid captured editor contract');

	return {
		rockProjectionMaterial: { value: config.material.map((value) => new Vector4(...value)) },
		rockProjectionLands: { value: new Vector4(...config.collection.lands) },
		rockProjectionWorldOrigin: { value: new Vector3(...config.viewer.worldOriginUECm) },
		rockProjectionViewTile: { value: new Vector2(...config.viewer.viewTile) },
		rockProjectionMipBias: { value: config.viewer.mipBias },
	};
}

export const rockProjectionEditorUniformDeclarations = `
uniform vec4 rockProjectionMaterial[33];
uniform vec4 rockProjectionLands;
uniform vec3 rockProjectionWorldOrigin;
uniform vec2 rockProjectionViewTile;
uniform float rockProjectionMipBias;
uniform sampler2D rockProjectionCollectionTexture;
varying vec3 vProjectionRawNormal;
varying vec3 vProjectionRawTangent;
varying float vProjectionRawHandedness;
`;

// sample returns the existing bound role in its actual source transfer domain.
// The collection SRV is independent: it is not a leaf texture role or a colour
// multiplier. Raw N/T and handedness require the separately fenced transport.
export function rockProjectionEditorCore(sample: (role: LayeredRole, uv: string, bias?: string) => string): string {
	return `
vec3 projectionN = vProjectionRawNormal;
vec3 projectionT = vProjectionRawTangent;
vec3 projectionB = cross(projectionN, projectionT) * vProjectionRawHandedness;
vec3 projectionWorld = vLayerWorldPosition + rockProjectionWorldOrigin;
// Actual draw camera; the same source/viewer frame maps both positions.
vec3 projectionCamera = furnitureNativeWorld(cameraPosition) + rockProjectionWorldOrigin;
vec2 projectionCollectionUV = (projectionWorld.xy - rockProjectionLands.xy) / rockProjectionLands.z + vec2(0.5)
  + fract(rockProjectionViewTile * 2097152.0 / rockProjectionLands.z);
float projectionLinearG = texture2D(rockProjectionCollectionTexture, projectionCollectionUV, rockProjectionMipBias).g;
float projectionRandomShift = projectionLinearG * rockProjectionMaterial[8].x;
vec2 projectionMaskPoint = vLayerUv0 * rockProjectionMaterial[7].w + vec2(projectionRandomShift) - vec2(0.5);
vec2 projectionMaskUV = vec2(dot(projectionMaskPoint, rockProjectionMaterial[8].yz), dot(projectionMaskPoint, rockProjectionMaterial[9].xy)) + vec2(0.5);
vec4 projectionBlend = ${sample('B', 'projectionMaskUV')};
float projectionInnerWeight = clamp(mix(rockProjectionMaterial[9].w, rockProjectionMaterial[9].z, projectionBlend.g), 0.0, 1.0) * rockProjectionMaterial[10].x;
// Exact GPUD VS o3.zw=0. Never replace this with source UV1/object scale.
vec2 projectionSecondaryUV = vec2(0.0);
vec2 projectionPoint01 = projectionSecondaryUV * rockProjectionMaterial[4].xy - vec2(0.5);
vec2 projectionUV01 = vec2(dot(projectionPoint01, rockProjectionMaterial[4].zw), dot(projectionPoint01, rockProjectionMaterial[5].xy)) + vec2(0.5);
vec2 projectionPoint03 = projectionSecondaryUV * rockProjectionMaterial[6].xy - vec2(0.5);
vec2 projectionUV03 = vec2(dot(projectionPoint03, rockProjectionMaterial[6].zw), dot(projectionPoint03, rockProjectionMaterial[7].xy)) + vec2(0.5);
vec2 projectionBaseRG = ${sample('M', 'vLayerUv0')}.rg * 2.0 - 1.0;
vec3 projectionBaseN = vec3(projectionBaseRG, sqrt(max(1.0 - dot(projectionBaseRG, projectionBaseRG), 0.0))) * rockProjectionMaterial[3].xyz;
vec2 projectionRG01 = ${sample('N', 'projectionUV01')}.rg * 2.0 - 1.0;
vec2 projectionRG03 = ${sample('N1', 'projectionUV03')}.rg * 2.0 - 1.0;
vec3 projectionNormal01 = vec3(projectionRG01, sqrt(max(1.0 - dot(projectionRG01, projectionRG01), 0.0)));
vec3 projectionNormal03 = vec3(projectionRG03, sqrt(max(1.0 - dot(projectionRG03, projectionRG03), 0.0)));
projectionNormal01 = (projectionNormal01 - vec3(0.0, 0.0, 1.0)) * rockProjectionMaterial[5].z + vec3(0.0, 0.0, 1.0);
projectionNormal03 = (projectionNormal03 - vec3(0.0, 0.0, 1.0)) * rockProjectionMaterial[7].z + vec3(0.0, 0.0, 1.0);
vec3 projectionInnerN = mix(vec3(projectionBaseN.xy + projectionNormal01.xy, projectionBaseN.z * projectionNormal01.z),
  vec3(projectionBaseN.xy + projectionNormal03.xy, projectionBaseN.z * projectionNormal03.z), projectionInnerWeight);
vec2 projectionDetailRG = ${sample('T', 'vLayerUv0 * rockProjectionMaterial[10].y', 'rockProjectionMipBias')}.rg * 2.0 - 1.0;
vec3 projectionDetailN = vec3(projectionDetailRG, sqrt(max(1.0 - dot(projectionDetailRG, projectionDetailRG), 0.0)));
projectionDetailN = ((projectionDetailN - vec3(0.0, 0.0, 1.0)) * (1.0 - abs(projectionN.z)) + vec3(0.0, 0.0, 1.0)) * rockProjectionMaterial[11].xyz;
vec3 projectionRNMT = projectionInnerN + vec3(0.0, 0.0, 1.0);
vec3 projectionRNMU = projectionDetailN * vec3(-1.0, -1.0, 1.0);
vec3 projectionDetailBlend = projectionRNMT * dot(projectionRNMT, projectionRNMU) - projectionRNMU * projectionRNMT.z;
float projectionDetailFade = clamp((length(projectionWorld - projectionCamera) - rockProjectionMaterial[2].x) * rockProjectionMaterial[2].y, 0.0, 1.0);
projectionInnerN = mix(projectionDetailBlend, projectionInnerN, projectionDetailFade);
vec2 projectionTopUV = mix(projectionWorld.xy * 0.00125, vLayerUv0, rockProjectionMaterial[11].w) * rockProjectionMaterial[12].x
  + fract(rockProjectionViewTile * 0.00125 * (1.0 - rockProjectionMaterial[11].w) * rockProjectionMaterial[12].x * 2097152.0);
vec3 projectionTopN = ${sample('N2', 'projectionTopUV')}.rgb * 2.0 - 1.0;
vec3 projectionTopRNMT = projectionN + vec3(0.0, 0.0, 1.0);
vec3 projectionTopRNMU = projectionTopN * vec3(-1.0, -1.0, 1.0);
vec3 projectionTopReoriented = projectionTopRNMT * dot(projectionTopRNMT, projectionTopRNMU) - projectionTopRNMU * projectionTopRNMT.z;
projectionTopN = mix(projectionTopN, projectionTopReoriented, rockProjectionMaterial[12].y);
vec3 projectionTopTangent = vec3(dot(projectionT, projectionTopN), dot(projectionB, projectionTopN), dot(projectionN, projectionTopN));
projectionTopTangent.xy *= rockProjectionMaterial[12].z;
vec3 projectionInnerWorldN = projectionT * projectionInnerN.x + projectionB * projectionInnerN.y + projectionN * projectionInnerN.z;
vec3 projectionEffectiveN = normalize(mix(projectionN, projectionInnerWorldN, rockProjectionMaterial[12].w));
vec3 projectionOrientation = normalize(mix(vLayerObjectOrientation, vec3(0.0, 0.0, 1.0), rockProjectionMaterial[13].x));
float projectionAngle = ((dot(projectionEffectiveN, projectionOrientation) + projectionN.z * rockProjectionMaterial[13].y + 1.0) * 0.5 + 1.0) * 0.5;
float projectionTopWeight = (projectionAngle * rockProjectionMaterial[13].z + rockProjectionMaterial[13].w) * vLayerColor.r;
projectionTopWeight = clamp(projectionTopWeight * (rockProjectionMaterial[14].x - rockProjectionMaterial[14].y) + rockProjectionMaterial[14].y, 0.0, 1.0);
vec4 projectionBaseMask = ${sample('C', 'vLayerUv0')};
projectionTopWeight = clamp((projectionTopWeight + projectionBaseMask.g * rockProjectionMaterial[14].z) * (projectionBaseMask.a * rockProjectionMaterial[14].w), 0.0, 1.0);
layeredNormal = normalize(mix(projectionInnerN, projectionTopTangent, projectionTopWeight));
vec3 projectionColor01 = ${sample('D', 'projectionUV01')}.rgb * rockProjectionMaterial[20].xyz;
vec3 projectionColor03 = ${sample('D1', 'projectionUV03')}.rgb * rockProjectionMaterial[21].xyz;
projectionColor01 = mix(projectionColor01, vec3(dot(projectionColor01, vec3(0.3, 0.59, 0.11))), rockProjectionMaterial[20].w);
projectionColor03 = mix(projectionColor03, vec3(dot(projectionColor03, vec3(0.3, 0.59, 0.11))), rockProjectionMaterial[21].w);
vec3 projectionRockColor = mix(projectionColor01, projectionColor03, projectionInnerWeight);
float projectionCurvature = projectionBaseMask.r > 0.0 ? pow(projectionBaseMask.r, rockProjectionMaterial[22].x) * rockProjectionMaterial[22].y : 0.0;
projectionRockColor = mix(projectionRockColor, projectionCurvature * rockProjectionMaterial[23].xyz, projectionCurvature * rockProjectionMaterial[23].w);
vec3 projectionTopColor = ${sample('D2', 'projectionTopUV')}.rgb * rockProjectionMaterial[24].xyz;
projectionTopColor = mix(projectionTopColor, vec3(dot(projectionTopColor, vec3(0.3, 0.59, 0.11))), rockProjectionMaterial[24].w);
projectionTopColor = layeredSrgbDecode(projectionTopColor);
vec3 projectionFinalColor = mix(projectionRockColor, projectionTopColor, projectionTopWeight);
diffuseColor.rgb = clamp(mix(projectionFinalColor, projectionFinalColor * rockProjectionMaterial[25].x, projectionBlend.b), 0.0, 1.0);
vec4 projectionOR01 = ${sample('O', 'projectionUV01')};
vec4 projectionOR03 = ${sample('O1', 'projectionUV03')};
vec4 projectionORTop = ${sample('O2', 'projectionTopUV')};
layeredMetal = clamp(mix(projectionOR01.b * rockProjectionMaterial[28].z, projectionOR03.b * rockProjectionMaterial[28].w, projectionInnerWeight) * (1.0 - projectionTopWeight), 0.0, 1.0);
layeredRoughness = clamp(mix(mix(projectionOR01.g * rockProjectionMaterial[29].y, projectionOR03.g * rockProjectionMaterial[29].z, projectionInnerWeight), projectionORTop.g * rockProjectionMaterial[29].w, projectionTopWeight), 0.0, 1.0);
float projectionAO01 = clamp(mix(rockProjectionMaterial[30].z, rockProjectionMaterial[30].y, projectionOR01.r), 0.0, 1.0);
float projectionAO03 = clamp(mix(rockProjectionMaterial[32].x, rockProjectionMaterial[30].w, projectionOR03.r), 0.0, 1.0);
layeredOcclusion = clamp(mix(mix(projectionAO01, projectionAO03, projectionInnerWeight), rockProjectionMaterial[32].y, projectionTopWeight)
  * mix(rockProjectionMaterial[32].w, rockProjectionMaterial[32].z, projectionBaseMask.b), 0.0, 1.0);
layeredEmission = max(mix(rockProjectionMaterial[16].xyz, rockProjectionMaterial[15].xyz, projectionBlend.a), vec3(0.0));
layeredSpecularValue = mix(0.5, rockProjectionMaterial[29].x, projectionTopWeight);
`;
}
