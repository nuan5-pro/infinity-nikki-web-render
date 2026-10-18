import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, VSMShadowMap, type WebGLRenderer } from 'three';
import { createShadowUpdates } from '../../src/runtime/shadowUpdates.js';

describe('shadow updates', () => {
	it('reuses static shadows during camera movement', () => {
		const renderer = { shadowMap: { enabled: true, type: 1, needsUpdate: false } } as WebGLRenderer;
		const camera = new PerspectiveCamera();
		const update = createShadowUpdates();
		update(renderer, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(true);
		renderer.shadowMap.needsUpdate = false;
		camera.position.x = 100;
		camera.rotation.y = 1;
		for (let frame = 0; frame < 10; frame++) update(renderer, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(false);
	});

	it('refreshes on camera layer, shadow type and enable changes', () => {
		const renderer = { shadowMap: { enabled: true, type: 1, needsUpdate: false } } as WebGLRenderer;
		const camera = new PerspectiveCamera();
		const update = createShadowUpdates();
		update(renderer, camera);
		for (const change of [
			() => camera.layers.enable(2),
			() => { renderer.shadowMap.type = VSMShadowMap; },
			() => {
				renderer.shadowMap.enabled = false;
				update(renderer, camera);
				expect(renderer.shadowMap.needsUpdate).toBe(false);
				renderer.shadowMap.enabled = true;
			},
		]) {
			renderer.shadowMap.needsUpdate = false;
			change();
			update(renderer, camera);
			expect(renderer.shadowMap.needsUpdate).toBe(true);
		}
	});

	it('preserves invalidations from scene owners', () => {
		const renderer = { shadowMap: { enabled: true, type: 1, needsUpdate: false } } as WebGLRenderer;
		const update = createShadowUpdates();
		const camera = new PerspectiveCamera();
		update(renderer, camera);
		renderer.shadowMap.needsUpdate = true;
		update(renderer, camera);
		expect(renderer.shadowMap.needsUpdate).toBe(true);
	});
});
