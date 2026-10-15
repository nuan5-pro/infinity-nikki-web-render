import type { Camera, InstancedMesh, Material, Scene, WebGLRenderer } from 'three';
import { createGpuPreparation } from './gpuPreparation.js';

type Prepare = (mesh: InstancedMesh, stale: () => boolean) => Promise<boolean>;

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
		mesh: InstancedMesh
		materials: Material[]
		stale: () => boolean
		resolve: (ready: boolean) => void
		reject: (error: unknown) => void
	};

	const pending: Candidate[] = [];
	let disposed = false;
	let frame: number | undefined;

	function finish(candidate: Candidate, ready: boolean, error?: unknown) {
		const index = pending.indexOf(candidate);
		if (index >= 0) pending.splice(index, 1);
		if (!ready)
			for (const material of candidate.materials) {
				if (!pending.some((other) => other.materials.includes(material)))
					queue.cancelMaterial(material);
			}

		if (error !== undefined) candidate.reject(error);
		else candidate.resolve(ready);
	}

	function schedule() {
		if (!disposed && pending.length && frame === undefined) frame = requestAnimationFrame(tick);
	}

	function tick() {
		frame = undefined;
		for (const candidate of [...pending]) if (candidate.stale()) finish(candidate, false);

		if (disposed || !pending.length) return;

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
			queue.beginFrame(scene, camera);
			for (const candidate of [...pending]) {
				try {
					let ready = true;
					for (const material of candidate.materials) {
						if (!queue.ensure(candidate.mesh, material, scene, camera)) ready = false;
					}

					if (!ready) continue;
					renderer.shadowMap.needsUpdate = true;
					finish(candidate, true);
					invalidate();
				} catch (error) {
					finish(candidate, false, error);
				}
			}
			// Rotate the starting group so a large candidate cannot monopolize submissions.
			if (pending.length > 1) pending.push(pending.shift()!);
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

			pending.push({ mesh, materials, stale, resolve, reject });
			schedule();
		});

	return {
		prepare,

		dispose() {
			disposed = true;
			if (frame !== undefined) cancelAnimationFrame(frame);
			frame = undefined;
			for (const candidate of [...pending]) finish(candidate, false);

			queue.dispose();
		},
	};
}
