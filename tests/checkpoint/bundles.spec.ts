import { afterEach, describe, expect, it, vi } from 'vitest';
import { Texture } from 'three';
import {
	FurnitureResourceCache,
	FurnitureResources,
} from '../../src/resources/resources.js';
import { bundleFixture } from './bundleFixture';
import { furnitureBundleAsset, furnitureAssetUrl } from '../../src/furniture/manifest.js';

let cache = new FurnitureResourceCache();

afterEach(() => {
	cache.dispose();
	cache = new FurnitureResourceCache();
	vi.unstubAllGlobals();
});

describe('explicitly shared furniture bundles', () => {
	it('derives the immutable URL from the compact numeric bundle table', () => {
		const id = `b-${'a'.repeat(16)}`;
		expect(furnitureAssetUrl('/', furnitureBundleAsset(id, 123))).toBe(`/textures/${id}.bin`);
		expect(() => furnitureBundleAsset(id, 15)).toThrow('Invalid bundle');
		expect(() => furnitureBundleAsset('b-../bad', 123)).toThrow('Invalid bundle');
		expect(() => furnitureBundleAsset(id, 123.5)).toThrow('Invalid bundle');
	});
	it('fetches one packet across owners, qualities, image/native members and later additions without decoding unused members', async () => {
		const packet = bundleFixture([
			new Uint8Array([1, 2]),
			new Uint8Array([3, 4]),
			new Uint8Array([5, 6]),
			new Uint8Array([7, 8]),
		]);
		const image = `t-${'a'.repeat(16)}`;
		const later = `t-${'b'.repeat(16)}`;
		const raw = `r-${packet.resources[1]!.sha256.slice(0, 16)}`;

		const catalog = {
			bundles: packet.bundles,
			textures: {
				[image]: {
					mimeType: 'image/webp' as const,
					full: packet.resources[0]!,
					lite: packet.resources[0]!,
				},
				[later]: {
					mimeType: 'image/webp' as const,
					full: packet.resources[2]!,
					lite: packet.resources[2]!,
				},
			},
			rawResources: { [raw]: packet.resources[1]! },
		};

		let done!: (buffer: ArrayBuffer) => void;
		const fetch = vi.fn(
			() =>
				new Promise<ArrayBuffer>((resolve) => {
					done = resolve;
				}),
		);
		const decode = vi.fn(async () => new Texture());
		const first = new FurnitureResources(catalog, '/', cache, decode, fetch);
		const second = new FurnitureResources(catalog, '/', cache, decode, fetch);
		const abandoned = first.image(image, 'full');
		const expired = expect(abandoned).rejects.toThrow('lease');
		const alive = second.image(image, 'lite');
		const native = second.read({ resource: raw, byteOffset: 1, byteLength: 1 });
		await vi.waitFor(() => expect(done).toBeTypeOf('function'));
		first.dispose();
		done(packet.data.buffer);
		await expired;
		await alive;
		expect(Array.from(await native)).toEqual([4]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(decode).toHaveBeenCalledTimes(1);
		await second.image(later, 'full');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(decode).toHaveBeenCalledTimes(2);
		second.dispose();
	});

	it('retries a failed shared packet once without poisoning another member', async () => {
		const packet = bundleFixture([new Uint8Array([11]), new Uint8Array([22])]);
		const a = `r-${packet.resources[0]!.sha256.slice(0, 16)}`;
		const b = `r-${packet.resources[1]!.sha256.slice(0, 16)}`;
		const load = vi
			.fn()
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValue(packet.data.buffer);
		const owner = new FurnitureResources(
			{
				bundles: packet.bundles,
				textures: {},
				rawResources: {
					[a]: packet.resources[0]!,
					[b]: packet.resources[1]!,
				},
			},
			'/', cache, undefined,
			load,
		);
		const read = (resource: string) => owner.read({ resource, byteOffset: 0, byteLength: 1 });
		const result = await Promise.allSettled([read(a), read(b)]);
		expect(result.every((item) => item.status === 'rejected')).toBe(true);
		expect(load).toHaveBeenCalledTimes(1);
		expect(Array.from(await read(a))).toEqual([11]);
		expect(Array.from(await read(b))).toEqual([22]);
		expect(load).toHaveBeenCalledTimes(2);
		owner.dispose();
	});

	it('rejects bad member windows, valid-packet wrong-member hashes, and invalid packet headers', async () => {
		const packet = bundleFixture([new Uint8Array([91])]);
		const id = `r-${packet.resource.sha256.slice(0, 16)}`;
		const ref = { ...packet.resource };
		const owner = new FurnitureResources(
			{ bundles: packet.bundles, textures: {}, rawResources: { [id]: ref } },
			'/', cache, undefined,
			async () => packet.data.buffer,
		);
		ref.byteOffset++;
		await expect(owner.read({ resource: id, byteOffset: 0, byteLength: 1 })).rejects.toThrow('range');
		ref.byteOffset--;
		packet.data[16] = 0;
		await expect(owner.read({ resource: id, byteOffset: 0, byteLength: 1 })).rejects.toThrow('digest');
		owner.dispose();
		cache.dispose();
		cache = new FurnitureResourceCache();

		const broken = bundleFixture([new Uint8Array([92])]);
		broken.data[0] = 0;

		const key = `r-${broken.resource.sha256.slice(0, 16)}`;
		const bad = new FurnitureResources(
			{ bundles: broken.bundles, textures: {}, rawResources: { [key]: broken.resource } },
			'/', cache, undefined,
			async () => broken.data.buffer,
		);
		await expect(bad.read({ resource: key, byteOffset: 0, byteLength: 1 })).rejects.toThrow('header');
		bad.dispose();
	});
});
