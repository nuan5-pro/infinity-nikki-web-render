import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataArrayTexture, DataTexture } from 'three';
import { FurnitureResourceCache, FurnitureResources } from '../src/resources/resources.js';
import type { FurnitureTextureResource } from '../src/furniture/types.js';
import { bundleFixture } from './checkpoint/bundleFixture';

const owners: FurnitureResources[] = [];
let cache: FurnitureResourceCache;

beforeEach(() => {
	cache = new FurnitureResourceCache();
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

	const owner = new FurnitureResources({ textures, rawResources: {}, bundles: bundle.bundles }, '/', cache, undefined, fetch);
	owners.push(owner);

	return { owner, decode, fetch, textures };
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
