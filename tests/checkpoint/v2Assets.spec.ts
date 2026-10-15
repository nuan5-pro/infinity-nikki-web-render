import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BufferGeometry,
	Float32BufferAttribute,
	Group,
	Mesh,
	MeshStandardMaterial,
	Texture,
} from 'three';
import type { FurnitureAsset, FurnitureDB } from '../../src/furniture/types.js';
import {
	decodeFurnitureCatalog,
	resolveFurnitureModel,
} from '../../src/furniture/manifest.js';
import {
	FurnitureResourceCache,
	fetchFurnitureAsset,
	FurnitureResources,
} from '../../src/resources/resources.js';
import { createSourceMaterial } from '../../src/materials/definition.js';
import {
	createModelAssetData,
	finalizeMaterialForGeometry,
} from '../../src/furniture/assets.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { readTextureInputs } from '../../src/materials/textureInputs.js';
import { readEditorMaterialPreview } from '../../src/materials/editorMaterialPreview.js';
import {
	buildDefaultPlainMaterial,
	buildMaterialRegistryFromDefinition,
	disposeMaterialRegistry,
	resolveTextureRef,
} from '../../src/materials/factory.js';
import { bundleFixture } from './bundleFixture';

function asset(bytes: Uint8Array, directory = 'textures', extension = 'bin'): FurnitureAsset {
	const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
	return { path: `${directory}/resource-${hash}.${extension}`, bytes: bytes.byteLength };
}

function catalog(): FurnitureDB {
	return {
		schemaVersion: 4,
		defaults: {
			mesh: { rotation: [0, 0, 0, 1], scale: [1, 1, 1], trans: [0, 0, 0] },
			furniture: { root_offset: [0, 0, 0], assembled: false },
		},
		furniture: [],
		materials: {},
		textures: {},
		rawResources: {},
		bundles: {},
	};
}

let cache = new FurnitureResourceCache();
afterEach(() => {
	cache.dispose();
	cache = new FurnitureResourceCache();
	vi.unstubAllGlobals();
});

describe('compact furniture resources', () => {
	it('allows content aliases but rejects ambiguous bundle ownership and overlapping member ranges', () => {
		const packet = bundleFixture([new Uint8Array([1]), new Uint8Array([2])]);
		const data = catalog();
		data.bundles = packet.bundles;
		for (const resource of packet.resources) {
			data.rawResources[`r-${resource.sha256.slice(0, 16)}`] = { ...resource };
		}

		const first = packet.resources[0]!;
		const image = `t-${'a'.repeat(16)}`;
		data.textures[image] = { mimeType: 'image/png', full: { ...first }, lite: { ...first } };
		expect(decodeFurnitureCatalog(data)).toEqual([]);

		const otherBundle = `b-${'f'.repeat(16)}`;
		data.bundles[otherBundle] = packet.data.byteLength;
		data.textures[image]!.lite.bundle = otherBundle;
		expect(() => decodeFurnitureCatalog(data)).toThrow('multiple bundle owners');
		data.textures[image]!.lite.bundle = first.bundle;

		const second = packet.resources[1]!;
		data.rawResources[`r-${second.sha256.slice(0, 16)}`]!.byteOffset = first.byteOffset;
		expect(() => decodeFurnitureCatalog(data)).toThrow('ranges overlap');
	});

	it('expands compact TRS exactly and rejects absent geometry rather than aliasing Full', () => {
		const data = catalog();
		const model = asset(new Uint8Array([1]), 'models-full', 'glb');
		const id = `m-${'a'.repeat(16)}`;
		data.materials[id] = { name: 'accepted' };
		data.furniture = [
			{
				id: 1,
				componentCount: 1, customData: [0], colorings: {},
				root_offset: [1.25, 2.5, 3.75],
				meshes: [{ sourceIndex: 0, models: { full: model }, slots: [id], rotation: [0.1, 0.2, 0.3, 0.4] }],
			},
		];

		const item = decodeFurnitureCatalog(data)[0]!;
		expect(item.root_offset).toEqual({ x: 1.25, y: 2.5, z: 3.75 });
		expect(item.meshes[0]!.rotation).toEqual({ x: 0.1, y: 0.2, z: 0.3, w: 0.4 });
		expect(item.meshes[0]!.scale).toEqual({ x: 1, y: 1, z: 1 });
		expect(() => resolveFurnitureModel(item.meshes[0]!, { model: 'lite', material: 'full' })).toThrow('no quality fallback');
	});

	it('fetches one grouped binary for independent native mip ranges, validates offsets and shares the addressed data', async () => {
		const fixture = bundleFixture([new Uint8Array([1, 2, 3, 4, 5, 6])]);
		const id = `r-${fixture.resource.sha256.slice(0, 16)}`;
		const fetchAsset = vi.fn(async () => fixture.data.buffer);
		const owner = new FurnitureResources(
			{ textures: {}, rawResources: { [id]: fixture.resource }, bundles: fixture.bundles },
			'/', cache, undefined,
			fetchAsset,
		);
		const [first, second] = await Promise.all([
			owner.read({ resource: id, byteOffset: 0, byteLength: 2 }),
			owner.read({ resource: id, byteOffset: 2, byteLength: 4 }),
		]);
		expect(Array.from(first)).toEqual([1, 2]);
		expect(Array.from(second)).toEqual([3, 4, 5, 6]);
		expect(first.buffer).toBe(second.buffer);
		expect(fetchAsset).toHaveBeenCalledTimes(1);
		await expect(owner.read({ resource: id, byteOffset: 4, byteLength: 3 })).rejects.toThrow('range');
		owner.dispose();
	});

	it('shares prepared geometry bytes globally across owners and retires disposed readers', async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const file = asset(bytes, 'models-full');
		const load = vi.fn(async () => bytes.buffer);
		const first = new FurnitureResources({ textures: {}, rawResources: {}, bundles: {} }, '/', cache, undefined, load);
		const second = new FurnitureResources({ textures: {}, rawResources: {}, bundles: {} }, '/', cache, undefined, load);
		expect(await first.readAsset(file)).toBe(await second.readAsset(file));
		first.dispose();
		expect(await second.readAsset(file)).toBe(bytes.buffer);
		await expect(first.readAsset(file)).rejects.toThrow('disposed');
		second.dispose();

		const replacement = new FurnitureResources({ textures: {}, rawResources: {}, bundles: {} }, '/', cache, undefined, load);
		expect(await replacement.readAsset(file)).toBe(bytes.buffer);
		expect(load).toHaveBeenCalledTimes(1);
		replacement.dispose();
	});

	it('decodes pixel content once across IDs/qualities/owners, preserving material-local sampler state', async () => {
		const fixture = bundleFixture([new Uint8Array([7, 8])]);
		const file = fixture.resource;
		const definition = { mimeType: 'image/webp' as const, full: file, lite: file };

		const resources = {
			textures: { [`t-${'a'.repeat(16)}`]: definition, [`t-${'b'.repeat(16)}`]: definition },
			rawResources: {},
			bundles: fixture.bundles,
		};

		const bitmap = { close: vi.fn() };
		const texture = new Texture();
		texture.source.data = bitmap;

		const decode = vi.fn(async () => texture);
		const load = vi.fn(async () => fixture.data.buffer);
		const first = new FurnitureResources(resources, '/', cache, decode, load);
		const second = new FurnitureResources(resources, '/', cache, decode, load);
		const a = await first.image(`t-${'a'.repeat(16)}`, 'full');
		const b = await second.image(`t-${'b'.repeat(16)}`, 'lite');
		expect(a).toBe(b);

		const material = (await createSourceMaterial(
			{
				name: 'PBR',
				pbrMetallicRoughness: {
					baseColorTexture: {
						resource: `t-${'a'.repeat(16)}`,
						sampler: { wrapS: 10497 },
						texCoord: 1,
					},
				},
				normalTexture: { resource: `t-${'b'.repeat(16)}`, sampler: { wrapS: 33071 }, scale: 0.5 },
			},
			first,
			'full',
		)) as MeshStandardMaterial;
		expect(material.map!.source).toBe(material.normalMap!.source);
		expect(material.map!.wrapS).not.toBe(material.normalMap!.wrapS);
		expect(material.map!.colorSpace).not.toBe(material.normalMap!.colorSpace);
		expect(material.map!.channel).toBe(1);
		expect(material.normalScale.toArray()).toEqual([0.5, 0.5]);
		material.dispose();
		first.dispose();
		expect(bitmap.close).not.toHaveBeenCalled();
		second.dispose();
		expect(bitmap.close).toHaveBeenCalledTimes(1);
		expect(decode).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('does not revive a disposed owner after decoding finishes late and retries failed downloads', async () => {
		const fixture = bundleFixture([new Uint8Array([11, 12])]);
		const file = fixture.resource;
		const id = `t-${'c'.repeat(16)}`;

		const table = {
			textures: { [id]: { mimeType: 'image/webp' as const, full: file, lite: file } },
			rawResources: {},
			bundles: fixture.bundles,
		};

		let complete!: (texture: Texture) => void;
		const decode = vi.fn(
			() =>
				new Promise<Texture>((resolve) => {
					complete = resolve;
				}),
		);
		const owner = new FurnitureResources(table, '/', cache, decode, async () => fixture.data.buffer);
		const loading = owner.image(id, 'full');
		const rejected = expect(loading).rejects.toThrow('expired');
		await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
		owner.dispose();

		const late = new Texture();
		const dispose = vi.spyOn(late, 'dispose');
		complete(late);
		await rejected;
		expect(dispose).toHaveBeenCalledTimes(1);

		const retryFixture = bundleFixture([new Uint8Array([13, 14])]);
		const retryAsset = retryFixture.resource;
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValue(retryFixture.data.buffer);
		const retry = new FurnitureResources(
			{
				textures: { [id]: { mimeType: 'image/webp', full: retryAsset, lite: retryAsset } },
				rawResources: {},
				bundles: retryFixture.bundles,
			},
			'/', cache, async () => new Texture(),
			fetch,
		);
		await expect(retry.image(id, 'full')).rejects.toThrow('network');
		await expect(retry.image(id, 'full')).resolves.toBeInstanceOf(Texture);
		retry.dispose();
	});

	it('rejects corrupt content while leaving host service-worker cache ownership intact', async () => {
		const bytes = new Uint8Array([21, 22, 23]);
		const file = asset(bytes);
		const deleted = vi.fn(async () => true);
		vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0, 0, 0]))));
		vi.stubGlobal('caches', {
			keys: async () => ['furniture-bundles', 'unrelated'],

			open: async () => ({ delete: deleted }),
		});
		await expect(fetchFurnitureAsset(file, new AbortController().signal, '/')).rejects.toThrow('digest');
		expect(deleted).not.toHaveBeenCalled();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
		expect(new Uint8Array(await fetchFurnitureAsset(file, new AbortController().signal, '/'))).toEqual(bytes);
	});

	it('preserves repeated resource slices while failed references remain retryable and never own shared pixels', async () => {
		const fixture = bundleFixture([new Uint8Array([31, 32])]);
		const file = fixture.resource;
		const id = `t-${'d'.repeat(16)}`;
		const load = vi
			.fn()
			.mockRejectedValueOnce(new Error('retryable'))
			.mockResolvedValue(fixture.data.buffer);
		const pixel = new Texture();
		const dispose = vi.spyOn(pixel, 'dispose');
		const resources = new FurnitureResources(
			{
				textures: { [id]: { mimeType: 'image/webp', full: file, lite: file } },
				rawResources: {},
				bundles: fixture.bundles,
			},
			'/', cache, async () => pixel,
			load,
		);

		const definition = {
			name: 'Material',
			extras: { textureInputs: { D: { images: [id, id], usage: 'base-color', srgb: true } } },
		};

		const registry = buildMaterialRegistryFromDefinition(definition, resources, 'full');
		const entry = registry.get('Material')!;
		await expect(resolveTextureRef(entry.D.get(0)!)).rejects.toThrow('retryable');
		expect(await resolveTextureRef(entry.D.get(0)!)).toBe(await resolveTextureRef(entry.D.get(1)!));
		expect(entry.D.get(0)!.resource).toBe(id);
		expect(entry.D.get(1)!.resource).toBe(id);
		disposeMaterialRegistry(registry);
		expect(dispose).not.toHaveBeenCalled();
		resources.dispose();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it('requires explicit role/transfer contracts, preserving declared repeated slice order', () => {
		const resources = new FurnitureResources({ textures: {}, rawResources: {}, bundles: {} }, '/', cache);
		const image = `t-${'a'.repeat(16)}`;
		expect(() =>
			buildMaterialRegistryFromDefinition(
				{
					name: 'M',
					extras: {
						textureInputs: { D: { images: ['old-name'], usage: 'base-color', srgb: true } },
					},
				},
				resources,
				'full',
			),
		).toThrow('resource ID');
		expect(() => readTextureInputs({ textureInputs: { D: { images: ['arbitrary'], usage: 'base-color' } } })).toThrow('srgb');
		expect(() =>
			readTextureInputs({
				textureInputs: { N: { images: ['arbitrary'], usage: 'normal', srgb: false } },
			}),
		).toThrow('normalEncoding');

		const input = {
			images: [image, image],
			usage: 'normal',
			srgb: false,
			normalEncoding: 'native-rg',
		};

		const registry = buildMaterialRegistryFromDefinition({ name: 'M', extras: { textureInputs: { N: input } } }, resources, 'full');
		expect(Array.from(registry.get('M')!.N.values()).map((ref) => ref.resource)).toEqual([
			image,
			image,
		]);

		const missing = catalog();
		missing.materials[`m-${'b'.repeat(16)}`] = {
			name: 'M',
			extras: { textureInputs: { N: input } },
		};
		expect(() => decodeFurnitureCatalog(missing)).toThrow('Missing image');
		expect(buildMaterialRegistryFromDefinition({ name: 'typed-only' }, resources, 'full').size).toBe(0);
		resources.dispose();
	});

	it('retains explicitly textureless slots without fetching image variants', async () => {
		const fetch = vi.fn();
		const resources = new FurnitureResources({ textures: {}, rawResources: {}, bundles: {} }, '/', cache, undefined, fetch);
		const registry = buildMaterialRegistryFromDefinition({ name: 'Textureless', extras: { textureInputs: {} } }, resources, 'full');
		const material = new MeshStandardMaterial();
		material.userData.textureInputs = {};
		expect(registry.has('Textureless')).toBe(true);
		await expect(buildDefaultPlainMaterial(material, 'Textureless', registry)).resolves.toBe(material);
		expect(fetch).not.toHaveBeenCalled();
		material.dispose();
		resources.dispose();
	});

	it('releases parsed geometry and placeholders when model admission fails', () => {
		const scene = new Group();
		const geometry = new BufferGeometry();
		const material = new MeshStandardMaterial();
		scene.add(new Mesh(geometry, material));

		const disposeGeometry = vi.spyOn(geometry, 'dispose');
		const disposeMaterial = vi.spyOn(material, 'dispose');

		const result = {
			scene,
			parser: { json: { extras: { furnitureV2: { version: 2, kind: 'model' } } } },
		} as unknown as GLTF;

		expect(() => createModelAssetData(result)).toThrow('Missing local slot/admission');
		expect(disposeGeometry).toHaveBeenCalledTimes(1);
		expect(disposeMaterial).toHaveBeenCalledTimes(1);
	});

	it('finalizes normal basis once on a fresh source clone, and compact preview readers do not require research prose', () => {
		const template = new MeshStandardMaterial();
		const geometry = new BufferGeometry();
		template.normalScale.set(2, 3);

		const derivative = template.clone();
		finalizeMaterialForGeometry(derivative, geometry);
		geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1], 4));

		const explicit = template.clone();
		finalizeMaterialForGeometry(explicit, geometry);
		expect(derivative.normalScale.y).toBe(-3);
		expect(explicit.normalScale.y).toBe(3);

		const preview = {
			family: 'editor-material-1',
			version: 1,
			color: [1, 1, 1],
			opacity: 1,
			roughness: 0.5,
			alpha: [],
			vertexColor: 'none',
			sampling: { D: { srgb: true, uv: 0, transform: [1, 1, 0, 0] } },
		};

		expect(readEditorMaterialPreview(preview)).toBe(preview);
		expect(
			readEditorMaterialPreview({
				...preview,
				sampling: { D: { srgb: true, uv: 9, transform: [1, 1, 0, 0] } },
			}),
		).toBeNull();
	});
});
