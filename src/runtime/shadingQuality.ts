import { MeshPhysicalMaterial, MeshStandardMaterial, ShaderChunk, type Material } from 'three';

export type ShadingQuality = 'original' | 'performance' | 'economy';
export type ShadingFamily = 'standard' | 'foliage' | 'surface' | 'layered';

const configured = new WeakMap<Material, ShadingQuality>();

// Reuse Three's material inputs, Lambert/Blinn-Phong and environment BRDF.
// Colour, coverage and dye continue through the source material's shader.
// Economy foliage also opts out of its source's surface details and emission.
const lighting = /* glsl */ `
#include <bsdfs>
void editorDirectLight(const in IncidentLight directLight, const in vec3 geometryPosition,
  const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
  const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  vec3 irradiance = saturate(dot(geometryNormal, directLight.direction)) * directLight.color;
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert(material.diffuseContribution);
  #ifdef EDITOR_SUPER_PERFORMANCE
  if (material.metalness > 0.01) {
  #endif
    float shininess = clamp(2.0 / max(pow2(material.roughness), 0.015625) - 2.0, 0.0, 128.0);
    reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong(
      directLight.direction, geometryViewDir, geometryNormal, material.specularColorBlended, shininess);
  #ifdef EDITOR_SUPER_PERFORMANCE
  }
  #endif
}
void editorIndirectLight(const in vec3 radiance, const in vec3 irradiance,
  const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal,
  const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
  const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert(material.diffuseContribution);
  if (material.metalness > 0.01)
    reflectedLight.indirectSpecular += radiance * EnvironmentBRDF(geometryNormal, geometryViewDir,
      material.specularColorBlended, material.specularF90, material.roughness);
}
#undef RE_Direct
#define RE_Direct editorDirectLight
#undef RE_IndirectSpecular
#define RE_IndirectSpecular editorIndirectLight
`;

/** Apply once to a final, owned material, before GPU preparation.
 * The caller selects a supported shader family before Paper expands its chunks. */
export function applyShadingQuality<T extends Material>(
	material: T,
	quality: ShadingQuality,
	family: ShadingFamily,
): T {
	if (!(material instanceof MeshStandardMaterial) || material instanceof MeshPhysicalMaterial ||
		material.transparent) return material;
	const previous = configured.get(material);
	if (previous !== undefined) {
		if (previous !== quality) throw new Error('Recreate the material to change shading quality');
		return material;
	}
	configured.set(material, quality);
	if (quality === 'original') return material;

	const compile = material.onBeforeCompile;
	const key = material.customProgramCacheKey();
	const plainNormals = quality === 'economy' || family === 'foliage';
	material.onBeforeCompile = function (shader, renderer) {
		compile.call(this, shader, renderer);
		// Keep normalMap/tangent defines in the vertex stage: native layer
		// coordinates and colour blends may depend on those inputs.
		const defines = (plainNormals
			? '#undef USE_NORMALMAP_TANGENTSPACE\n#undef USE_NORMALMAP_OBJECTSPACE\n#undef USE_BUMPMAP\n'
			: '') + (quality === 'economy' ? '#define EDITOR_SUPER_PERFORMANCE\n' : '') +
			(quality === 'economy' && family === 'foliage' ? '#define EDITOR_SIMPLE_FOLIAGE\n' : '') +
			(quality === 'economy' && family === 'layered' ? '#define EDITOR_SIMPLE_LAYERS\n' : '');
		const maps = ShaderChunk.lights_fragment_maps.replace(
			'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
			`if (material.metalness > 0.01) radiance += getIBLRadiance(geometryViewDir, geometryNormal, ${quality === 'economy' ? '0.8' : 'material.roughness'});`,
		);
		shader.fragmentShader = defines + shader.fragmentShader
			.replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${lighting}`)
			.replace('#include <lights_fragment_maps>', maps);
	};
	material.customProgramCacheKey = () => `${key}:shading-${quality}-${plainNormals ? 'flat' : 'normal'}-${family}-v3`;
	material.needsUpdate = true;
	return material;
}
