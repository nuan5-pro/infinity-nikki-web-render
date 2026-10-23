import { DoubleSide, MeshStandardMaterial, type Material } from 'three';

const configured = new WeakSet<Material>();

/** The producer declares canopy normals independently of the leaf card winding.
 * Native foliage shaders own this convention; this is for standard previews. */
export function applyFoliageNormals<T extends Material>(material: T): T {
	if (material.userData.render?.foliageNormals !== 'authored') return material;
	if (configured.has(material)) return material;
	if (!(material instanceof MeshStandardMaterial) || material.side !== DoubleSide || material.flatShading)
		throw new Error('[Furniture] Authored foliage normals require smooth double-sided PBR');
	configured.add(material);

	const compile = material.onBeforeCompile;
	const key = material.customProgramCacheKey();
	material.onBeforeCompile = function (shader, renderer) {
		compile.call(this, shader, renderer);
		// Cancel Three's face sign after the complete TBN/normal-map evaluation.
		// This also preserves the authored vertex normal when normal maps are disabled.
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <normal_fragment_maps>',
			'#include <normal_fragment_maps>\nnormal *= faceDirection;',
		);
	};
	material.customProgramCacheKey = () => `${key}:authored-foliage-normals-v1`;
	return material;
}
