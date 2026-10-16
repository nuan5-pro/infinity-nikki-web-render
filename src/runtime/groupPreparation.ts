import type { Camera, Material, Mesh, Scene, WebGLRenderer } from 'three';
import { createGpuPreparation } from './gpuPreparation.js';

type Prepare = (mesh: Mesh, stale: () => boolean) => Promise<boolean>;

export function createGroupPreparation(
	renderer: WebGLRenderer,
	context: () => { scene: Scene; camera: Camera | undefined },
	invalidate: () => void,
) {
	// Shared-source texture clones can initialize without uploading. Bound work
	// by CPU time and bytes instead of spending a whole frame per texture wrapper.
	const queue = createGpuPreparation(renderer, {
		invalidate,
		maxCompiles: 2,
		maxUploads: Infinity,
		budgetMs: 3,
	});

	type Candidate = {
		mesh: Mesh
		materials: Material[]
		stale: () => boolean
		resolve: (ready: boolean) => void
		reject: (error: unknown) => void
	};

	const pending = new Set<Candidate>();
	const users = new Map<Material, number>();
	let disposed = false;
	let frame: number | undefined;

	function finish(candidate: Candidate, ready: boolean, error?: unknown) {
		if (!pending.delete(candidate)) return;
		for (const material of candidate.materials) {
			const count = users.get(material)! - 1;
			if (count) users.set(material, count);
			else {
				users.delete(material);
				if (!ready) queue.cancelMaterial(material);
			}
		}

		if (error !== undefined) candidate.reject(error);
		else candidate.resolve(ready);
	}

	function schedule() {
		if (!disposed && pending.size && frame === undefined) frame = requestAnimationFrame(tick);
	}

	function enqueue(candidate: Candidate) {
		pending.add(candidate);
		for (const material of candidate.materials) users.set(material, (users.get(material) ?? 0) + 1);
	}

	function tick() {
		frame = undefined;
		for (const candidate of [...pending]) if (candidate.stale()) finish(candidate, false);

		if (disposed || !pending.size) return;

		const target = renderer.getRenderTarget();
		try {
			if (renderer.getContext().isContextLost()) throw new Error('WebGL context lost during model preparation');

			const { scene, camera } = context();
			if (!camera) {
				for (const candidate of [...pending]) finish(candidate, false);

				return;
			}

			renderer.setRenderTarget(null);
			// One budget reset, completion/upload drain and light scan per canvas frame.
			const start = performance.now();
			queue.beginFrame(scene, camera);
			for (const candidate of [...pending]) {
				if (performance.now() - start >= 3) break;
				try {
					let ready = true;
					for (const material of candidate.materials) {
						if (!queue.ensure(candidate.mesh, material, scene, camera)) {
							ready = false;
							break;
						}
					}

					if (!ready) {
						pending.delete(candidate);
						pending.add(candidate);
						continue;
					}
					renderer.shadowMap.needsUpdate = true;
					finish(candidate, true);
					invalidate();
				} catch (error) {
					finish(candidate, false, error);
				}
			}
		} catch (error) {
			for (const candidate of [...pending]) finish(candidate, false, error);
		} finally {
			renderer.setRenderTarget(target);
			schedule();
		}
	}

	const prepare: Prepare = (mesh, stale) =>
		new Promise<boolean>((resolve, reject) => {
			if (disposed || stale()) {
				resolve(false);
				return;
			}

			const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			const { scene, camera } = context();
			// A dye rebuild must not wait a frame for every unchanged, already-ready group.
			if (
				camera &&
					renderer.getRenderTarget() === null &&
					queue.areReady(mesh, materials, scene, camera)
			) {
				renderer.shadowMap.needsUpdate = true;
				resolve(true);
				invalidate();
				return;
			}

			enqueue({ mesh, materials, stale, resolve, reject });
			schedule();
		});

	return {
		prepare,

		async prepareScene(stale: () => boolean, onProgress?: (completed: number, total: number) => void) {
			const { scene, camera } = context();
			if (disposed || !camera || stale()) return false;
			const meshes: Mesh[] = [];
			scene.traverseVisible((object) => {
				const mesh = object as Mesh;
				if (mesh.isMesh && camera.layers.test(mesh.layers)) meshes.push(mesh);
			});
			let completed = 0;
			onProgress?.(completed, meshes.length);
			// Enqueue in one pass. Calling prepare() per mesh would rescan the whole
			// scene for every cached-readiness check before yielding to the browser.
			const results = await Promise.all(meshes.map((mesh) => new Promise<boolean>((resolve, reject) => {
				if (disposed || stale()) { resolve(false); return; }
				enqueue({ mesh, stale, materials: Array.isArray(mesh.material) ? mesh.material : [mesh.material],
					resolve: (ready) => {
						if (ready && !stale()) onProgress?.(++completed, meshes.length);
						resolve(ready);
					}, reject });
				schedule();
			})));
			return !stale() && results.every(Boolean);
		},

		dispose() {
			disposed = true;
			if (frame !== undefined) cancelAnimationFrame(frame);
			frame = undefined;
			for (const candidate of [...pending]) finish(candidate, false);

			queue.dispose();
		},
	};
}
