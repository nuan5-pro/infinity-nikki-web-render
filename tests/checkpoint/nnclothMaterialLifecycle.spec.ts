import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Material, MeshPhysicalMaterial, Texture, type WebGLRenderer } from 'three';
import type { FurnitureResourceReader } from '../../src/resources/resources.js';
import {
	NN_CLOTH_SOURCE_DOMAIN,
	NN_CLOTH_SOURCE_PROGRAMS,
	NN_CLOTH_SOURCE_WORDS,
} from '../../src/materials/nncloth/nnclothSourceDomain.js';
import { installNNClothRendererContext } from '../../src/materials/nncloth/nnclothRendererContext.js';
import {
	assertNNClothMaterialAdmission,
	bindNNClothResources,
	createNNClothMaterial,
	disposeNNClothResources,
} from '../../src/materials/nncloth/nnclothMaterial.js';

const hooks = vi.hoisted(() => ({ binary: vi.fn() }));
vi.mock('../../src/materials/nncloth/nnclothBinaryInputs.js', () => ({
	createNNClothBinaryInputs: hooks.binary,
}));
// This suite exercises ownership and cancellation. Native words/ABI arithmetic
// are independently covered by source conformance and actual Full verification.
vi.mock('../../src/materials/nncloth/nnclothGeometryABI.js', () => ({
	createNNClothGeometryABI: () => ({}),
}));
vi.mock('../../src/materials/nncloth/nnclothBinary.js', () => ({
	nativePayloadSHA256: async (bytes: Uint8Array & { expectedSHA?: string }) => bytes.expectedSHA,

	readNNClothResource: async (_reader: unknown, reference: { byteLength: number; resource: string }) => {
		const bytes = new Uint8Array(reference.byteLength) as Uint8Array & { expectedSHA?: string };
		bytes.expectedSHA = [NN_CLOTH_SOURCE_WORDS, ...Object.values(NN_CLOTH_SOURCE_PROGRAMS)].find(
			(hash) => reference.resource === `r-${hash.slice(0, 16)}`,
		);
		if (reference.byteLength === 290 * 8) {
			const view = new DataView(bytes.buffer);
			for (let index = 0; index < 290; index++) view.setUint32(index * 8, index, true);
		}

		return bytes;
	},
}));
vi.mock('../../src/materials/nncloth/nnclothCompiledMaterial.js', async () => {
	const { MeshPhysicalMaterial } = await import('three');
	return { createNNClothCompiledMaterial: () => new MeshPhysicalMaterial() };
});
vi.mock('../../src/materials/nncloth/nnclothShadowMaterial.js', async () => {
	const { MeshPhysicalMaterial } = await import('three');
	return { createNNClothShadowMaterial: () => new MeshPhysicalMaterial() };
});

const cleanups: (() => void)[] = [];

function setupRenderer() {
	const gl = { isContextLost: () => false } as unknown as WebGL2RenderingContext;

	const renderer = {
		getContext: () => gl,

		domElement: new EventTarget(),
	} as unknown as WebGLRenderer;

	const dispose = installNNClothRendererContext(renderer);
	cleanups.push(dispose);
	return { renderer, dispose };
}

function source(renderer?: WebGLRenderer) {
	const material = new Material();

	const reference = (sha256: string, bytes: number) => ({
		resource: `r-${sha256.slice(0, 16) || '0'.repeat(16)}`,
		byteOffset: 0,
		byteLength: bytes,
	});

	material.userData.nncloth = {
		family: 'nncloth-native-v7',
		version: 1,
		requiredUV: [0, 1, 2],
		shaderUVMap: [0, 1, 2, 2],
		specialization: {
			domain: NN_CLOTH_SOURCE_DOMAIN,
			materialWordsSHA256: NN_CLOTH_SOURCE_WORDS,
			sourceIdentity: 'cf21b27749125766ff38ef43cb326c7ca5551650cf373be9946d69a394e7b0bc',
			sourceLocalVS: 'af2ca7d3f7ae9869ed35ddd1a633b0a5e8e8e371',
			baseBodyPS: '4f9048bf28caea97b67e19873500be1945b2f3c0',
			depthPS: '760993f8df605d2bf10ca7033b96a164a2b0f912',
			shadowPS: 'ccec016086b33f6dca8e84e5732b43fd408642d4',
		},
		programs: Object.fromEntries(Object.entries(NN_CLOTH_SOURCE_PROGRAMS).map(([key, sha]) => [key, reference(sha, 4)])),
		materialWords: reference(NN_CLOTH_SOURCE_WORDS, 290 * 8),
		binaryInputs: {},
		collections: {
			domain: 'native-authored-defaults-static-preview-not-live',
			tod: reference('', 31 * 16),
			weather: reference('', 40 * 16),
		},
	};
	material.userData.nnclothSourceGeometry = {
		sourceModelSHA256: '86f4a78a8c1d1dfb0363610adc5fea291f01d2ea4b9badf7d49388ee9737d846',
		packageSHA256: '28ac568b2d847e89576ef32495b633e1f09c802c8fcd686a79789018083fb264',
		bounds: {
			source: 'UStaticMesh.ExtendedBounds-native-cm',
			origin: [3.9578094, -41.421417, 218.51549],
			extent: [275.8152, 170.4451, 220.85936],
			radius: 378.1394500732422,
		},
		sourceBinding: {
			version: 1,
			domain: NN_CLOTH_SOURCE_DOMAIN,
			sourceIdentity: material.userData.nncloth.specialization.sourceIdentity,
			sourcePath:
				'/Game/Assets/Buildin/Parts/Jewelry/PABJ0004/Material/M_PABJ0004_02.M_PABJ0004_02',
			sourceMaterialIndex: 0,
			nativeMaterialSlot: 1,
			geometrySHA256: '200b6e5a3321a73a56877c5a89d8c571db66e8ab55f6c893360a2f5c20974e94',
		},
	};

	const resources = { renderer } as FurnitureResourceReader;
	assertNNClothMaterialAdmission(material);
	bindNNClothResources(material, resources);
	cleanups.push(() => disposeNNClothResources(resources));
	return { material, resources };
}

function deferred() {
	let resolve!: (value: Record<string, Texture>) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<Record<string, Texture>>((ok, fail) => {
		resolve = ok;
		reject = fail;
	});
	return { promise, resolve, reject };
}

beforeEach(() => hooks.binary.mockReset());
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('native source async ownership', () => {
	it('rejects geometry without an admitted profile and swapped original/variant identity', () => {
		const input = source();
		delete input.material.userData.nncloth;
		expect(() => assertNNClothMaterialAdmission(input.material)).toThrow(/no admitted/);

		const other = source();
		other.material.userData.nnclothSourceGeometry.sourceBinding.sourceIdentity = '3d6add604fb2d3ac28a8955a40d32ae8b611d9c972c8eaaa6381fd5dfa3439a9';
		expect(() => assertNNClothMaterialAdmission(other.material)).toThrow(/identity/);
	});

	it('binds pack resources without model proof but never grants native geometry admission', async () => {
		const input = source();
		delete input.material.userData.nnclothSourceGeometry;
		expect(() => bindNNClothResources(input.material, input.resources)).not.toThrow();
		await expect(createNNClothMaterial(input.material)).rejects.toThrow(/geometry|binding/i);
		expect(hooks.binary).not.toHaveBeenCalled();
	});

	it('rejects absent renderer before touching binary resources', async () => {
		await expect(createNNClothMaterial(source().material)).rejects.toThrow(/renderer/);
		expect(hooks.binary).not.toHaveBeenCalled();
	});

	it('shares only a single GLTF/profile/lease request and checks actual draw renderer', async () => {
		const active = setupRenderer();
		const input = source(active.renderer);
		const other = source(active.renderer);
		hooks.binary.mockImplementation(async () => ({ t3: new Texture() }));

		const [a, b, c] = await Promise.all([
			createNNClothMaterial(input.material),
			createNNClothMaterial(input.material),
			createNNClothMaterial(other.material),
		]);
		expect(hooks.binary).toHaveBeenCalledTimes(2);

		const args = [] as unknown as Parameters<Material['onBeforeRender']>;
		args[0] = {} as WebGLRenderer;
		expect(() => a.onBeforeRender(...args)).toThrow(/lease/);
		args[0] = active.renderer;
		expect(() => a.onBeforeRender(...args)).not.toThrow();
		a.dispose();
		b.dispose();
		c.dispose();
	});

	it('cancels a replaced request, disposes its late textures once, and keeps the new request', async () => {
		const active = setupRenderer();
		const input = source(active.renderer);
		const first = deferred();
		const second = deferred();
		hooks.binary.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

		const old = createNNClothMaterial(input.material);
		const rejected = expect(old).rejects.toThrow();
		await vi.waitFor(() => expect(hooks.binary).toHaveBeenCalledTimes(1));

		const replace = installNNClothRendererContext(active.renderer);
		cleanups.push(replace);
		active.dispose();

		const current = createNNClothMaterial(input.material);
		await vi.waitFor(() => expect(hooks.binary).toHaveBeenCalledTimes(2));

		const oldTexture = new Texture();
		const oldDispose = vi.spyOn(oldTexture, 'dispose');
		first.resolve({ t3: oldTexture });
		await rejected;
		expect(oldDispose).toHaveBeenCalledTimes(1);
		second.resolve({ t3: new Texture() });
		expect(await current).toBeInstanceOf(MeshPhysicalMaterial);
		await createNNClothMaterial(input.material);
		expect(hooks.binary).toHaveBeenCalledTimes(2);
	});

	it('failed hydration can retry, and source disposal rejects a late completed request', async () => {
		const active = setupRenderer();
		const input = source(active.renderer);
		hooks.binary
			.mockRejectedValueOnce(new Error('hydration rejected'))
			.mockResolvedValueOnce({ t3: new Texture() });
		await expect(createNNClothMaterial(input.material)).rejects.toThrow('hydration rejected');
		await createNNClothMaterial(input.material);
		expect(hooks.binary).toHaveBeenCalledTimes(2);

		const pending = deferred();
		const another = source(active.renderer);
		hooks.binary.mockReturnValueOnce(pending.promise);

		const result = createNNClothMaterial(another.material);
		const rejected = expect(result).rejects.toThrow(/disposed|canceled/);
		await vi.waitFor(() => expect(hooks.binary).toHaveBeenCalledTimes(3));
		disposeNNClothResources(another.resources);

		const texture = new Texture();
		const dispose = vi.spyOn(texture, 'dispose');
		pending.resolve({ t3: texture });
		await rejected;
		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
