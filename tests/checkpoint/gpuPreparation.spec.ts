import { describe, expect, it, vi } from 'vitest';
import {
	BoxGeometry,
	DataTexture,
	DirectionalLight,
	Mesh,
	MeshBasicMaterial,
	PerspectiveCamera,
	Scene,
	Texture,
	WebGLRenderTarget,
	type Material,
	type WebGLRenderer,
} from 'three';
import {
	createGpuPreparation,
	type GpuPreparationOptions,
} from '../../src/runtime/gpuPreparation.js';
import {
	invalidateMaterialBindings,
	registerMaterialDependencies,
	registerMaterialFinalizer,
} from '../../src/runtime/materialPreparation.js';
import { bindPaperMaterial } from '../../src/furniture/paperMaterial.js';
import { CustomDataBuffer } from '../../src/furniture/customData.js';
import { makeTextureRecoverable, TextureSource } from '../../src/resources/textureSource.js';

function setup(options: Partial<GpuPreparationOptions> = {}) {
	const scene = new Scene();
	const camera = new PerspectiveCamera();
	const material = new MeshBasicMaterial();
	const mesh = new Mesh(new BoxGeometry(), material);
	scene.add(mesh);

	let complete = false;
	let target: WebGLRenderTarget | null = null;
	const properties = new Map<Material, any>();

	const get = (material: Material) => {
		if (!properties.has(material)) properties.set(material, { programs: new Map(), uniforms: {} });
		return properties.get(material);
	};

	const context = {
		LINK_STATUS: 2,

		getExtension: () => ({ COMPLETION_STATUS_KHR: 1 }),

		getProgramParameter: vi.fn((_program, parameter) => parameter === 2 || complete),
	};

	const renderer = {
		toneMapping: 3,
		outputColorSpace: 'srgb',
		shadowMap: { enabled: false, type: 1, needsUpdate: false },
		domElement: new EventTarget(),
		properties: { get },

		getContext: () => context,

		getRenderTarget: () => target,

		setRenderTarget: (value: WebGLRenderTarget | null) => {
			target = value;
		},

		compile: vi.fn((object: Mesh) => {
			const value = object.material as MeshBasicMaterial;
			const state = get(value);
			const program = { program: {}, getUniforms: () => ({ seq: [] }) };
			state.programs.set('program', program);
			state.currentProgram = program;
			const shader = {
				uniforms: { map: { value: value.map } },
				vertexShader: 'void main() {}',
				fragmentShader: 'void main() {}',
			};
			value.onBeforeCompile(shader as never, renderer);
			state.uniforms = shader.uniforms;
		}),
		compileAsync: vi.fn(async () => {}),
		initTexture: vi.fn(),
		render: vi.fn(),
	} as unknown as WebGLRenderer;

	const gpu = createGpuPreparation(renderer, {
		invalidate: vi.fn(),

		clock: () => 0,

		maxUploads: 1,
		...options,
	});
	return {
		scene,
		camera,
		material,
		mesh,
		renderer,
		context,
		gpu,

		complete: () => {
			complete = true;
		},
	};
}

describe('bounded renderer-owned GPU preparation', () => {
	it('rehydrates retired pixels for samplers created by deferred material and shadow variants', async () => {
		const state = setup();
		const { gpu, scene, camera, renderer, mesh, material } = state;
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const decode = vi.fn(async () => new DataTexture(bytes.slice(), 1, 1));
		const texture = makeTextureRecoverable(new DataTexture(bytes, 1, 1), decode);
		const source = texture.source as TextureSource;
		source.retain().release();
		registerMaterialFinalizer(material, () => {
			material.map?.dispose();
			material.map = texture.clone();
		});
		vi.mocked(renderer.initTexture).mockImplementation(sampler => {
			expect(sampler.source).toBe(source);
			expect((sampler as DataTexture).image.data).toEqual(bytes);
		});
		state.complete();
		try {
			for (const [index, enabled] of [false, true].entries()) {
				renderer.shadowMap.enabled = enabled;
				gpu.beginFrame(scene, camera);
				expect(gpu.ensure(mesh, material, scene, camera)).toBe(false);
				gpu.beginFrame(scene, camera);
				expect(renderer.initTexture).toHaveBeenCalledTimes(index);
				expect(gpu.areReady(mesh, [material], scene, camera)).toBe(false);
				await vi.waitFor(() => expect(source.resident).toBe(true));
				gpu.beginFrame(scene, camera);
				await Promise.resolve();
				expect(gpu.areReady(mesh, [material], scene, camera)).toBe(true);
				expect(source.resident).toBe(false);
				expect(renderer.initTexture).toHaveBeenLastCalledWith(material.map);
			}
			expect(decode).toHaveBeenCalledTimes(2);
		} finally {
			gpu.dispose();
			material.map?.dispose();
			material.dispose();
			mesh.geometry.dispose();
			texture.dispose();
		}
	});

	it.each(['pending', 'ready'] as const)(
		'refreshes %s paper bindings after buffer growth without reviving disposed textures or recompiling',
		async (phase) => {
			const state = setup();
			const { gpu, scene, camera, renderer, mesh, material } = state;
			material.userData.foliage = { home: true };
			const previous = new CustomDataBuffer([1], 1, 64);
			const next = new CustomDataBuffer([1], 16, 64);
			bindPaperMaterial(material, previous);
			gpu.beginFrame(scene, camera);
			gpu.ensure(mesh, material, scene, camera);
			state.complete();
			if (phase === 'ready') {
				gpu.beginFrame(scene, camera);
				await Promise.resolve();
				expect(gpu.areReady(mesh, [material], scene, camera)).toBe(true);
			}

			bindPaperMaterial(material, next);
			previous.dispose();
			vi.mocked(renderer.initTexture).mockClear();
			const before = gpu.getStats();
			expect(gpu.areReady(mesh, [material], scene, camera)).toBe(false);
			expect(gpu.getStats()).toEqual(before);
			expect(renderer.initTexture).not.toHaveBeenCalled();
			expect(gpu.ensure(mesh, material, scene, camera)).toBe(false);
			gpu.beginFrame(scene, camera);
			await Promise.resolve();
			expect(gpu.areReady(mesh, [material], scene, camera)).toBe(true);
			expect(renderer.initTexture).toHaveBeenCalledExactlyOnceWith(next.texture);
			expect(renderer.compile).toHaveBeenCalledTimes(1);
			expect(renderer.compileAsync).toHaveBeenCalledTimes(1);
			gpu.dispose();
			next.dispose();
			mesh.geometry.dispose();
			material.dispose();
		},
	);

	it('refreshes generic uniform replacements during commit before publishing readiness', async () => {
		const state = setup();
		const { gpu, scene, camera, renderer, mesh, material } = state;
		const previous = new Texture();
		const next = new Texture();
		const uniform = { value: previous };
		material.onBeforeCompile = (shader) => { shader.uniforms.dynamicTexture = uniform; };
		let commit!: () => void;
		vi.mocked(renderer.compileAsync).mockImplementation(() => new Promise((resolve) => { commit = resolve; }));
		gpu.beginFrame(scene, camera);
		gpu.ensure(mesh, material, scene, camera);
		state.complete();
		gpu.beginFrame(scene, camera);
		expect(renderer.initTexture).toHaveBeenCalledExactlyOnceWith(previous);
		uniform.value = next;
		invalidateMaterialBindings(material);
		previous.dispose();
		commit();
		await Promise.resolve();
		expect(gpu.getStats().completed).toBe(0);
		expect(gpu.areReady(mesh, [material], scene, camera)).toBe(false);
		gpu.beginFrame(scene, camera);
		expect(gpu.areReady(mesh, [material], scene, camera)).toBe(true);
		expect(vi.mocked(renderer.initTexture).mock.calls.map(([texture]) => texture)).toEqual([previous, next]);
		expect(renderer.compile).toHaveBeenCalledTimes(1);
		expect(renderer.compileAsync).toHaveBeenCalledTimes(1);
		gpu.dispose();
		next.dispose();
	});

	it('refreshes binding dependencies in every cached lighting variant without recompiling', async () => {
		const state = setup();
		const { gpu, scene, camera, renderer, mesh, material } = state;
		material.userData.foliage = { home: true };
		const previous = new CustomDataBuffer([1], 1, 64);
		const next = new CustomDataBuffer([1], 16, 64);
		bindPaperMaterial(material, previous);
		state.complete();
		for (const enabled of [false, true]) {
			renderer.shadowMap.enabled = enabled;
			gpu.beginFrame(scene, camera);
			gpu.ensure(mesh, material, scene, camera);
			gpu.beginFrame(scene, camera);
			await Promise.resolve();
			expect(gpu.areReady(mesh, [material], scene, camera)).toBe(true);
		}
		bindPaperMaterial(material, next);
		previous.dispose();
		vi.mocked(renderer.initTexture).mockClear();
		for (const enabled of [false, true, false]) {
			renderer.shadowMap.enabled = enabled;
			gpu.beginFrame(scene, camera);
			gpu.ensure(mesh, material, scene, camera);
			gpu.beginFrame(scene, camera);
			await Promise.resolve();
			expect(gpu.areReady(mesh, [material], scene, camera)).toBe(true);
		}
		expect(renderer.initTexture).toHaveBeenCalledExactlyOnceWith(next.texture);
		expect(renderer.compile).toHaveBeenCalledTimes(2);
		expect(renderer.compileAsync).toHaveBeenCalledTimes(2);
		gpu.dispose();
		next.dispose();
	});

	it.each(['resolve', 'reject'] as const)(
		'keeps a replacement job in flight when an older cancelled commit later %ss',
		async (mode) => {
			const state = setup();
			const { gpu, scene, camera, renderer, mesh, material } = state;
			let settle!: () => void;
			vi.mocked(renderer.compileAsync).mockImplementationOnce(() => new Promise((resolve, reject) => {
				settle = () => mode === 'resolve' ? resolve() : reject(new Error('retired commit'));
			}));
			state.complete();
			gpu.beginFrame(scene, camera);
			gpu.ensure(mesh, material, scene, camera);
			gpu.beginFrame(scene, camera);
			gpu.cancelMaterial(material);
			gpu.ensure(mesh, material, scene, camera);
			expect(gpu.getStats().pending).toBe(1);
			settle();
			await Promise.resolve();
			await Promise.resolve();
			expect(gpu.getStats()).toMatchObject({ pending: 1, completed: 0, errors: 0 });
			gpu.beginFrame(scene, camera);
			await Promise.resolve();
			expect(gpu.areReady(mesh, [material], scene, camera)).toBe(true);
			expect(gpu.getStats()).toMatchObject({ pending: 0, completed: 1, errors: 0 });
			gpu.dispose();
		},
	);

	it('submits independent dependency programs together while retaining the global in-flight bound', () => {
		const state = setup({ maxCompiles: 100 });
		const { gpu, scene, camera, renderer, mesh, material } = state;
		const dependencies = Array.from({ length: 10 }, () => new MeshBasicMaterial());
		registerMaterialDependencies(material, dependencies);
		gpu.beginFrame(scene, camera);
		expect(gpu.ensure(mesh, material, scene, camera)).toBe(false);
		expect(renderer.compile).toHaveBeenCalledTimes(8);
		expect(gpu.getStats().pending).toBe(8);
		gpu.beginFrame(scene, camera);
		gpu.ensure(mesh, material, scene, camera);
		expect(renderer.compile).toHaveBeenCalledTimes(8);
		gpu.dispose();
		dependencies.forEach((dependency) => dependency.dispose());
	});

	it('rotates upload work when one job exhausts the frame budget', async () => {
		let time = 0;
		const state = setup({ maxUploads: Infinity, clock: () => time });
		const { gpu, scene, camera, renderer, mesh, material } = state;
		const other = new MeshBasicMaterial();
		for (const value of [material, other])
			for (const slot of ['map', 'alphaMap', 'lightMap'] as const) value[slot] = new Texture();
		vi.mocked(renderer.initTexture).mockImplementation(() => { time += 2; });
		gpu.beginFrame(scene, camera);
		gpu.ensure(mesh, material, scene, camera);
		gpu.ensure(mesh, other, scene, camera);
		state.complete();
		gpu.beginFrame(scene, camera);
		gpu.beginFrame(scene, camera);
		const uploaded = vi.mocked(renderer.initTexture).mock.calls.map(([texture]) => texture);
		expect(uploaded).toHaveLength(4);
		expect(uploaded.slice(0, 2).every((texture) => [material.map, material.alphaMap, material.lightMap].includes(texture))).toBe(true);
		expect(uploaded.slice(2).every((texture) => [other.map, other.alphaMap, other.lightMap].includes(texture))).toBe(true);
		gpu.beginFrame(scene, camera);
		await Promise.resolve();
		expect(gpu.getStats().completed).toBe(2);
		gpu.dispose();
		for (const value of [material, other]) {
			for (const slot of ['map', 'alphaMap', 'lightMap'] as const) value[slot]?.dispose();
			value.dispose();
		}
	});

	it.each(['dispose', 'context', 'reset'] as const)('does not revive a %s-retired commit after its promise resolves', async (mode) => {
		const state = setup();
		const { gpu, scene, camera, renderer, mesh, material } = state;
		let commit!: () => void;
		vi.mocked(renderer.compileAsync).mockImplementationOnce(() => new Promise((resolve) => { commit = resolve; }));
		gpu.beginFrame(scene, camera);
		gpu.ensure(mesh, material, scene, camera);
		state.complete();
		gpu.beginFrame(scene, camera);
		switch (mode) {
		case 'dispose': material.dispose(); break;
		case 'context': renderer.domElement.dispatchEvent(new Event('webglcontextlost')); break;
		case 'reset': gpu.reset(); break;
		}
		commit();
		await Promise.resolve();
		expect(gpu.getStats()).toMatchObject({ pending: 0, completed: 0, errors: 0 });
		expect(gpu.areReady(mesh, [material], scene, camera)).toBe(false);
		gpu.dispose();
	});

	it('retains completed lighting/shadow variants and texture uploads across scene state changes', async () => {
		const state = setup();
		const { gpu, scene, camera, renderer, mesh, material } = state;
		material.map = new Texture();
		state.complete();
		for (const enabled of [false, true]) {
			renderer.shadowMap.enabled = enabled;
			gpu.beginFrame(scene, camera);
			expect(gpu.ensure(mesh, material, scene, camera)).toBe(false);
			gpu.beginFrame(scene, camera);
			await Promise.resolve();
			expect(gpu.ensure(mesh, material, scene, camera)).toBe(true);
		}
		for (const enabled of [false, true, false]) {
			renderer.shadowMap.enabled = enabled;
			gpu.beginFrame(scene, camera);
			expect(gpu.areReady(mesh, [material], scene, camera)).toBe(true);
			expect(gpu.ensure(mesh, material, scene, camera)).toBe(true);
		}
		expect(renderer.compile).toHaveBeenCalledTimes(2);
		expect(renderer.initTexture).toHaveBeenCalledTimes(1);
		expect(gpu.getStats().resets).toBe(1);
		gpu.dispose();
	});

	it('does not reuse a completed job after replacing the compile callback under the same key', async () => {
		const state = setup();
		const { gpu, scene, camera, renderer, mesh, material } = state;
		material.customProgramCacheKey = () => 'stable';
		state.complete();
		gpu.beginFrame(scene, camera);
		gpu.ensure(mesh, material, scene, camera);
		gpu.beginFrame(scene, camera);
		await Promise.resolve();
		material.onBeforeCompile = () => {};
		expect(gpu.ensure(mesh, material, scene, camera)).toBe(false);
		expect(renderer.compile).toHaveBeenCalledTimes(2);
		gpu.dispose();
	});
	it.each([
		'texture',
		'source',
		'callback',
		'light',
		'shadow',
		'camera',
		'target',
		'dispose',
		'context',
		'reset',
	] as const)(
		'checks cached readiness without submitting work and rejects %s changes',
		async (mode) => {
			const state = setup();
			const { gpu, scene, camera, renderer, material, mesh } = state;
			material.map = new Texture();
			gpu.beginFrame(scene, camera);
			gpu.ensure(mesh, material, scene, camera);
			state.complete();
			gpu.beginFrame(scene, camera);
			await Promise.resolve();

			const before = gpu.getStats();
			expect(gpu.areReady(mesh, [material], scene, camera)).toBe(true);
			expect(gpu.getStats()).toEqual(before);
			switch (mode) {
			case 'texture':
				material.map.needsUpdate = true;
				break;
			case 'source':
				material.customProgramCacheKey = () => 'changed';
				break;
			case 'callback':
				material.onBeforeCompile = () => {};
				break;
			case 'light':
				scene.add(new DirectionalLight());
				break;
			case 'shadow':
				renderer.shadowMap.enabled = true;
				break;
			case 'camera':
				camera.layers.enable(1);
				break;
			case 'target':
				renderer.setRenderTarget(new WebGLRenderTarget(1, 1));
				break;
			case 'dispose':
				material.dispose();
				break;
			case 'context':
				renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
				break;
			case 'reset':
				gpu.reset();
				break;
			}

			const changed = gpu.getStats();
			expect(gpu.areReady(mesh, [material], scene, camera)).toBe(false);
			expect(gpu.getStats()).toEqual(changed);
			expect(renderer.compile).toHaveBeenCalledTimes(1);
			expect(renderer.initTexture).toHaveBeenCalledTimes(1);
			renderer.getRenderTarget()?.dispose();
			gpu.dispose();
			mesh.geometry.dispose();
			material.map.dispose();
			material.dispose();
		},
	);

	it('keeps the byte budget when texture initialization is not count-limited', async () => {
		const state = setup({ maxUploads: Infinity, uploadBytes: 8 * 1024 * 1024 });
		const { gpu, scene, camera, renderer, material, mesh } = state;
		for (const slot of ['map', 'alphaMap', 'lightMap'] as const) {
			material[slot] = new Texture();
			material[slot].image = { width: 1024, height: 1024 };
		}

		gpu.beginFrame(scene, camera);
		gpu.ensure(mesh, material, scene, camera);
		state.complete();
		gpu.beginFrame(scene, camera);
		await Promise.resolve();
		expect(renderer.initTexture).toHaveBeenCalledTimes(2);
		expect(renderer.compileAsync).not.toHaveBeenCalled();
		gpu.beginFrame(scene, camera);
		await Promise.resolve();
		expect(renderer.initTexture).toHaveBeenCalledTimes(3);
		expect(gpu.getStats().completed).toBe(1);
		gpu.dispose();
	});

	it('yields on the CPU budget without a texture count limit', async () => {
		let time = 0;
		const state = setup({ maxUploads: Infinity, budgetMs: 3,

			clock: () => time });
		const { gpu, scene, camera, renderer, material, mesh } = state;
		for (const slot of ['map', 'alphaMap', 'lightMap'] as const) material[slot] = new Texture();

		vi.mocked(renderer.initTexture).mockImplementation(() => {
			time += 2;
		});
		gpu.beginFrame(scene, camera);
		gpu.ensure(mesh, material, scene, camera);
		state.complete();
		gpu.beginFrame(scene, camera);
		await Promise.resolve();
		expect(renderer.initTexture).toHaveBeenCalledTimes(2);
		expect(renderer.compileAsync).not.toHaveBeenCalled();
		gpu.beginFrame(scene, camera);
		await Promise.resolve();
		expect(renderer.initTexture).toHaveBeenCalledTimes(3);
		expect(gpu.getStats().completed).toBe(1);
		expect(gpu.getStats().maxTaskMs).toBe(2);
		gpu.dispose();
	});

	it('does not draw a pending program, waits for KHR completion, and keeps texture uploads bounded', async () => {
		const state = setup();
		const { gpu, scene, camera, renderer, material, mesh } = state;
		material.map = new Texture();
		material.alphaMap = new Texture();
		gpu.beginFrame(scene, camera);
		gpu.ensure(mesh, material, scene, camera);
		expect(renderer.compile).toHaveBeenCalledTimes(1);
		expect(renderer.compileAsync).not.toHaveBeenCalled();
		gpu.beginFrame(scene, camera);
		expect(renderer.initTexture).not.toHaveBeenCalled();
		state.complete();
		gpu.beginFrame(scene, camera);
		await Promise.resolve();
		expect(renderer.initTexture).toHaveBeenCalledTimes(1);
		expect(renderer.compileAsync).not.toHaveBeenCalled();
		gpu.beginFrame(scene, camera);
		await Promise.resolve();
		expect(renderer.initTexture).toHaveBeenCalledTimes(2);
		expect(renderer.compileAsync).toHaveBeenCalledTimes(1);
		expect(gpu.getStats().completed).toBe(1);
		gpu.beginFrame(scene, camera);
		expect(gpu.ensure(mesh, material, scene, camera)).toBe(true);
		material.map.needsUpdate = true;
		gpu.ensure(mesh, material, scene, camera);
		expect(gpu.getStats().pending).toBe(1);
		gpu.beginFrame(scene, camera);
		await Promise.resolve();
		expect(renderer.initTexture).toHaveBeenCalledTimes(3);
		gpu.dispose();
	});

	it.each(['dispose', 'scene', 'context', 'source'] as const)(
		'retires %s-invalidated submissions without publishing late readiness',
		async (mode) => {
			const state = setup();
			const { gpu, scene, camera, renderer, material } = state;
			gpu.beginFrame(scene, camera);
			gpu.ensure(state.mesh, material, scene, camera);
			switch (mode) {
			case 'dispose':
				material.dispose();
				break;
			case 'scene':
				gpu.beginFrame(scene, camera, {});
				break;
			case 'context':
				renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
				break;
			case 'source':
				material.customProgramCacheKey = () => 'new-structure';
				break;
			}

			state.complete();
			gpu.beginFrame(scene, camera);
			await Promise.resolve();
			expect(gpu.getStats().completed).toBe(0);
			expect(renderer.compileAsync).not.toHaveBeenCalled();
			gpu.dispose();
		},
	);

	it('finalizes an actual deferred source before submission and does not warm its placeholder', () => {
		const state = setup();
		const { gpu, scene, camera, renderer, material } = state;
		material.customProgramCacheKey = () => 'awaiting-real-context';
		registerMaterialFinalizer(material, (actualRenderer, actualScene) => {
			expect(actualRenderer).toBe(renderer);
			expect(actualScene).toBe(scene);
			material.customProgramCacheKey = () => 'final-source';
		});
		vi.mocked(renderer.compile).mockImplementation((object) => {
			expect((object as Mesh).material).toBe(material);
			expect(material.customProgramCacheKey()).toBe('final-source');
			renderer.properties.get(material).programs = new Map();
		});
		gpu.beginFrame(scene, camera);
		gpu.ensure(state.mesh, material, scene, camera);
		expect(renderer.compile).toHaveBeenCalledTimes(1);
		gpu.dispose();
	});

	it('reports a failed link and permits retry after the rejected candidate releases it', () => {
		const state = setup();
		const { gpu, scene, camera, renderer, material, mesh, context } = state;
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		Object.assign(context, { getProgramInfoLog: () => 'texture units exceeded' });
		context.getProgramParameter.mockImplementation((_program, parameter) => parameter !== 2);
		gpu.beginFrame(scene, camera);
		gpu.ensure(mesh, material, scene, camera);
		gpu.beginFrame(scene, camera);
		expect(() => gpu.ensure(mesh, material, scene, camera)).toThrow('GPU preparation failed');
		expect(gpu.getStats().pending).toBe(0);
		gpu.cancelMaterial(material);
		context.getProgramParameter.mockImplementation(() => true);
		gpu.beginFrame(scene, camera);
		expect(gpu.ensure(mesh, material, scene, camera)).toBe(false);
		expect(renderer.compile).toHaveBeenCalledTimes(2);
		gpu.dispose();
		log.mockRestore();
	});
});
