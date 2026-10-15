import {
	Color,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshStandardMaterial,
	NoColorSpace,
	RepeatWrapping,
	ShaderChunk,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4,
	type Material,
	type Texture,
} from 'three';
import { sceneSamplingShader, type SceneEdge, type SceneDetailNormal } from './sceneSampling.js';

export interface FurnitureScene {
	family: 'scene-single-layer'
	version: 1
	color: [number, number, number]
	roughness: [number, number]
	metalness: [number, number]
	ao: [number, number]
	normalIntensity: number
	specular: number
	textureSRGB: [boolean, boolean, boolean, boolean]
	textureMipmaps: [boolean, boolean, boolean, boolean]
	emissiveSource: '' | 'D' | 'O' | 'T'
	emissive: [number, number, number]
	coverage?: 'diffuse-alpha'
	cutoff?: number
	edge?: SceneEdge
	detailNormal?: SceneDetailNormal
	selectiveOutputMask?: number
}

export function readFurnitureScene(value: unknown): FurnitureScene | null {
	if (!value || typeof value !== 'object') return null;

	const scene = value as Record<string, unknown>;
	if (scene.family !== 'scene-single-layer' || scene.version !== 1) return null;
	if (
		scene.emissiveSource !== '' &&
		scene.emissiveSource !== 'D' &&
		scene.emissiveSource !== 'O' &&
		scene.emissiveSource !== 'T'
	) return null;
	if (scene.coverage !== undefined && scene.coverage !== 'diffuse-alpha') return null;
	if (scene.coverage && scene.cutoff !== 0.3333) return null;
	if (!scene.coverage && scene.cutoff !== undefined) return null;

	for (const key of ['textureSRGB', 'textureMipmaps']) {
		const flags = scene[key];
		if (
			!Array.isArray(flags) ||
			flags.length !== 4 ||
			!flags.every((flag) => typeof flag === 'boolean')
		) return null;
	}

	const transfer = scene.textureSRGB as boolean[];
	if (transfer[1]) return null;
	if (scene.emissiveSource !== 'T' && (transfer[3] || (scene.textureMipmaps as boolean[])[3])) return null;

	for (const [key, size] of [
		['color', 3],
		['roughness', 2],
		['metalness', 2],
		['ao', 2],
		['emissive', 3],
	] as const) {
		const array = scene[key];
		if (
			!Array.isArray(array) ||
			array.length !== size ||
			!array.every((component) => typeof component === 'number' && Number.isFinite(component))
		) return null;
	}

	for (const key of ['normalIntensity', 'specular']) {
		if (typeof scene[key] !== 'number' || !Number.isFinite(scene[key])) return null;
	}

	if (scene.emissiveSource === '' && (scene.emissive as number[]).some((value) => value !== 0)) return null;

	if (scene.edge) {
		const edge = scene.edge as Record<string, unknown>;
		if (
			!Array.isArray(edge.color) ||
			edge.color.length !== 4 ||
			!edge.color.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
			typeof edge.range !== 'number' ||
			!Number.isFinite(edge.range) ||
			typeof edge.useCoatingMask !== 'number' ||
			!Number.isFinite(edge.useCoatingMask)
		) return null;
	}

	if (scene.detailNormal) {
		const detail = scene.detailNormal as Record<string, unknown>;
		if (
			!Array.isArray(detail.adjust) ||
			detail.adjust.length !== 4 ||
			!detail.adjust.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
			typeof detail.mipmaps !== 'boolean'
		) return null;
		if (detail.srgb !== undefined && typeof detail.srgb !== 'boolean') return null;
	}

	if (scene.selectiveOutputMask !== undefined && scene.selectiveOutputMask !== 128) return null;

	return value as FurnitureScene;
}

/** Captured UV0 D/N/ORM(+E) core: one PBR pass, three or four native samples.
 * No COLOR stream is consumed; Three's separate instance color keeps highlight.
 */
export function createSceneMaterial(
	scene: FurnitureScene,
	diffuse: Texture,
	normal: Texture,
	orm: Texture,
	source: Material,
	emission?: Texture | null,
	detailNormal?: Texture | null,
): MeshStandardMaterial {
	const independentEmission = scene.emissiveSource === 'T';
	if (independentEmission && !emission) throw new Error('Scene core requires its native EmissiveColor texture');
	if (scene.detailNormal && !detailNormal) throw new Error('Scene detail normal requires its actual native Normal1 resource');

	const textures = [diffuse, normal, orm, ...(independentEmission ? [emission!] : [])].map(
		(texture, role) => {
			// Native resource headers, not role names, determine RGB transfer. Alpha
			// remains data; linear D and sRGB ORM are both authored Scene exceptions.
			const owned = texture.clone();
			owned.colorSpace = scene.textureSRGB[role] ? SRGBColorSpace : NoColorSpace;
			owned.channel = 0;
			owned.wrapS = RepeatWrapping;
			owned.wrapT = RepeatWrapping;
			owned.repeat.set(1, 1);
			owned.offset.set(0, 0);
			owned.center.set(0, 0);
			owned.rotation = 0;
			owned.matrixAutoUpdate = true;
			owned.updateMatrix();
			owned.magFilter = LinearFilter;
			owned.minFilter = scene.textureMipmaps[role] ? LinearMipmapLinearFilter : LinearFilter;
			// Regenerated mipchains remain a stated approximation to original mips.
			owned.generateMipmaps = scene.textureMipmaps[role]!;
			owned.needsUpdate = true;
			return owned;
		},
	);
	const detailTexture = scene.detailNormal ? detailNormal!.clone() : null;
	if (detailTexture) {
		detailTexture.colorSpace = scene.detailNormal!.srgb ? SRGBColorSpace : NoColorSpace;
		detailTexture.wrapS = detailTexture.wrapT = RepeatWrapping;
		detailTexture.magFilter = LinearFilter;
		detailTexture.minFilter = scene.detailNormal!.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
		detailTexture.generateMipmaps = scene.detailNormal!.mipmaps;
		detailTexture.needsUpdate = true;
	}

	const material = new MeshStandardMaterial({
		color: new Color().setRGB(...scene.color),
		map: textures[0],
		normalMap: textures[1],
		aoMap: textures[2],
		aoMapIntensity: 1,
		roughness: 1,
		metalness: 1,
		vertexColors: false,
		transparent: false,
		opacity: 1,
		alphaTest: scene.coverage ? scene.cutoff! : 0,
		depthWrite: true,
		side: source.side,
		forceSinglePass: true,
	});
	material.name = source.name;
	material.userData = { ...source.userData, scene };
	material.depthTest = source.depthTest;
	material.colorWrite = source.colorWrite;
	material.toneMapped = source.toneMapped;
	material.visible = source.visible;
	material.addEventListener('dispose', () => textures.forEach((texture) => texture.dispose()));
	material.addEventListener('dispose', () => detailTexture?.dispose());
	if (scene.detailNormal?.adjust[0]) material.defines = { ...material.defines, USE_UV1: '' };

	const standard = source as MeshStandardMaterial;
	const originalSigns = standard.userData.sceneNormalSigns;
	let normalSigns = new Vector2(1, 1);
	if (
		Array.isArray(originalSigns) &&
		originalSigns.length === 2 &&
		originalSigns.every((value: unknown) => value === -1 || value === 1)
	) {
		normalSigns = new Vector2(originalSigns[0], originalSigns[1]);
	} else if (standard.isMeshStandardMaterial) {
		normalSigns.set(standard.normalScale.x < 0 ? -1 : 1, standard.normalScale.y < 0 ? -1 : 1);
	}

	material.userData.sceneNormalSigns = normalSigns.toArray();
	material.normalScale.copy(normalSigns).multiplyScalar(scene.normalIntensity);
	if (standard.isMeshStandardMaterial) material.flatShading = standard.flatShading;

	material.onBeforeCompile = (shader) => {
		shader.uniforms.sceneOrmMap = { value: textures[2] };
		shader.uniforms.sceneRoughness = { value: new Vector2(...scene.roughness) };
		shader.uniforms.sceneMetalness = { value: new Vector2(...scene.metalness) };
		shader.uniforms.sceneAo = { value: new Vector2(...scene.ao) };
		shader.uniforms.sceneSpecular = { value: scene.specular };
		shader.uniforms.sceneEmissive = { value: new Vector3(...scene.emissive) };
		if (independentEmission) shader.uniforms.sceneEmissionMap = { value: textures[3] };
		if (scene.edge) {
			shader.uniforms.sceneEdgeColor = { value: new Vector4(...scene.edge.color) };
			shader.uniforms.sceneEdgeRange = { value: scene.edge.range };
			shader.uniforms.sceneEdgeUseCoatingMask = { value: scene.edge.useCoatingMask };
		}

		if (scene.detailNormal) {
			shader.uniforms.sceneDetailNormalMap = { value: detailTexture };
			shader.uniforms.sceneDetailNormalAdjust = { value: new Vector4(...scene.detailNormal.adjust) };
			shader.uniforms.sceneNormalIntensity = { value: scene.normalIntensity };
			shader.uniforms.sceneNormalSigns = { value: normalSigns };
			shader.vertexShader = shader.vertexShader
				.replace(
					'#include <uv_pars_vertex>',
					'#include <uv_pars_vertex>\nvarying vec2 vSceneDetailUv;\nuniform vec4 sceneDetailNormalAdjust;',
				)
				.replace(
					'#include <uv_vertex>',
					`#include <uv_vertex>
vSceneDetailUv = ${scene.detailNormal.adjust[0] ? 'mix(uv, uv1, sceneDetailNormalAdjust.r)' : 'uv'} * sceneDetailNormalAdjust.gb;`,
				);
		}

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform sampler2D sceneOrmMap;
uniform vec2 sceneRoughness;
uniform vec2 sceneMetalness;
uniform vec2 sceneAo;
uniform float sceneSpecular;
uniform vec3 sceneEmissive;
${independentEmission ? 'uniform sampler2D sceneEmissionMap;' : ''}
vec4 sceneOrm;
vec4 sceneDiffuse;
${scene.edge ? 'uniform vec4 sceneEdgeColor;\nuniform float sceneEdgeRange;\nuniform float sceneEdgeUseCoatingMask;\nvec3 sceneRawBase;\nvec3 sceneEdgeRGB;' : ''}
${scene.detailNormal ? 'uniform sampler2D sceneDetailNormalMap;\nuniform vec4 sceneDetailNormalAdjust;\nuniform float sceneNormalIntensity;\nuniform vec2 sceneNormalSigns;\nvarying vec2 vSceneDetailUv;' : ''}
${scene.edge || scene.detailNormal ? sceneSamplingShader : ''}`,
			)
		// Native COLOR masks are not diffuse tint. Instance highlight is applied
		// after the source base clamp, independently of the emission input.
			.replace('#include <color_fragment>', '')
			.replace(
				'#include <map_fragment>',
				`${ShaderChunk.map_fragment}
sceneDiffuse = sampledDiffuseColor;
sceneOrm = texture2D(sceneOrmMap, vMapUv);
${scene.edge ? 'sceneRawBase = diffuseColor.rgb;' : ''}
diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 1.0);
diffuseColor.a = ${scene.coverage ? 'sceneDiffuse.a' : '1.0'};
#include <color_fragment>`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				'float roughnessFactor = clamp(mix(sceneRoughness.x, sceneRoughness.y, sceneOrm.g), 0.0, 1.0);',
			)
			.replace(
				'#include <metalnessmap_fragment>',
				'float metalnessFactor = clamp(mix(sceneMetalness.x, sceneMetalness.y, sceneOrm.b), 0.0, 1.0);',
			)
			.replace(
				'#include <aomap_fragment>',
				ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'clamp(mix(sceneAo.x, sceneAo.y, sceneOrm.r), 0.0, 1.0)'),
			)
			.replace(
				'#include <normal_fragment_maps>',
				ShaderChunk.normal_fragment_maps
					.replace(
						'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
						scene.detailNormal
							? 'vec3 mapN = sceneSourceDetailNormal(texture2D(normalMap, vNormalMapUv).rg, texture2D(sceneDetailNormalMap, vSceneDetailUv).rg, sceneNormalIntensity, sceneDetailNormalAdjust.a, sceneOrm.a);'
							: `vec2 sourceNormalRG = texture2D(normalMap, vNormalMapUv).rg * 2.0 - 1.0;
vec3 mapN = vec3(sourceNormalRG, sqrt(max(1.0 - dot(sourceNormalRG, sourceNormalRG), 0.0)));`,
					)
					.replace(
						'mapN.xy *= normalScale;',
						scene.detailNormal ? 'mapN.xy *= sceneNormalSigns;' : 'mapN.xy *= normalScale;',
					) +
					(scene.edge
						? `
sceneEdgeRGB = sceneSourceEdgeRGB(sceneEdgeColor.rgb, sceneEdgeRange, sceneEdgeUseCoatingMask, sceneOrm.a, dot(normal, normalize(vViewPosition)));
diffuseColor.rgb = clamp(sceneRawBase + sceneEdgeRGB, 0.0, 1.0);
#include <color_fragment>`
						: ''),
			)
			.replace(
				'#include <lights_physical_fragment>',
				ShaderChunk.lights_physical_fragment.replace(
					'material.specularColor = vec3( 0.04 );',
					'material.specularColor = vec3(0.08 * clamp(sceneSpecular, 0.0, 1.0));',
				),
			)
			.replace(
				'#include <emissivemap_fragment>',
				scene.emissiveSource
					? `vec4 sourceEmission = ${scene.emissiveSource === 'T' ? 'texture2D(sceneEmissionMap, vMapUv)' : scene.emissiveSource === 'D' ? 'sceneDiffuse' : 'sceneOrm'};
totalEmissiveRadiance = ${scene.edge ? 'sourceEmission.rgb * sourceEmission.a * sceneEmissive' : 'max(sourceEmission.rgb * sourceEmission.a * sceneEmissive, vec3(0.0))'};
${scene.edge ? 'totalEmissiveRadiance = max(totalEmissiveRadiance + sceneEdgeRGB * sceneEdgeColor.a, vec3(0.0));' : ''}
#if defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)
totalEmissiveRadiance *= vColor;
#endif`
					: scene.edge
						? `totalEmissiveRadiance = max(sceneEdgeRGB * sceneEdgeColor.a, vec3(0.0));
#if defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)
totalEmissiveRadiance *= vColor;
#endif`
						: 'totalEmissiveRadiance = vec3(0.0);',
			);
	};
	material.customProgramCacheKey = () =>
		`furniture_scene_v2_${!!scene.coverage}_${scene.emissiveSource}_${!!scene.edge}_${!!scene.detailNormal}_${!!scene.detailNormal?.adjust[0]}`;
	return material;
}
