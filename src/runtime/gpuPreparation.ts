import {
	Texture,
	type Camera,
	type Material,
	type Mesh,
	type Object3D,
	type Scene,
	type WebGLRenderer,
} from 'three';
import {
	finalizeMaterial,
	materialDependencies,
	materialNeedsFinalization,
} from './materialPreparation.js';

type Renderable = Object3D & { material?: Material | Material[]; geometry?: Mesh['geometry'] };

type Program = { program: WebGLProgram };

type Job = {
	material: Material;
	key: string;
	generation: number;
	cancelled: boolean;
	ready: boolean;
	compile: Material['onBeforeCompile'];
	sourceKey: string;
	failed: boolean;
	programs: Program[];
	textures: Texture[];
	commit: () => Promise<unknown>;
};

export interface GpuPreparationOptions {
	invalidate: () => void;
	budgetMs?: number;
	maxCompiles?: number;
	maxUploads?: number;
	uploadBytes?: number;
	clock?: () => number;
}

const contexts = new WeakMap<WebGLRenderer, ReturnType<typeof createGpuPreparation>>();

export function getGpuPreparationStats(renderer: WebGLRenderer) {
	return contexts.get(renderer)?.getStats();
}

function materialKey(material: Material) {
	const textures = Object.entries(material)
		.filter(([, value]) => value instanceof Texture)
		.map(([name, value]) => [name, value.uuid, value.channel, value.colorSpace]);
	return JSON.stringify([
		material.type,
		material.customProgramCacheKey(),
		material.defines,
		material.side,
		material.transparent,
		material.forceSinglePass,
		material.toneMapped,
		material.alphaTest > 0,
		material.alphaHash,
		material.vertexColors,
		material.premultipliedAlpha,
		textures,
	]);
}

function collectTextures(material: Material, uniforms: Record<string, { value: unknown }> | undefined) {
	const result = new Set<Texture>();
	const visited = new Set<object>();

	const visit = (value: unknown) => {
		if (!value || typeof value !== 'object' || visited.has(value)) return;

		visited.add(value);
		if (value instanceof Texture) {
			if (!value.isRenderTargetTexture && !('isDepthTexture' in value)) result.add(value);
		} else if (Array.isArray(value)) value.forEach(visit);
		else if (Object.getPrototypeOf(value) === Object.prototype) Object.values(value).forEach(visit);
	};

	for (const value of Object.values(material)) if (value instanceof Texture) visit(value);

	if (uniforms) for (const uniform of Object.values(uniforms)) visit(uniform.value);
	return [...result];
}

function textureBytes(texture: Texture) {
	const images = Array.isArray(texture.image) ? texture.image : [texture.image];
	return images.reduce(
		(bytes, image) =>
			bytes +
			(image?.data?.byteLength ??
				(image?.width ?? 1) * (image?.height ?? 1) * (image?.depth ?? 1) * 4),
		0,
	);
}

/** Budget preparation work while the renderer owns programs and textures. */
export function createGpuPreparation(renderer: WebGLRenderer, options: GpuPreparationOptions) {
	const clock = options.clock ?? (() => performance.now());
	const records = new Map<Material, Map<string, Job>>();
	const releases = new Map<Material, () => void>();
	const uploads = new WeakMap<Texture, { generation: number; version: number }>();
	const textureReleases = new Map<Texture, () => void>();

	const pending = new Set<Job>();
	const compiling = new Set<Material>();

	let generation = 0;
	let disposed = false;
	let lost = false;

	let owner: unknown;
	let sceneState = '';

	let spent = 0;
	let submissions = 0;
	let uploaded = 0;
	let bytes = 0;

	const stats = {
		submitted: 0,
		completed: 0,
		cancelled: 0,
		uploads: 0,
		uploadBytes: 0,
		compileCpuMs: 0,
		uploadCpuMs: 0,
		maxTaskMs: 0,
		startedAt: clock(),
		lastReadyAt: 0,
		resets: 0,
		errors: 0,
	};

	const budget = () => !disposed && !lost && spent < (options.budgetMs ?? 3);

	const measured = <T>(kind: 'compileCpuMs' | 'uploadCpuMs', action: () => T) => {
		const start = clock();
		try {
			return action();
		} finally {
			const ms = clock() - start;
			spent += ms;
			stats[kind] += ms;
			stats.maxTaskMs = Math.max(stats.maxTaskMs, ms);
		}
	};

	function cancel(job: Job) {
		if (job.cancelled) return;

		job.cancelled = true;
		if (!job.ready) stats.cancelled++;
		pending.delete(job);
		compiling.delete(job.material);
		job.programs = [];
	}

	function reset() {
		generation++;
		stats.resets++;
		for (const variants of records.values()) for (const job of variants.values()) cancel(job);

		records.clear();
		renderer.shadowMap.needsUpdate = true;
		options.invalidate();
	}

	function watch(material: Material) {
		if (releases.has(material)) return;

		const release = () => {
			for (const job of records.get(material)?.values() ?? []) cancel(job);

			records.delete(material);
			releases.delete(material);
			material.removeEventListener('dispose', release);
		};

		material.addEventListener('dispose', release);
		releases.set(material, release);
	}

	function watchTexture(texture: Texture) {
		if (textureReleases.has(texture)) return;

		const release = () => {
			uploads.delete(texture);
			texture.removeEventListener('dispose', release);
			textureReleases.delete(texture);
		};

		texture.addEventListener('dispose', release);
		textureReleases.set(texture, release);
	}

	function getSceneState(scene: Scene, camera: Camera) {
		const lights: unknown[] = [];
		scene.traverseVisible((object) => {
			if ('isLight' in object && object.layers.test(camera.layers))
				lights.push(object.type, object.uuid, object.castShadow);
		});
		return JSON.stringify([
			scene.uuid,
			renderer.shadowMap.enabled,
			renderer.shadowMap.type,
			renderer.toneMapping,
			renderer.outputColorSpace,
			scene.environment?.uuid,
			scene.fog?.constructor.name,
			camera.layers.mask,
			lights,
		]);
	}

	function jobKey(object: Renderable, material: Material) {
		const target = renderer.getRenderTarget();
		return JSON.stringify([
			materialKey(material),
			!!target,
			target?.texture.colorSpace,
			renderer.toneMapping,
			renderer.outputColorSpace,
			object.type,
			'isInstancedMesh' in object,
			'isBatchedMesh' in object,
			'isSkinnedMesh' in object,
			'instanceColor' in object && !!object.instanceColor,
			object.geometry &&
				Object.entries(object.geometry.attributes).map(([name, attribute]) => [
					name,
					attribute.itemSize,
					attribute.normalized,
				]),
			object.receiveShadow,
		]);
	}

	/** Readiness checks never submit work or reset the per-frame budget. */
	function areReady(object: Renderable, materials: Material[], scene: Scene, camera: Camera) {
		if (disposed || lost || owner !== scene || sceneState !== getSceneState(scene, camera)) return false;

		const ready = (material: Material): boolean => {
			if (materialNeedsFinalization(material, renderer, scene)) return false;

			const job = records.get(material)?.get(jobKey(object, material));
			if (
				!job?.ready ||
				job.cancelled ||
				job.generation !== generation ||
				job.compile !== material.onBeforeCompile ||
				job.sourceKey !== material.customProgramCacheKey()
			) return false;

			return (
				job.textures.every((texture) => {
					const upload = uploads.get(texture);
					return upload?.generation === generation && upload.version === texture.version;
				}) && materialDependencies(material).every(ready)
			);
		};

		return materials.every(ready);
	}

	function beginFrame(scene: Scene, camera: Camera, sceneOwner: unknown = scene) {
		spent = submissions = uploaded = bytes = 0;

		const state = getSceneState(scene, camera);
		if (owner !== sceneOwner || state !== sceneState) {
			owner = sceneOwner;
			sceneState = state;
			reset();
		}

		if (disposed || lost) return;

		const gl = renderer.getContext();
		const extension = gl.getExtension('KHR_parallel_shader_compile');
		for (const job of pending) {
			if (!budget()) break;
			if (
				job.cancelled ||
				job.generation !== generation ||
				job.compile !== job.material.onBeforeCompile ||
				job.sourceKey !== job.material.customProgramCacheKey()
			) {
				cancel(job);
				continue;
			}
			// Unlike Three's timer-based poll, these captured handles never outlive
			// disposal/context invalidation or look up a removed material property.
			if (
				extension &&
				job.programs.some((program) => !gl.getProgramParameter(program.program, extension.COMPLETION_STATUS_KHR))
			)
				continue;

			const failed = measured('compileCpuMs', () => job.programs.find((program) => !gl.getProgramParameter(program.program, gl.LINK_STATUS)));
			if (failed) {
				job.failed = true;
				stats.errors++;
				console.error('[GPU preparation] Shader link failed:', gl.getProgramInfoLog(failed.program));
				cancel(job);
				continue;
			}

			let complete = true;
			for (const texture of job.textures) {
				watchTexture(texture);

				const previous = uploads.get(texture);
				if (previous?.generation === generation && previous.version === texture.version) continue;
				const size = textureBytes(texture);
				if (
					!budget() ||
					uploaded >= (options.maxUploads ?? 2) ||
					(uploaded > 0 && bytes + size > (options.uploadBytes ?? 8 * 1024 * 1024))
				) {
					complete = false;
					break;
				}

				measured('uploadCpuMs', () => renderer.initTexture(texture));
				uploads.set(texture, { generation, version: texture.version });
				uploaded++;
				bytes += size;
				stats.uploads++;
				stats.uploadBytes += size;
			}

			if (!complete) continue;
			pending.delete(job);
			// All programs are now complete. compileAsync performs the renderer's
			// normal readiness check without leaving uncancellable polling timers.
			job
				.commit()
				.then(() => {
					compiling.delete(job.material);
					if (
						disposed ||
						job.cancelled ||
						job.generation !== generation ||
						job.compile !== job.material.onBeforeCompile ||
						job.sourceKey !== job.material.customProgramCacheKey()
					) return;

					job.ready = true;
					job.programs = [];
					stats.completed++;
					stats.lastReadyAt = clock();
					options.invalidate();
				})
				.catch((error) => {
					job.failed = true;
					stats.errors++;
					cancel(job);
					console.error('[GPU preparation]', error);
				});
		}

		if (pending.size || compiling.size) options.invalidate();
	}

	function ensure(object: Renderable, material: Material, scene: Scene, camera: Camera) {
		if (disposed || lost) return false;

		watch(material);
		if (materialNeedsFinalization(material, renderer, scene) && !budget()) return false;

		const materials = Array.isArray(object.material) ? object.material : null;
		const group = materials
			? (object.geometry?.groups.find((group) => materials.indexOf(material) === group.materialIndex) ?? null)
			: null;
		if (object.geometry && materialNeedsFinalization(material, renderer, scene))
			measured('compileCpuMs', () => finalizeMaterial(material, renderer, scene, camera, object.geometry!, object, group));

		if (material.customProgramCacheKey().includes('awaiting-')) return false;

		for (const dependency of materialDependencies(material))
			if (!ensure(object, dependency, scene, camera)) return false;

		const target = renderer.getRenderTarget();
		const key = jobKey(object, material);
		let variants = records.get(material);
		if (!variants) {
			variants = new Map();
			records.set(material, variants);
		}

		const previous = variants.get(key);
		if (previous?.failed) throw new Error(`GPU preparation failed for ${material.name || material.type}`);

		if (previous && !previous.cancelled) {
			if (!previous.ready) return false;
			if (previous.textures.every((texture) => uploads.get(texture)?.version === texture.version)) return true;

			previous.ready = false;
			pending.add(previous);
			compiling.add(material);
			return false;
		}

		if (
			!budget() ||
			compiling.has(material) ||
			submissions >= (options.maxCompiles ?? 4) ||
			compiling.size >= 8
		) return false;
		// Borrow geometry/instance state without allocating a duplicate instance
		// buffer or changing the object in the user's scene during compilation.
		const carrier = Object.create(object) as Renderable;
		carrier.children = [];
		carrier.material = material;

		const side = material.side;
		const transparent = material.transparent;
		const toneMapped = material.toneMapped;
		const tone = renderer.toneMapping;
		const colorSpace = renderer.outputColorSpace;

		const scoped = <T>(action: () => T) => {
			const previousTarget = renderer.getRenderTarget();
			const previousTone = renderer.toneMapping;
			const previousColorSpace = renderer.outputColorSpace;

			const state = {
				side: material.side,
				transparent: material.transparent,
				toneMapped: material.toneMapped,
			};

			try {
				renderer.setRenderTarget(target);
				renderer.toneMapping = tone;
				renderer.outputColorSpace = colorSpace;
				Object.assign(material, { side, transparent, toneMapped });
				return action();
			} finally {
				Object.assign(material, state);
				renderer.setRenderTarget(previousTarget);
				renderer.toneMapping = previousTone;
				renderer.outputColorSpace = previousColorSpace;
			}
		};

		measured('compileCpuMs', () => scoped(() => renderer.compile(carrier, camera, scene)));

		const properties = renderer.properties.get(material) as {
			programs: Map<string, Program>;
			uniforms?: Record<string, { value: unknown }>;
		};

		const job: Job = {
			material,
			key,
			generation,
			cancelled: false,
			ready: false,
			failed: false,
			compile: material.onBeforeCompile,
			sourceKey: material.customProgramCacheKey(),
			programs: [...properties.programs.values()],
			textures: collectTextures(material, properties.uniforms),

			commit: () =>
				scoped(() =>
					renderer.getContext().getExtension('KHR_parallel_shader_compile')
						? renderer.compileAsync(carrier, camera, scene)
						: Promise.resolve(renderer.compile(carrier, camera, scene)),
				),
		};

		job.textures.forEach(watchTexture);
		variants.set(key, job);
		pending.add(job);
		compiling.add(material);
		submissions++;
		stats.submitted++;
		options.invalidate();
		return false;
	}

	const contextLost = () => {
		lost = true;
		reset();
	};

	const contextRestored = () => {
		lost = false;
		reset();
	};

	renderer.domElement.addEventListener('webglcontextlost', contextLost);
	renderer.domElement.addEventListener('webglcontextrestored', contextRestored);

	function dispose() {
		if (disposed) return;

		disposed = true;
		reset();
		for (const release of [...releases.values()]) release();

		for (const release of [...textureReleases.values()]) release();

		renderer.domElement.removeEventListener('webglcontextlost', contextLost);
		renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
		contexts.delete(renderer);
	}

	function cancelMaterial(material: Material) {
		const variants = records.get(material);
		for (const [key, job] of variants ?? []) {
			if (!job.ready) cancel(job);
			// A rejected candidate has reported its failure. A later import may
			// retry it; do not preserve a permanently failed preparation record.
			if (job.failed) variants!.delete(key);
		}

		for (const dependency of materialDependencies(material)) cancelMaterial(dependency);
	}

	const api = {
		beginFrame,
		ensure,
		areReady,
		cancelMaterial,
		reset,
		dispose,

		getStats: () => ({
			...stats,
			pending: compiling.size,
			generation,
			parallelCompile: !!renderer.getContext().getExtension('KHR_parallel_shader_compile'),
		}),
	};

	contexts.set(renderer, api);
	return api;
}

export type GpuPreparation = ReturnType<typeof createGpuPreparation>;
