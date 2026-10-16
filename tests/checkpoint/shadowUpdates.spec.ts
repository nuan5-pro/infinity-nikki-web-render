import { describe, expect, it } from 'vitest';
import {
	BoxGeometry,
	DirectionalLight,
	InstancedMesh,
	Matrix4,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	Scene,
	Texture,
	type WebGLRenderer,
} from 'three';
import { createShadowUpdates } from '../../src/runtime/shadowUpdates.js';

describe('shadow dirty updates', () => {
	it('tracks repeated geometry, coverage, visibility and removal changes while reusing snapshots', () => {
		const renderer = { shadowMap: { enabled: true, type: 1, needsUpdate: false } } as WebGLRenderer;
		const scene = new Scene();
		const camera = new PerspectiveCamera();
		const material = new MeshStandardMaterial({ alphaTest: 0.5, map: new Texture() });
		const mesh = new InstancedMesh(new BoxGeometry(), [material], 1);
		mesh.castShadow = true;
		scene.add(mesh);
		const update = createShadowUpdates();
		update(renderer, scene, camera);

		for (const change of [
			() => { mesh.geometry.getAttribute('position').needsUpdate = true; },
			() => { mesh.geometry.index!.needsUpdate = true; },
			() => { mesh.geometry.groups[0]!.count--; },
			() => { mesh.geometry.setDrawRange(1, 3); },
			() => { mesh.morphTargetInfluences = [0.5]; },
			() => { material.opacity = 0.5; },
			() => { material.map!.needsUpdate = true; },
			() => { material.alphaMap = new Texture(); },
			() => { material.alphaMap!.needsUpdate = true; },
			() => { material.displacementScale = 2; },
			() => { mesh.visible = false; },
			() => { mesh.visible = true; },
			() => { scene.remove(mesh); },
		]) {
			renderer.shadowMap.needsUpdate = false;
			for (let frame = 0; frame < 3; frame++) update(renderer, scene, camera);
			expect(renderer.shadowMap.needsUpdate).toBe(false);
			change();
			update(renderer, scene, camera);
			expect(renderer.shadowMap.needsUpdate).toBe(true);
		}
	});

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
