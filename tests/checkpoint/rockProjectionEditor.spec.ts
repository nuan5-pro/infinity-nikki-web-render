import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SRGBColorSpace } from 'three';
import {
	bindRockProjectionCollection,
	createRockProjectionCollectionTexture,
	disposeRockProjectionCollections,
	rockProjectionBytesSHA256,
	type RockProjectionCollectionPayload,
} from '../../src/materials/layered/rockProjectionCollectionTexture.js';
import {
	FurnitureResourceCache,
	FurnitureResources,
} from '../../src/resources/resources.js';
import {
	rockProjectionEditorCore,
	validRockProjectionEditor,
	type RockProjectionEditorConfig,
} from '../../src/materials/layered/layeredRockProjectionEditorShader.js';
import { bundleFixture } from './bundleFixture';

const root = process.env.ROCK_PROJECTION_EDITOR_TEST_ROOT;
const referenceHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let cache = new FurnitureResourceCache();
afterEach(() => {
	cache.dispose();
	cache = new FurnitureResourceCache();
	vi.unstubAllGlobals();
});

describe('Rock projection synchronous SHA and typed rejection', () => {
	it('matches independently known vectors and standard implementation across padding boundaries', () => {
		expect(rockProjectionBytesSHA256(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
		expect(rockProjectionBytesSHA256(new TextEncoder().encode('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
		for (const length of [1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1024, 174776]) {
			const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 255);
			expect(rockProjectionBytesSHA256(bytes), `length=${length}`).toBe(referenceHash(bytes));
		}

		const storage = Uint8Array.from({ length: 137 }, (_, index) => index);
		const window = storage.subarray(3, 132);
		expect(rockProjectionBytesSHA256(window)).toBe(referenceHash(window));
	});

	it('keeps compiled secondary UV zero and actual draw camera in the full consumer', () => {
		const core = rockProjectionEditorCore((role, uv, bias) => `texture2D(role${role}, ${uv}${bias ? `, ${bias}` : ''})`);
		expect(core).toContain('vec2 projectionSecondaryUV = vec2(0.0)');
		expect(core).toContain('vec3 projectionCamera = furnitureNativeWorld(cameraPosition) + rockProjectionWorldOrigin;');
		expect(core).toContain('rockProjectionMipBias).rg');
		expect(core).toContain('cross(projectionN, projectionT) * vProjectionRawHandedness');
		expect(core).toContain('projectionRNMT * dot(projectionRNMT, projectionRNMU)');
	});
});

describe.skipIf(!root)('original physical collection mip source', () => {
	function fixture(mutate = false) {
		const original = JSON.parse(readFileSync(`${root}/stone08-collection/go-domain-source.json`, 'utf8')).texture;
		const chunks: Uint8Array[] = [];
		const offsets = new Map<string, number>();
		let length = 0;
		const mips = original.mips.map(
			(mip: { level: number; width: number; height: number; data: string; sha256: string }) => {
				const data = Uint8Array.from(Buffer.from(mip.data, 'base64'));
				expect(referenceHash(data)).toBe(mip.sha256);
				if (mutate && mip.level === 0) data[0] = data[0]! ^ 1;
				const digest = referenceHash(data);
				if (!offsets.has(digest)) {
					offsets.set(digest, length);
					chunks.push(data);
					length += data.length;
				}

				return {
					level: mip.level,
					width: mip.width,
					height: mip.height,
					offset: offsets.get(digest)!,
					bytes: data.length,
				};
			},
		);
		const bytes = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}

		const hash = referenceHash(bytes).slice(0, 16);
		const id = `r-${hash}`;

		const payload: RockProjectionCollectionPayload = {
			asset: original.asset,
			format: original.format,
			srgb: original.srgb,
			filter: original.filter,
			addressX: original.addressX,
			addressY: original.addressY,
			mips: mips.map((mip) => ({
				level: mip.level,
				width: mip.width,
				height: mip.height,
				native: { resource: id, byteOffset: mip.offset, byteLength: mip.bytes },
			})),
		};

		const packet = bundleFixture([bytes]);
		const fetch = vi.fn(async () => new Response(packet.data));
		vi.stubGlobal('fetch', fetch);

		const resources = new FurnitureResources({
			textures: {},
			rawResources: { [id]: packet.resource },
			bundles: packet.bundles,
		}, '/', cache);
		return { payload, resources, fetch, bytes };
	}

	function config(): RockProjectionEditorConfig {
		const source = JSON.parse(readFileSync(`${root}/stone08-collection/go-domain-source.json`, 'utf8'));
		const material = JSON.parse(readFileSync(`${root}/stone08-native-material-values.json`, 'utf8')).material;
		return {
			version: 1,
			domain: 'static-original-default-editor-preview',
			material,
			secondaryUV: 'compiled-zero',
			basis: 'native-vm-snorm8-raw-interpolated',
			viewer: source.viewer,
			collection: {
				lands: source.collection.lands,
				wetness: 0,
				transfer: 'native-srgb-srv-once',
				payload: fixture().payload,
			},
		};
	}

	it('reads the actual physical mip chain from one grouped resource and preserves the source ABI', async () => {
		const { payload: source, resources, fetch } = fixture();
		await bindRockProjectionCollection(source, resources);

		const texture = createRockProjectionCollectionTexture(source);
		expect(texture.mipmaps.length).toBe(10);
		expect(texture.colorSpace).toBe(SRGBColorSpace);
		expect(texture.generateMipmaps).toBe(false);

		const alias = structuredClone(source);
		await bindRockProjectionCollection(alias, resources);

		const second = createRockProjectionCollectionTexture(alias);
		expect(second.source).toBe(texture.source);
		expect(fetch).toHaveBeenCalledTimes(1);

		const wrongRange = structuredClone(source);
		wrongRange.mips[0]!.native.byteOffset = 174776;
		await expect(bindRockProjectionCollection(wrongRange, resources)).rejects.toThrow('range');
		source.mips[0]!.native.byteOffset += 4;
		expect(() => createRockProjectionCollectionTexture(source)).toThrow('changed');
		disposeRockProjectionCollections(resources);
		resources.dispose();
		expect(() => createRockProjectionCollectionTexture(alias)).toThrow('unavailable');
		texture.dispose();
		second.dispose();
	});

	it('rejects valid-hash files with changed physical ABI bytes and discards late owner completions', async () => {
		const changed = fixture(true);
		await expect(bindRockProjectionCollection(changed.payload, changed.resources)).rejects.toThrow('physical mip identity');
		disposeRockProjectionCollections(changed.resources);
		changed.resources.dispose();

		const pending = fixture();
		let complete!: (value: Response) => void;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						complete = resolve;
					}),
			),
		);

		const loading = bindRockProjectionCollection(pending.payload, pending.resources);
		const rejected = expect(loading).rejects.toThrow(/lease|expired/i);
		await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
		disposeRockProjectionCollections(pending.resources);
		pending.resources.dispose();
		complete(new Response(bundleFixture([pending.bytes]).data));
		await rejected;
		expect(() => createRockProjectionCollectionTexture(pending.payload)).toThrow('unavailable');
	});

	it('rejects sparse material rows and sparse lanes, never filling omitted source fields with zero', () => {
		expect(validRockProjectionEditor(config())).toBe(true);

		const sparse = config();
		delete sparse.material[28];
		expect(validRockProjectionEditor(sparse)).toBe(false);

		const lanes = config();
		const row = lanes.material[18];
		if (!row) throw new Error('missing source row');

		delete (row as number[])[1];
		expect(validRockProjectionEditor(lanes)).toBe(false);
	});
});
