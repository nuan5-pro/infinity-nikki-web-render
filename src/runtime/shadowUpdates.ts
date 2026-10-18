import type { Camera, WebGLRenderer } from 'three';

/** Camera layers and renderer settings can change independently of scene edits. */
export function createShadowUpdates() {
	let enabled = false;
	let type: number | undefined;
	let layers: number | undefined;

	return (renderer: WebGLRenderer, camera: Camera) => {
		const shadow = renderer.shadowMap;
		if (shadow.enabled && (!enabled || type !== shadow.type || layers !== camera.layers.mask))
			shadow.needsUpdate = true;

		enabled = shadow.enabled;
		type = shadow.type;
		layers = camera.layers.mask;
	};
}
