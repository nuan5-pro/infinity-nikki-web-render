import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataArrayTexture } from 'three';
import { FurnitureResourceCache, FurnitureResources } from '../src/resources/resources.js';
import type { PaperArray } from '../src/materials/textureInputs.js';
import { bundleFixture } from './checkpoint/bundleFixture';

const owners: FurnitureResources[] = [];
const cache = new FurnitureResourceCache();

afterEach(() => {
	for (const owner of owners) owner.dispose();

	owners.length = 0;
	cache.clearUnused();
});

function paperArray(bytes: Uint8Array) {
	const compressed = new Uint8Array(deflateSync(bytes));
	const bundle = bundleFixture([compressed]);
	const resource = `r-${bundle.resource.sha256.slice(0, 16)}`;
	const fetch = vi.fn(async () => bundle.data.buffer);
	const owner = new FurnitureResources({
		textures: {},
		rawResources: { [resource]: bundle.resource },
		bundles: bundle.bundles,
	}, '/', cache, undefined, fetch);
	owners.push(owner);

	const reference: PaperArray = {
		resource,
		byteOffset: 0,
		byteLength: compressed.length,
		width: 1,
		height: 1,
		depth: 2,
		encoding: 'rgba8-deflate',
	};

	return { owner, reference, fetch };
}

describe('producer-prepared native paper arrays', () => {
	it('inflates the complete RGBA layer order once and releases its owned texture', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 11, 12, 13, 14]);
		const { owner, reference, fetch } = paperArray(bytes);
		const texture = await owner.paperArray(reference) as DataArrayTexture;
		expect(texture).toBeInstanceOf(DataArrayTexture);
		expect(texture.image).toMatchObject({ width: 1, height: 1, depth: 2, data: bytes });
		expect(texture.flipY).toBe(false);
		expect(await owner.paperArray({ ...reference })).toBe(texture);
		expect(fetch).toHaveBeenCalledTimes(1);

		const disposed = vi.fn();
		texture.addEventListener('dispose', disposed);
		owner.dispose();
		expect(disposed).toHaveBeenCalledTimes(1);
	});

	it('rejects both truncated and oversized decoded arrays even when transport hashes are valid', async () => {
		for (const length of [7, 9]) {
			const { owner, reference } = paperArray(new Uint8Array(length));
			await expect(owner.paperArray(reference)).rejects.toThrow(length < 8 ? 'decoded length mismatch' : 'decoded length overflow');
		}
	});

	it('rejects invalid allocation sizes before fetching any payload', async () => {
		const { owner, reference, fetch } = paperArray(new Uint8Array(8));
		for (const dimensions of [{ width: 0 }, { depth: 1.5 }, { width: 2 ** 30 }]) {
			await expect(owner.paperArray({ ...reference, ...dimensions })).rejects.toThrow('dimensions or encoding');
		}

		expect(fetch).not.toHaveBeenCalled();
	});
});
