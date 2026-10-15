import {
	Color,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshStandardMaterial,
	NoColorSpace,
	ShaderChunk,
	SRGBColorSpace,
	Vector2,
	Vector3,
	type Texture,
} from 'three';

export interface FurnitureFXPBR {
	family: 'common-fx-pbr';
	version: 1;
	color: [number, number, number];
	roughness: [number, number];
	normalIntensity: number;
	specular: number;
	textureSRGB: [boolean, boolean, boolean, boolean];
}

export function readFurnitureFXPBR(value: unknown): FurnitureFXPBR | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as Record<string, unknown>;
	if (p.family !== 'common-fx-pbr' || p.version !== 1) return null;

	for (const [key, size] of [
		['color', 3],
		['roughness', 2],
	] as const) {
		if (
			!Array.isArray(p[key]) ||
			p[key].length !== size ||
			!p[key].every((v) => typeof v === 'number' && Number.isFinite(v))
		) return null;
	}

	if (
		typeof p.normalIntensity !== 'number' ||
		!Number.isFinite(p.normalIntensity) ||
		p.normalIntensity < 0 ||
		typeof p.specular !== 'number' ||
		!Number.isFinite(p.specular)
	) return null;
	if (
		!Array.isArray(p.textureSRGB) ||
		p.textureSRGB.length !== 4 ||
		p.textureSRGB.some((v, i) => v !== (i === 0))
	) return null;

	return value as FurnitureFXPBR;
}

/** N must be the producer's standard glTF-green carrier, not native RG.
 * Reconstruct Z before source XY intensity. No second green reflection.
 * O is raw native metal/gloss/spec, deliberately not an ORM map.
 */
export function createFXPBRMaterial(
	profile: FurnitureFXPBR,
	diffuse: Texture | null,
	normal: Texture | null,
	packed: Texture | null,
	source: MeshStandardMaterial,
): MeshStandardMaterial {
	if (!diffuse || !normal || !packed) throw new Error('FX PBR requires its three captured native texture roles');

	const textures = [diffuse, normal, packed].map((image, i) => {
		const texture = image.clone();
		texture.colorSpace = i === 0 ? SRGBColorSpace : NoColorSpace;
		texture.magFilter = LinearFilter;
		texture.minFilter = LinearMipmapLinearFilter;
		texture.generateMipmaps = true;
		texture.needsUpdate = true;
		return texture;
	});
	const material = new MeshStandardMaterial({
		color: new Color(1, 1, 1),
		map: textures[0],
		normalMap: textures[1],
		normalMapType: source.normalMapType,
		normalScale: new Vector2(source.normalScale.x < 0 ? -1 : 1, source.normalScale.y < 0 ? -1 : 1),
		side: source.side,
		transparent: false,
		opacity: 1,
		depthWrite: true,
	});
	material.userData.fxPbr = profile;
	material.addEventListener('dispose', () => textures.forEach((texture) => texture.dispose()));
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, {
			fxPackedMap: { value: textures[2] },
			fxColor: { value: new Vector3(...profile.color) },
			fxRoughness: { value: new Vector2(...profile.roughness) },
			fxNormalIntensity: { value: profile.normalIntensity },
			fxSpecular: { value: profile.specular },
		});
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform sampler2D fxPackedMap;
uniform vec3 fxColor;
uniform vec2 fxRoughness;
uniform float fxNormalIntensity, fxSpecular;`,
			)
			.replace(
				'#include <map_fragment>',
				`vec3 fxPacked = texture2D(fxPackedMap, vMapUv).rgb;
diffuseColor.rgb *= clamp(texture2D(map, vMapUv).rgb * fxColor, 0.0, 1.0);
diffuseColor.a = 1.0;`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				'float roughnessFactor = clamp(mix(fxRoughness.x, fxRoughness.y, 1.0 - fxPacked.g), 0.0, 1.0);',
			)
			.replace(
				'#include <metalnessmap_fragment>',
				'float metalnessFactor = clamp(fxPacked.r, 0.0, 1.0);',
			)
			.replace(
				'#include <normal_fragment_maps>',
				ShaderChunk.normal_fragment_maps.replace(
					'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
					`vec2 fxNormal = texture2D(normalMap, vNormalMapUv).rg * 2.0 - 1.0;
vec3 mapN = vec3(fxNormal * fxNormalIntensity, sqrt(max(1.0 - dot(fxNormal, fxNormal), 0.0)));`,
				),
			)
			.replace(
				'#include <lights_physical_fragment>',
				ShaderChunk.lights_physical_fragment.replace(
					'material.specularColor = vec3( 0.04 );',
					'material.specularColor = vec3(0.08 * clamp(fxPacked.b * fxSpecular, 0.0, 1.0));',
				),
			);
	};
	material.customProgramCacheKey = () => 'common-fx-pbr-v1';
	return material;
}
