/** Actual NoLightmap UP1 RGB/ORM consumers. Primitive33 MUST be supplied from
 * proved source primitive data; no guessed zero or ORM-AO substitute is made.
 * Native COLOR is reserved for separately proved dither/specular consumers.
 */
import {
	MeshStandardMaterial,
	NoColorSpace,
	SRGBColorSpace,
	ShaderChunk,
	Vector2,
	Vector3,
	Vector4,
	RepeatWrapping,
	LinearFilter,
	LinearMipmapLinearFilter,
	type Texture,
} from 'three';

export interface LightmassBody {
	family: 'lightmass-body';
	version: 1;
	tint: [number, number, number];
	occColor: [number, number, number];
	diffuseOcc: number;
	specOcc: number;
	roughBias: number;
	primitive33: [number, number, number, number];
	ao: [number, number];
	roughness: [number, number];
	metalness: [number, number];
	materialAO: number;
	uvScale: number;
	normalUvScale: number;
	normalIntensity: number;
	srgb: [boolean, boolean, boolean];
	mipmaps: [boolean, boolean, boolean];
}

export function createLightmassBodyMaterial(c: LightmassBody, d: Texture, n: Texture, o: Texture, source: MeshStandardMaterial): MeshStandardMaterial {
	const maps = [d, n, o].map((input, i) => {
		const t = input.clone();
		t.colorSpace = c.srgb[i] ? SRGBColorSpace : NoColorSpace;
		t.channel = 0;
		t.offset.set(0, 0);
		t.center.set(0, 0);
		t.rotation = 0;
		t.wrapS = t.wrapT = RepeatWrapping;
		t.magFilter = LinearFilter;
		t.minFilter = c.mipmaps[i] ? LinearMipmapLinearFilter : LinearFilter;
		t.generateMipmaps = c.mipmaps[i]!;
		t.repeat.set(c.uvScale * (i === 1 ? c.normalUvScale : 1), c.uvScale * (i === 1 ? c.normalUvScale : 1));
		t.needsUpdate = true;
		t.matrixAutoUpdate = true;
		t.updateMatrix();
		return t;
	});
	const material = new MeshStandardMaterial({
		map: maps[0],
		normalMap: maps[1],
		aoMap: maps[2],
		roughness: 1,
		metalness: 1,
		vertexColors: false,
		transparent: false,
		opacity: 1,
		side: source.side,
	});
	material.normalScale.set(source.normalScale.x < 0 ? -1 : 1, source.normalScale.y < 0 ? -1 : 1);
	material.name = source.name;
	material.userData = { ...source.userData, lightmassBody: c };
	material.addEventListener('dispose', () => maps.forEach((t) => t.dispose()));
	material.onBeforeCompile = (s) => {
		Object.assign(s.uniforms, {
			bodyTint: { value: new Vector3(...c.tint) },
			bodyOccColor: { value: new Vector3(...c.occColor) },
			bodyPrimitive: { value: new Vector4(...c.primitive33) },
			bodyDiffuseOcc: { value: c.diffuseOcc },
			bodySpecOcc: { value: c.specOcc },
			bodyRoughBias: { value: c.roughBias },
			bodyAO: { value: new Vector2(...c.ao) },
			bodyRough: { value: new Vector2(...c.roughness) },
			bodyMetal: { value: new Vector2(...c.metalness) },
			bodyMaterialAO: { value: c.materialAO },
			bodyNormalIntensity: { value: c.normalIntensity },
			bodyOrmMap: { value: maps[2] },
		});
		s.fragmentShader = s.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>\n${lightmassBodyShader}
uniform vec3 bodyTint; uniform vec3 bodyOccColor; uniform vec4 bodyPrimitive;
uniform float bodyDiffuseOcc; uniform float bodySpecOcc; uniform float bodyRoughBias;
uniform vec2 bodyAO; uniform vec2 bodyRough; uniform vec2 bodyMetal; uniform float bodyMaterialAO;
uniform float bodyNormalIntensity; uniform sampler2D bodyOrmMap; vec3 bodyPBR;`,
			)
			.replace(
				'#include <map_fragment>',
				`${ShaderChunk.map_fragment}
diffuseColor.rgb = furnitureLightmassBodyRGB(diffuseColor.rgb, bodyTint, bodyOccColor, bodyDiffuseOcc, bodyPrimitive);
bodyPBR = furnitureLightmassBodyORM(texture2D(bodyOrmMap, vMapUv), bodyAO, bodyRough, bodyMetal, bodyMaterialAO, bodySpecOcc, bodyRoughBias, bodyPrimitive);
diffuseColor.a = 1.0;`,
			)
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bodyPBR.y;')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = bodyPBR.z;')
			.replace(
				'#include <normal_fragment_maps>',
				ShaderChunk.normal_fragment_maps.replace(
					'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
					`vec2 bodyXY = texture2D(normalMap, vNormalMapUv).rg * 2.0 - 1.0;
vec3 mapN = mix(vec3(0.0,0.0,1.0), vec3(bodyXY, sqrt(max(1.0-dot(bodyXY,bodyXY),0.0))), bodyNormalIntensity);`,
				),
			)
			.replace(
				'#include <aomap_fragment>',
				ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'bodyPBR.x'),
			)
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vec3(0.0);');
	};
	material.customProgramCacheKey = () => 'native_lightmass_body_v1';
	return material;
}

export const lightmassBodyShader = `
vec3 furnitureLightmassBodyRGB(vec3 d, vec3 tint, vec3 occColor, float diffuseOcc, vec4 primitive33) {
  vec3 base = d * tint;
  vec3 occluded = base * occColor * (primitive33.w + 1.0);
  float weight = clamp(1.0 - diffuseOcc + primitive33.x, 0.0, 1.0);
  return clamp(mix(occluded, base, weight), 0.0, 1.0);
}
vec3 furnitureLightmassBodyORM(vec4 o, vec2 ao, vec2 rough, vec2 metal, float materialAO,
  float specOcc, float roughBias, vec4 primitive33) {
  float weight = clamp(1.0 - specOcc + primitive33.y, 0.0, 1.0);
  float r = mix(rough.x, rough.y, o.g) + (primitive33.z + roughBias) * (1.0 - weight);
  return clamp(vec3(mix(ao.x, ao.y, o.r) * materialAO, r, mix(metal.x, metal.y, o.b)), 0.0, 1.0);
}
`;
