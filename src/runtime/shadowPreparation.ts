import type { Scene, Camera, Light, Mesh, WebGLRenderer } from 'three';

/** Let Three select the real depth recipes/groups/targets, but submit their
 * programs instead of drawing until the parallel compiler has completed. */
export async function prepareShadowPrograms(
	renderer: WebGLRenderer,
	scene: Scene,
	camera: Camera,
	stale: () => boolean,
) {
	if (!renderer.shadowMap.enabled || stale()) return !stale();

	const lights: Light[] = [];
	scene.updateMatrixWorld();
	scene.traverseVisible((object) => {
		const light = object as Light;
		if (light.isLight && camera.layers.test(light.layers)) lights.push(light);
	});
	const casters = lights.filter((light) => light.castShadow);
	if (!casters.length) return true;

	const previous = new Set(renderer.info.programs ?? []);
	const draw = renderer.renderBufferDirect;
	const target = renderer.getRenderTarget();
	const face = renderer.getActiveCubeFace();
	const mip = renderer.getActiveMipmapLevel();
	// Borrow scene settings and actual light objects without scanning every
	// furniture group again for each depth material. No light is reparented.
	const compilationScene = Object.create(scene) as Scene;
	compilationScene.children = lights;
	compilationScene.environment = null;
	compilationScene.fog = null;
	try {
		renderer.renderBufferDirect = (shadowCamera, shadowScene, geometry, material, object) => {
			const carrier = Object.create(object) as Mesh;
			carrier.children = [];
			carrier.geometry = geometry;
			carrier.material = material;
			// Three keys even depth programs with the enclosing render's light
			// counts. An empty target scene would warm a different program variant.
			renderer.compile(carrier, shadowCamera, shadowScene ?? compilationScene);
		};
		renderer.shadowMap.needsUpdate = true;
		renderer.shadowMap.render(casters, scene, camera);
	} finally {
		renderer.renderBufferDirect = draw;
		renderer.setRenderTarget(target, face, mip);
		// The preflight initialized maps, but has not rasterized any casters.
		renderer.shadowMap.needsUpdate = true;
	}

	const programs = (renderer.info.programs ?? []).filter((program) => !previous.has(program)) as unknown as { program: WebGLProgram; getUniforms(): unknown }[];
	const gl = renderer.getContext();
	const parallel = gl.getExtension('KHR_parallel_shader_compile');
	while (programs.length && !stale() && !gl.isContextLost()) {
		const start = performance.now();
		for (let i = programs.length - 1; i >= 0 && performance.now() - start < 3; i--) {
			const program = programs[i]!.program;
			if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) continue;
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shadow shader preparation failed');
			programs[i]!.getUniforms();
			programs.splice(i, 1);
		}
		if (programs.length) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
	return !stale() && !gl.isContextLost();
}
