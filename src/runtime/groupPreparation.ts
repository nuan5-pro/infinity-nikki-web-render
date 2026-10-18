import type { Camera, Material, Mesh, Scene, WebGLRenderer } from 'three';
import { createGpuPreparation } from './gpuPreparation.js';

type Prepare = (mesh: Mesh, stale: () => boolean) => Promise<boolean>;

export function createGroupPreparation(
	renderer: WebGLRenderer,
	context: () => { scene: Scene; camera: Camera | undefined },
	invalidate: () => void,
) {
	const budgetMs = 6;
	const windowSize = 8;
	// Shared-source texture clones can initialize without uploading. Bound work
	// by CPU time and bytes instead of spending a whole frame per texture wrapper.
	const queue = createGpuPreparation(renderer, {
		invalidate,
		maxCompiles: windowSize,
		maxUploads: Infinity,
		budgetMs,
	});

	type Candidate = {
		mesh: Mesh;
		materials: Material[];
		next: number;
		active: Set<Material>;
		frame: number;
		checks: number;
		stale: () => boolean;
		resolve: (ready: boolean) => void;
		reject: (error: unknown) => void;
	};

	const pending = new Set<Candidate>();
	const users = new Map<Material, number>();
	let disposed = false;
	let frame: number | undefined;
	let frameId = 0;

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

	function enqueue(candidate: Omit<Candidate, 'next' | 'active' | 'frame' | 'checks'>) {
		const entry = { ...candidate, next: 0, active: new Set<Material>(), frame: -1, checks: 0 };
		pending.add(entry);
		for (const material of candidate.materials) users.set(material, (users.get(material) ?? 0) + 1);
	}

	function tick() {
		frame = undefined;
		if (disposed || !pending.size) return;

		// Cancellation must not wait behind the frame's GPU upload budget.
		for (const candidate of pending) {
			try {
				if (candidate.stale()) finish(candidate, false);
			} catch (error) {
				finish(candidate, false, error);
			}
		}
		if (!pending.size) return;

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
			frameId++;
			let idle = 0;
			while (pending.size && idle < pending.size && performance.now() - start < budgetMs) {
				const candidate = pending.values().next().value!;
				pending.delete(candidate);
				pending.add(candidate);
				if (candidate.stale()) {
					finish(candidate, false);
					idle = 0;
					continue;
				}

				try {
					let advanced = false;
					// Poll only the unresolved window, once per frame. Completed prefixes
					// stay out of the hot path while other materials compile in parallel.
					if (candidate.frame !== frameId) {
						candidate.frame = frameId;
						candidate.checks = candidate.active.size;
					}

					// One material per turn keeps admission and polling fair. Cached
					// materials can still advance when compilation slots are occupied.
					let material: Material | undefined;
					if (candidate.checks) {
						material = candidate.active.values().next().value!;
						candidate.active.delete(material);
						candidate.checks--;
					} else if (candidate.next < candidate.materials.length && candidate.active.size < windowSize)
						material = candidate.materials[candidate.next++]!;

					if (material) {
						if (!queue.ensure(candidate.mesh, material, scene, camera)) candidate.active.add(material);
						advanced = true;
					}

					if (candidate.next === candidate.materials.length && !candidate.active.size) {
						// Recheck once at handoff in case an earlier dependency changed
						// while this candidate's remaining materials were being prepared.
						if (candidate.materials.every((material) => queue.ensure(candidate.mesh, material, scene, camera))) {
							renderer.shadowMap.needsUpdate = true;
							finish(candidate, true);
							invalidate();
						} else candidate.next = 0;
						advanced = true;
					}

					idle = advanced ? 0 : idle + 1;
				} catch (error) {
					finish(candidate, false, error);
					idle = 0;
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
