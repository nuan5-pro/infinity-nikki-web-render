import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompressedTexture, CompressedCubeTexture } from 'three';
import type { FurniturePackedResource, FurnitureRawReference } from '../../src/furniture/types.js';
import { bundleFixture } from './bundleFixture';
import {
	FurnitureResourceCache,
	FurnitureResources,
} from '../../src/resources/resources.js';
import {
	assertJewelryMaskedTextureBinding,
	createJewelryMaskedNativeTexture,
	type JewelryMaskedNativeResource,
} from '../../src/materials/jewel/jewelryMaskedResources.js';

let cache = new FurnitureResourceCache();
afterEach(() => {
	cache.dispose();
	cache = new FurnitureResourceCache();
	vi.unstubAllGlobals();
});

function resourceOwner(files: Uint8Array[]) {
	const packet = bundleFixture(files);
	const rawResources: Record<string, FurniturePackedResource> = {};
	const byPath = new Map<string, Uint8Array>([[packet.asset.path, packet.data]]);
	const refs = files.map((bytes, i) => {
		const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
		rawResources[`r-${digest}`] = packet.resources[i]!;
		return { resource: `r-${digest}`, byteOffset: 0, byteLength: bytes.byteLength };
	});
	const fetch = vi.fn(async (url: string) => {
		const path = decodeURIComponent(url.split('/assets/furniture-v2/')[1]!);
		const data = byPath.get(path);
		if (!data) return new Response(null, { status: 404 });

		return new Response(Uint8Array.from(data));
	});
	vi.stubGlobal('fetch', fetch);
	return {
		owner: new FurnitureResources({ textures: {}, rawResources, bundles: packet.bundles }, '/assets/furniture-v2/', cache),
		refs,
		fetch,
		byPath,
	};
}

function fixture() {
	// One grouped file: package bytes, two original BC1 mips, and two RGBA reference leaves.
	const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);
	const result = resourceOwner([bytes]);
	const id = result.refs[0]!.resource;

	const range = (byteOffset: number, byteLength: number): FurnitureRawReference => ({
		resource: id,
		byteOffset,
		byteLength,
	});

	const resource: JewelryMaskedNativeResource = {
		sourcePath: '/Game/Native/Texture.Texture',
		type: 'Texture2D',
		pixelFormat: 'PF_DXT1',
		sRGB: false,
		filter: 'TF_Default',
		nearest: false,
		addressX: 'TA_Clamp',
		addressY: 'TA_Clamp',
		width: 4,
		height: 4,
		slices: 1,
		mips: 2,
		completeNativeMips: true,
		firstAvailableMip: 0,
		package: range(0, 4),
		mipChain: [
			{
				index: 0,
				available: true,
				width: 4,
				height: 4,
				native: range(4, 8),
				decoded: range(20, 64),
				transport: 'native2d-rgba8',
			},
			{
				index: 1,
				available: true,
				width: 2,
				height: 2,
				native: range(12, 8),
				decoded: range(84, 16),
				transport: 'native2d-rgba8',
			},
		],
	};

	return { ...result, resource };
}

describe('Masked current typed resource transport', () => {
	it('reads one verified grouped file for all leaves and keeps independent source samplers', async () => {
		const { owner, resource, fetch } = fixture();
		const header = await createJewelryMaskedNativeTexture(resource, owner);
		const wrap = await createJewelryMaskedNativeTexture(resource, owner, 'native-compressed', 'repeat');
		expect(header).toBeInstanceOf(CompressedTexture);
		expect(header).not.toBe(wrap);
		expect(header.wrapS).not.toBe(wrap.wrapS);
		expect(header.mipmaps).toHaveLength(2);
		expect(header.mipmaps[0]!.data).toBeInstanceOf(Uint8Array);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(() => assertJewelryMaskedTextureBinding(header, resource, 'source')).not.toThrow();
		expect(() => assertJewelryMaskedTextureBinding(wrap, resource, 'repeat')).not.toThrow();
		expect(() => assertJewelryMaskedTextureBinding(wrap, resource, 'source')).toThrow('sampler state');
		expect(() => assertJewelryMaskedTextureBinding(header.clone(), resource, 'source')).toThrow('verified');

		const decoded = await createJewelryMaskedNativeTexture(resource, owner, 'decoded-reference');
		expect(() => assertJewelryMaskedTextureBinding(decoded, resource, 'source')).toThrow('verified');
		header.dispose();
		wrap.dispose();
		decoded.dispose();
		owner.dispose();
	});

	it('rejects invalid ranges, descriptor/range mutation and altered actual immutable bytes', async () => {
		const { owner, resource } = fixture();
		const texture = await createJewelryMaskedNativeTexture(resource, owner);
		resource.mipChain[0]!.native.byteOffset++;
		expect(() => assertJewelryMaskedTextureBinding(texture, resource, 'source')).toThrow('verified');
		resource.mipChain[0]!.native.byteOffset--;
		resource.addressX = 'TA_Wrap';
		expect(() => assertJewelryMaskedTextureBinding(texture, resource, 'source')).toThrow('verified');
		resource.addressX = 'TA_Clamp';
		expect(() => assertJewelryMaskedTextureBinding(texture, structuredClone(resource), 'source')).toThrow('verified');

		const invalid = structuredClone(resource);
		invalid.mipChain[0]!.native.byteOffset = 100;
		await expect(createJewelryMaskedNativeTexture(invalid, owner)).rejects.toThrow('range');
		texture.dispose();
		owner.dispose();
		cache.dispose();
		cache = new FurnitureResourceCache();

		const changed = fixture();
		for (const bytes of changed.byPath.values()) bytes[0] = bytes[0]! ^ 1;

		await expect(createJewelryMaskedNativeTexture(changed.resource, changed.owner)).rejects.toThrow('digest');
		changed.owner.dispose();
	});
});

// Research-format decoding exists only in this optional fixture adapter. Production
// consumes the same external resource/range shape as every other native material.
function actualFixture(root: string) {
	const source = JSON.parse(readFileSync(join(root, 'masked-native-texture-mips-r2.json'), 'utf8'));
	const files: Uint8Array[] = [];
	const blobs = new Map<string, number>();

	const convert = (value: unknown): unknown => {
		if (!value || typeof value !== 'object') return value;
		if (Array.isArray(value)) return value.map(convert);

		const record = value as Record<string, unknown>;
		if (
			typeof record.file === 'string' &&
			typeof record.bytes === 'number' &&
			typeof record.sha256 === 'string'
		) {
			const data = Uint8Array.from(readFileSync(join(root, record.file)));
			expect(data.byteLength).toBe(record.bytes);

			const digest = createHash('sha256').update(data).digest('hex');
			expect(digest).toBe(record.sha256);
			if (!blobs.has(digest)) {
				blobs.set(digest, files.length);
				files.push(data);
			}

			const { file: _file, bytes: _bytes, sha256: _sha, ...metadata } = record;
			return {
				...metadata,
				resource: `r-${digest.slice(0, 16)}`,
				byteOffset: 0,
				byteLength: data.byteLength,
			};
		}

		return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, convert(item)]));
	};

	const resources = convert(source.resources) as JewelryMaskedNativeResource[];
	return { ...resourceOwner(files), resources };
}

const root = process.env.JEWELRY_MASKED_EVIDENCE;
describe.skipIf(!root)('actual Masked native compressed resources', () => {
	it('preserves every actual original compressed 2D mip and cube without regenerated levels', async () => {
		const { owner, resources } = actualFixture(root!);
		for (const resource of resources) {
			const texture = await createJewelryMaskedNativeTexture(resource, owner);
			expect(texture.generateMipmaps).toBe(false);
			if (resource.type === 'Texture2D') {
				expect(texture).toBeInstanceOf(CompressedTexture);
				expect(texture.mipmaps).toHaveLength(resource.mips);
				for (const [index, mip] of resource.mipChain.entries()) {
					expect(Buffer.from(texture.mipmaps[index]!.data as Uint8Array)).toEqual(Buffer.from(await owner.read(mip.native)));
				}
			} else expect(texture).toBeInstanceOf(CompressedCubeTexture);

			expect(() => assertJewelryMaskedTextureBinding(texture, resource, 'source')).not.toThrow();
			texture.dispose();
		}

		owner.dispose();
	});
});
