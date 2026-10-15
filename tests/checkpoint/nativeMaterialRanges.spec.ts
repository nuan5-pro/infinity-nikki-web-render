import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTexture, HalfFloatType } from 'three';
import {
	bindFoliageCycleAtlas,
	cloneFoliageCycleAtlas,
	disposeFoliageCycleAtlases,
	type FoliageCycleAtlas,
} from '../../src/materials/foliage/foliageShader.js';
import {
	FurnitureResourceCache,
	FurnitureResources,
} from '../../src/resources/resources.js';
import { bundleFixture } from './bundleFixture';

let cache = new FurnitureResourceCache();
afterEach(() => {
	cache.dispose();
	cache = new FurnitureResourceCache();
	vi.unstubAllGlobals();
});

function fixture(bytes = new Uint8Array([0, 0, 0, 0, 0, 60, 0, 56, 0, 0, 0, 60])) {
	const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
	const id = `r-${digest}`;
	const packet = bundleFixture([bytes]);
	const fetch = vi.fn(async () => new Response(packet.data));
	vi.stubGlobal('fetch', fetch);

	const resources = new FurnitureResources({
		textures: {},
		rawResources: { [id]: packet.resource },
		bundles: packet.bundles,
	}, '/', cache);

	const atlas: FoliageCycleAtlas = {
		resource: id,
		byteOffset: 4,
		byteLength: 8,
		width: 1,
		height: 1,
		nearest: false,
		addressX: 'TA_Wrap',
		addressY: 'TA_Clamp',
	};

	return { atlas, resources, fetch };
}

describe('native cycle atlas raw ownership', () => {
	it('decodes little-endian finite RGBA16F once, sharing pixels with independent sampler clones', async () => {
		const { atlas, resources, fetch } = fixture();
		const alias = { ...atlas };
		await Promise.all([
			bindFoliageCycleAtlas(atlas, resources),
			bindFoliageCycleAtlas(alias, resources),
		]);

		const first = cloneFoliageCycleAtlas(atlas) as DataTexture;
		const second = cloneFoliageCycleAtlas(alias) as DataTexture;
		expect(first.type).toBe(HalfFloatType);
		expect(Array.from(first.image.data as Uint16Array)).toEqual([0x3c00, 0x3800, 0, 0x3c00]);
		expect(first.source).toBe(second.source);
		expect(fetch).toHaveBeenCalledTimes(1);
		first.repeat.x = 3;
		expect(second.repeat.x).toBe(1);
		first.dispose();
		second.dispose();
		atlas.byteOffset = 0;
		expect(() => cloneFoliageCycleAtlas(atlas)).toThrow('changed');
		disposeFoliageCycleAtlases(resources);
		resources.dispose();
		expect(() => cloneFoliageCycleAtlas(alias)).toThrow('unavailable');
	});

	it('rejects invalid size/nonfinite halves and cannot publish an atlas after its owner expires', async () => {
		const invalid = fixture(new Uint8Array([0, 0, 0, 0, 0, 124, 0, 0, 0, 0, 0, 0]));
		await expect(bindFoliageCycleAtlas(invalid.atlas, invalid.resources)).rejects.toThrow('Nonfinite');
		await expect(bindFoliageCycleAtlas({ ...invalid.atlas, byteLength: 4 }, invalid.resources)).rejects.toThrow('descriptor');
		disposeFoliageCycleAtlases(invalid.resources);
		invalid.resources.dispose();

		const pending = fixture();
		let complete!: (value: Response) => void;
		const bytes = new Uint8Array([0, 0, 0, 0, 0, 60, 0, 56, 0, 0, 0, 60]);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						complete = resolve;
					}),
			),
		);

		const loading = bindFoliageCycleAtlas(pending.atlas, pending.resources);
		const rejected = expect(loading).rejects.toThrow(/lease|expired/i);
		await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
		disposeFoliageCycleAtlases(pending.resources);
		pending.resources.dispose();
		complete(new Response(bundleFixture([bytes]).data));
		await rejected;
		expect(() => cloneFoliageCycleAtlas(pending.atlas)).toThrow('unavailable');
	});
});
