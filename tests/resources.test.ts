import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataArrayTexture, DataTexture, MeshStandardMaterial, Texture, type WebGLRenderer } from 'three';
import { FurnitureResourceCache, FurnitureResources } from '../src/resources/resources.js';
import { createSourceMaterial } from '../src/materials/definition.js';
import type { FurnitureTextureResource } from '../src/furniture/types.js';
import { bundleFixture } from './checkpoint/bundleFixture';

const owners: FurnitureResources[] = [];
let cache: FurnitureResourceCache;

beforeEach(() => {
	cache = new FurnitureResourceCache();
});

describe('standard material resource loading', () => {
	const ids = ['a', 'b', 'c', 'd', 'e'].map((value) => `t-${value.repeat(16)}`);
	const definition = {
		pbrMetallicRoughness: {
			baseColorTexture: { resource: ids[0]! },
			metallicRoughnessTexture: { resource: ids[1]! },
		},
		normalTexture: { resource: ids[2]! },
		occlusionTexture: { resource: ids[3]! },
		emissiveTexture: { resource: ids[4]! },
	};

	it('requests independent PBR textures together and owns only sampler clones', async () => {
		const { owner } = fixture();
		const complete: Array<(source: Texture) => void> = [];
		const sources = ids.map(() => new Texture());
		const dispose = sources.map((source) => vi.spyOn(source, 'dispose'));
		const image = vi.spyOn(owner, 'image').mockImplementation(() => new Promise((resolve) => complete.push(resolve)));
		const pending = createSourceMaterial(definition, owner, 'full');
		expect(image).toHaveBeenCalledTimes(5);
		complete.forEach((resolve, index) => resolve(sources[index]!));

		const material = await pending as MeshStandardMaterial;
		const maps = [material.map, material.metalnessMap, material.normalMap, material.aoMap, material.emissiveMap];
		maps.forEach((map, index) => {
			expect(map).not.toBe(sources[index]);
			expect(map!.source).toBe(sources[index]!.source);
		});
		expect(material.roughnessMap).toBe(material.metalnessMap);
		const cloneDispose = maps.map((map) => vi.spyOn(map!, 'dispose'));
		material.dispose();
		for (const spy of cloneDispose) expect(spy).toHaveBeenCalledOnce();

		for (const spy of dispose) expect(spy).not.toHaveBeenCalled();
	});

	it('deduplicates identical sampler requests while keeping different color spaces independent', async () => {
		const { owner } = fixture();
		const source = new Texture();
		const image = vi.spyOn(owner, 'image').mockResolvedValue(source);
		const info = { resource: ids[0]! };
		const material = await createSourceMaterial({
			pbrMetallicRoughness: { baseColorTexture: info, metallicRoughnessTexture: info },
			normalTexture: info,
			emissiveTexture: info,
		}, owner, 'full') as MeshStandardMaterial;
		expect(image).toHaveBeenCalledTimes(2);
		expect(material.map).toBe(material.emissiveMap);
		expect(material.metalnessMap).toBe(material.normalMap);
		expect(material.map).not.toBe(material.normalMap);
		expect(material.map!.colorSpace).not.toBe(material.normalMap!.colorSpace);
		material.dispose();
	});

	it('waits for remaining texture requests before cleaning up a failed material', async () => {
		const { owner } = fixture();
		let complete!: (source: Texture) => void;
		const source = new Texture();
		const clone = source.clone();
		vi.spyOn(source, 'clone').mockReturnValue(clone);
		const dispose = vi.spyOn(clone, 'dispose');
		vi.spyOn(owner, 'image')
			.mockRejectedValueOnce(new Error('Image unavailable'))
			.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
		const pending = createSourceMaterial({
			pbrMetallicRoughness: { baseColorTexture: { resource: ids[0]! } },
			normalTexture: { resource: ids[1]! },
		}, owner, 'full');
		const rejected = expect(pending).rejects.toThrow('Image unavailable');
		expect(complete).toBeTypeOf('function');
		complete(source);
		await rejected;
		expect(dispose).toHaveBeenCalledOnce();
	});
});

afterEach(() => {
	for (const owner of owners.splice(0)) owner.dispose();

	cache.dispose();
});

function fixture() {
	const bundle = bundleFixture([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]);
	const fetch = vi.fn(async () => bundle.data.buffer);
	const textures: Record<string, FurnitureTextureResource> = {
		a: {
			mimeType: 'image/webp',
			encoding: 'rgb-alpha',
			full: bundle.resources[0]!,
			lite: bundle.resources[0]!,
			alpha: { full: bundle.resources[2]! },
		},
		b: {
			mimeType: 'image/webp',
			encoding: 'rgb-alpha',
			full: bundle.resources[1]!,
			lite: bundle.resources[1]!,
		},
	};

	const decode = vi.spyOn(cache.pixelDecoder, 'decode').mockImplementation(async (rgb, alpha, signal) => {
		signal.throwIfAborted();
		return { width: 1, height: 1, data: new Uint8Array([rgb[0]!, 45, 67, alpha ? 0 : 255]) };
	});

	const createOwner = () => {
		const owner = new FurnitureResources({ textures, rawResources: {}, bundles: bundle.bundles }, '/', cache, undefined, fetch);
		owners.push(owner);
		return owner;
	};
	const owner = createOwner();

	return { owner, createOwner, decode, fetch, textures };
}

describe('split-image native paper arrays', () => {
	it('assembles ordered layers with hidden RGB, shares transport, and releases decoded layer staging', async () => {
		const { owner, decode, fetch } = fixture();
		const texture = await owner.paperArray(['a', 'b'], 'full') as DataArrayTexture;
		expect(texture.image).toMatchObject({
			width: 1,
			height: 1,
			depth: 2,
			data: new Uint8Array([1, 45, 67, 0, 2, 45, 67, 255]),
		});
		expect(texture.flipY).toBe(false);
		expect(await owner.paperArray(['a', 'b'], 'full')).toBe(texture);
		expect(decode).toHaveBeenCalledTimes(2);
		expect(fetch).toHaveBeenCalledTimes(1);

		const disposed = vi.fn();
		texture.addEventListener('dispose', disposed);
		owner.dispose();
		expect(disposed).toHaveBeenCalledOnce();
	});

	it('keeps alpha quality in the cache identity and also supplies ordinary 2D bindings', async () => {
		const { owner, decode } = fixture();
		const full = await owner.image('a', 'full') as DataTexture;
		const lite = await owner.image('a', 'lite') as DataTexture;
		expect(full.image.data).toEqual(new Uint8Array([1, 45, 67, 0]));
		expect(lite.image.data).toEqual(new Uint8Array([1, 45, 67, 255]));
		expect(await owner.image('a', 'full')).toBe(full);
		expect(decode).toHaveBeenCalledTimes(2);
	});

	it('shares complete arrays across content aliases and owners until the last lease releases', async () => {
		const { owner, createOwner, decode, textures } = fixture();
		textures.alias = { ...textures.a! };
		const other = createOwner();
		const first = await owner.paperArray(['a', 'b'], 'full');
		const second = await other.paperArray(['alias', 'b'], 'full');
		expect(second).toBe(first);
		expect(decode).toHaveBeenCalledTimes(2);

		const dispose = vi.fn();
		first.addEventListener('dispose', dispose);
		owner.dispose();
		cache.clearUnused();
		expect(dispose).not.toHaveBeenCalled();
		expect(await other.paperArray(['a', 'b'], 'full')).toBe(first);
		other.dispose();
		expect(dispose).toHaveBeenCalledOnce();

		const replacement = await createOwner().paperArray(['a', 'b'], 'full');
		expect(replacement).not.toBe(first);
		expect(decode).toHaveBeenCalledTimes(4);
	});

	it('includes layer order, color content and the selected alpha quality in array identity', async () => {
		const { owner, createOwner, textures } = fixture();
		const full = await owner.paperArray(['a', 'b'], 'full');
		const reversed = await createOwner().paperArray(['b', 'a'], 'full');
		const lite = await createOwner().paperArray(['a', 'b'], 'lite');
		expect(reversed).not.toBe(full);
		expect(lite).not.toBe(full);
		expect((reversed as DataArrayTexture).image.data).toEqual(new Uint8Array([2, 45, 67, 255, 1, 45, 67, 0]));
		expect((lite as DataArrayTexture).image.data).toEqual(new Uint8Array([1, 45, 67, 255, 2, 45, 67, 255]));

		textures.a = { ...textures.a!, full: textures.b!.full };
		const changed = await createOwner().paperArray(['a', 'b'], 'full');
		expect(changed).not.toBe(full);
	});

	it('releases staging pixels while complete arrays remain shared', async () => {
		const { owner, createOwner, decode } = fixture();
		const array = await owner.paperArray(['a'], 'full');
		expect(await createOwner().paperArray(['a'], 'full')).toBe(array);
		expect(decode).toHaveBeenCalledOnce();

		await owner.image('a', 'full');
		expect(decode).toHaveBeenCalledTimes(2);
	});

	it('continues a shared pending array after its first owner is cancelled', async () => {
		const { owner, createOwner, decode } = fixture();
		let complete!: () => void;
		let signal!: AbortSignal;
		decode.mockImplementationOnce((_rgb, _alpha, active) => new Promise((resolve) => {
			signal = active;
			complete = () => resolve({ width: 1, height: 1, data: new Uint8Array(4) });
		}));

		const pending = owner.paperArray(['a', 'b'], 'full');
		const rejected = expect(pending).rejects.toThrow(/lease|abort/i);
		const other = createOwner();
		const shared = other.paperArray(['a', 'b'], 'full');
		await vi.waitFor(() => expect(complete).toBeTypeOf('function'));

		owner.dispose();
		expect(signal.aborted).toBe(false);
		complete();
		const array = await shared;
		await rejected;
		expect((array as DataArrayTexture).image.depth).toBe(2);
		expect(decode).toHaveBeenCalledTimes(2);
	});

	it('aborts pending arrays only after every owner releases and permits a retry', async () => {
		const { owner, createOwner, decode } = fixture();
		let complete!: () => void;
		let signal!: AbortSignal;
		decode.mockImplementationOnce((_rgb, _alpha, active) => new Promise((resolve) => {
			signal = active;
			complete = () => resolve({ width: 1, height: 1, data: new Uint8Array(4) });
		}));
		const other = createOwner();
		const first = expect(owner.paperArray(['a'], 'full')).rejects.toThrow(/lease|abort/i);
		const second = expect(other.paperArray(['a'], 'full')).rejects.toThrow(/lease|abort/i);
		await vi.waitFor(() => expect(complete).toBeTypeOf('function'));

		owner.dispose();
		other.dispose();
		expect(signal.aborted).toBe(true);
		complete();
		await Promise.all([first, second]);
		expect(await createOwner().paperArray(['a'], 'full')).toBeInstanceOf(DataArrayTexture);
		expect(decode).toHaveBeenCalledTimes(2);
	});

	it('does not bind a deferred shared load to the first owner lifetime', async () => {
		const { owner, createOwner, decode } = fixture();
		const rejected = expect(owner.paperArray(['a'], 'full')).rejects.toThrow(/lease|abort/i);
		const shared = createOwner().paperArray(['a'], 'full');
		owner.dispose();

		expect(await shared).toBeInstanceOf(DataArrayTexture);
		await rejected;
		expect(decode).toHaveBeenCalledOnce();
	});

	it('checks each requesting renderer without poisoning compatible owners', async () => {
		const { owner, createOwner, decode } = fixture();
		const other = createOwner();
		owner.renderer = {
			capabilities: { maxTextureSize: 1 },
			getContext: () => ({ MAX_ARRAY_TEXTURE_LAYERS: 0x88FF, getParameter: () => 1 }),
		} as unknown as WebGLRenderer;
		const rejected = expect(owner.paperArray(['a', 'b'], 'full')).rejects.toThrow('GPU limits');
		const shared = await other.paperArray(['a', 'b'], 'full');
		await rejected;
		expect(shared).toBeInstanceOf(DataArrayTexture);
		expect(await other.paperArray(['a', 'b'], 'full')).toBe(shared);
		expect(decode).toHaveBeenCalledTimes(2);
	});

	it('retires a failed shared array so active owners can retry the same content', async () => {
		const { owner, createOwner, decode } = fixture();
		const other = createOwner();
		decode.mockRejectedValueOnce(new Error('Pixel decode failed'));
		await Promise.all([
			expect(owner.paperArray(['a'], 'full')).rejects.toThrow('Pixel decode failed'),
			expect(other.paperArray(['a'], 'full')).rejects.toThrow('Pixel decode failed'),
		]);

		const array = await owner.paperArray(['a'], 'full');
		expect(await other.paperArray(['a'], 'full')).toBe(array);
		expect(decode).toHaveBeenCalledTimes(2);
	});

	it('disposes shared arrays exactly once when the cache shuts down', async () => {
		const { owner, createOwner } = fixture();
		const other = createOwner();
		const array = await owner.paperArray(['a'], 'full');
		expect(await other.paperArray(['a'], 'full')).toBe(array);
		const dispose = vi.fn();
		array.addEventListener('dispose', dispose);

		cache.dispose();
		owner.dispose();
		other.dispose();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it('rejects mismatched layers and oversized allocations', async () => {
		const { owner, decode } = fixture();
		decode.mockResolvedValueOnce({ width: 1, height: 1, data: new Uint8Array(4) });
		decode.mockResolvedValueOnce({ width: 2, height: 1, data: new Uint8Array(8) });
		await expect(owner.paperArray(['a', 'b'], 'full')).rejects.toThrow('dimensions differ');

		decode.mockResolvedValueOnce({ width: 2 ** 30, height: 1, data: new Uint8Array(4) });
		await expect(owner.paperArray(['a'], 'full')).rejects.toThrow('dimensions');
	});

	it('does not publish late decoder results after owner cancellation', async () => {
		const { owner, decode } = fixture();
		let complete!: () => void;
		decode.mockImplementationOnce(() => new Promise((resolve) => {
			complete = () => resolve({ width: 1, height: 1, data: new Uint8Array(4) });
		}));

		const pending = owner.paperArray(['a'], 'full');
		await vi.waitFor(() => expect(complete).toBeTypeOf('function'));

		owner.dispose();
		complete();
		await expect(pending).rejects.toThrow(/lease|abort/i);
	});

	it('rejects missing or unsplit layers before transport', async () => {
		const { owner, fetch, textures } = fixture();
		delete textures.a!.encoding;

		await expect(owner.paperArray(['a'], 'full')).rejects.toThrow('not a split image');
		await expect(owner.paperArray(['missing'], 'lite')).rejects.toThrow('not a split image');
		expect(fetch).not.toHaveBeenCalled();
	});
});
