import { describe, expect, it } from 'vitest';
import {
	BoxGeometry,
	DirectionalLight,
	InstancedMesh,
	Matrix4,
	MeshBasicMaterial,
	PerspectiveCamera,
	Scene,
	type WebGLRenderer,
} from 'three';
import { createShadowUpdates } from '../../src/runtime/shadowUpdates.js';

describe('shadow dirty updates', () => {
	it('does not redraw static frames and follows casters, instance previews and lights', () => {
		const renderer = { shadowMap: { enabled: true, type: 1, needsUpdate: false } } as WebGLRenderer;
		const scene = new Scene();
		const camera = new PerspectiveCamera();
		const sun = new DirectionalLight();
		const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 1);
		sun.castShadow = mesh.castShadow = true;
		scene.add(sun, mesh);

		const update = createShadowUpdates();
		update(renderer, scene, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(true);
		renderer.shadowMap.needsUpdate = false;
		update(renderer, scene, camera);
		camera.rotation.y = 1;
		update(renderer, scene, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(false);
		mesh.setMatrixAt(0, new Matrix4().makeTranslation(2, 0, 0));
		mesh.instanceMatrix.needsUpdate = true;
		update(renderer, scene, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(true);
		renderer.shadowMap.needsUpdate = false;
		sun.position.x = 10;
		update(renderer, scene, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(true);
	});

	it('ignores colour-pass version churn but follows explicit shadow revisions and animated casters', () => {
		const renderer = { shadowMap: { enabled: true, type: 1, needsUpdate: false } } as WebGLRenderer;
		const scene = new Scene();
		const camera = new PerspectiveCamera();
		const material = new MeshBasicMaterial();
		const mesh = new InstancedMesh(new BoxGeometry(), material, 1);
		mesh.castShadow = true;
		scene.add(mesh);

		const update = createShadowUpdates();
		update(renderer, scene, camera);
		renderer.shadowMap.needsUpdate = false;
		material.needsUpdate = true;
		update(renderer, scene, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(false);
		scene.userData.shadowRevision = 1;
		update(renderer, scene, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(true);
		renderer.shadowMap.needsUpdate = false;
		mesh.userData.shadowAnimated = true;
		update(renderer, scene, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(true);
	});
});
