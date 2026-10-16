import {
	type Camera,
	type Light,
	type Material,
	type Mesh,
	type MeshStandardMaterial,
	type Scene,
	type WebGLRenderer,
} from 'three';
import { writeGeometryRevision } from './geometryCache.js';

/** Refresh world-space shadows when casters or lights change. */
export function createShadowUpdates() {
	let previous: unknown[] = [];
	let next: unknown[] = [];
	let offset = 0;

	function append(value: unknown) {
		next[offset++] = value;
	}

	function appendArray(values: readonly unknown[]) {
		for (const value of values) append(value);
	}

	function appendMaterial(material: Material) {
		const surface = material as Partial<MeshStandardMaterial>;
		// Colour-pass version churn does not necessarily change caster coverage.
		append(material);
		append(material.visible);
		append(material.opacity);
		append(material.alphaTest);
		append(material.alphaHash);
		append(material.side);
		append(material.shadowSide);
		append(surface.alphaMap);
		append(surface.alphaMap?.version);
		append(surface.displacementMap);
		append(surface.displacementMap?.version);
		append(surface.displacementScale);
		append(surface.displacementBias);
		if (material.alphaTest > 0) {
			append(surface.map);
			append(surface.map?.version);
		}
	}

	return (renderer: WebGLRenderer, scene: Scene, camera: Camera) => {
		if (!renderer.shadowMap.enabled) return;

		scene.updateMatrixWorld();

		// Reuse both buffers: a static scene must not allocate a full geometry and
		// material snapshot each frame just to discover that nothing changed.
		offset = 0;
		append(renderer.shadowMap.type);
		append(camera.layers.mask);
		append(scene.userData.shadowRevision);

		scene.traverseVisible((object) => {
			if (!object.layers.test(camera.layers)) return;

			const light = object as Light & {
				shadow?: {
					camera: Camera
					mapSize: { x: number; y: number }
					bias: number
					normalBias: number
				}
				target?: Camera
			};
			if (light.isLight && light.castShadow && light.shadow) {
				light.target?.updateWorldMatrix(true, false);
				append(light);
				appendArray(light.matrixWorld.elements);
				appendArray(light.shadow.camera.projectionMatrix.elements);
				append(light.shadow.mapSize.x);
				append(light.shadow.mapSize.y);
				append(light.shadow.bias);
				append(light.shadow.normalBias);
				if (light.target) appendArray(light.target.matrixWorld.elements);
			}

			const mesh = object as Mesh & { count?: number; instanceMatrix?: { version: number } };
			if (!mesh.isMesh || !mesh.castShadow) return;

			if ('isSkinnedMesh' in mesh || mesh.userData.shadowAnimated === true)
				renderer.shadowMap.needsUpdate = true;

			append(mesh);
			appendArray(mesh.matrixWorld.elements);
			append(mesh.count);
			append(mesh.instanceMatrix?.version);
			append(mesh.geometry);
			offset = writeGeometryRevision(mesh.geometry, next, offset);
			if (mesh.morphTargetInfluences) appendArray(mesh.morphTargetInfluences);
			append(mesh.customDepthMaterial);
			// Batch-private depth recipes change version while selecting a source
			// group; source coverage below and explicit dye invalidation own dirtiness.
			append(mesh.customDepthMaterial?.userData.nuanShadowRecipe ? 0 : mesh.customDepthMaterial?.version);
			append(mesh.customDistanceMaterial);
			append(mesh.customDistanceMaterial?.userData.nuanShadowRecipe ? 0 : mesh.customDistanceMaterial?.version);
			if (Array.isArray(mesh.material)) {
				for (const material of mesh.material) appendMaterial(material);
			} else appendMaterial(mesh.material);
		});
		next.length = offset;
		if (previous.length !== next.length || next.some((value, index) => value !== previous[index]))
			renderer.shadowMap.needsUpdate = true;

		const old = previous;
		previous = next;
		next = old;
	};
}
