import { Vector3, type Material } from 'three';
import type { FurnitureModelConfig } from './types.js';
import { readFurnitureSurface } from '../materials/surface/surfaceShader.js';

const applied = new WeakSet<Material>();

/** Preserve the proved Home light's initial off state on item-owned slot 0.
 * Only its emission inputs change; source colour, textures and PBR stay intact.
 * Source HomeEmissiveToggle=0 is retained when art-effect state owns it. */
export function applyHomeObjectLightDefault(
	config: FurnitureModelConfig,
	materials: Material[],
	baseNames: (string | null)[],
	meshIndices: number[],
): void {
	if (config.lightPreview !== 'home-object-light-off') return;

	for (let index = 0; index < materials.length; index++) {
		const material = materials[index]!;
		const slot = config.meshes[meshIndices[index] ?? -1]?.slots[0];
		if (!slot || !baseNames[index]?.startsWith(`${slot}:`) || applied.has(material)) continue;
		const surface = readFurnitureSurface(material.userData.surface);
		if (
			surface?.vertexEmissive !== 'source-blue' ||
			!surface.emissiveParams ||
			surface.emissiveParams[1] === 0
		)
			continue;

		const compile = material.onBeforeCompile;
		material.onBeforeCompile = (shader, renderer) => {
			compile.call(material, shader, renderer);
			shader.uniforms.homeEmissiveCore = { value: new Vector3(0, 0, 0) };
			shader.uniforms.homeEmissiveParams = {
				value: new Vector3(surface.emissiveParams![0], surface.emissiveParams![1], 0.25),
			};
		};
		applied.add(material);
		material.needsUpdate = true;
	}
}
