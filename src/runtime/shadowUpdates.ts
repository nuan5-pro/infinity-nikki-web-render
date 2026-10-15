import {
	type Camera,
	type Light,
	type Mesh,
	type MeshStandardMaterial,
	type Scene,
	type WebGLRenderer,
} from 'three';
import { geometryRevision } from './geometryCache.js';

/** Refresh world-space shadows when casters or lights change. */
export function createShadowUpdates() {
	let previous: unknown[] = [];
	return (renderer: WebGLRenderer, scene: Scene, camera: Camera) => {
		if (!renderer.shadowMap.enabled) return;

		scene.updateMatrixWorld();

		const next: unknown[] = [
			renderer.shadowMap.type,
			camera.layers.mask,
			scene.userData.shadowRevision,
		];

		scene.traverseVisible((object) => {
			if (!object.layers.test(camera.layers)) return;

			const light = object as Light & {
				shadow?: {
					camera: Camera;
					mapSize: { x: number; y: number };
					bias: number;
					normalBias: number;
				};
				target?: Camera;
			};
			if (light.isLight && light.castShadow && light.shadow) {
				light.target?.updateWorldMatrix(true, false);
				next.push(
					light,
					...light.matrixWorld.elements,
					...light.shadow.camera.projectionMatrix.elements,
					light.shadow.mapSize.x,
					light.shadow.mapSize.y,
					light.shadow.bias,
					light.shadow.normalBias,
				);
				if (light.target) next.push(...light.target.matrixWorld.elements);
			}

			const mesh = object as Mesh & { count?: number; instanceMatrix?: { version: number } };
			if (!mesh.isMesh || !mesh.castShadow) return;

			if ('isSkinnedMesh' in mesh || mesh.userData.shadowAnimated === true)
				renderer.shadowMap.needsUpdate = true;

			next.push(
				mesh,
				...mesh.matrixWorld.elements,
				mesh.count,
				mesh.instanceMatrix?.version,
				mesh.geometry,
				...geometryRevision(mesh.geometry),
				...(mesh.morphTargetInfluences ?? []),
				mesh.customDepthMaterial,
				// Batch-private depth recipes change version while selecting a source
				// group; source coverage below and explicit dye invalidation own dirtiness.
				mesh.customDepthMaterial?.userData.nuanShadowRecipe ? 0 : mesh.customDepthMaterial?.version,
				mesh.customDistanceMaterial,
				mesh.customDistanceMaterial?.userData.nuanShadowRecipe ? 0 : mesh.customDistanceMaterial?.version,
			);
			for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
				const surface = material as Partial<MeshStandardMaterial>;
				// Double-sided colour rendering/precompilation increments version even
				// when caster coverage is unchanged. Track shadow inputs explicitly.
				next.push(
					material,
					material.visible,
					material.opacity,
					material.alphaTest,
					material.alphaHash,
					material.side,
					material.shadowSide,
					surface.alphaMap,
					surface.alphaMap?.version,
					surface.displacementMap,
					surface.displacementMap?.version,
					surface.displacementScale,
					surface.displacementBias,
				);
				if (material.alphaTest > 0) next.push(surface.map, surface.map?.version);
			}
		});
		if (previous.length !== next.length || next.some((value, index) => value !== previous[index])) {
			renderer.shadowMap.needsUpdate = true;
			previous = next;
		}
	};
}
