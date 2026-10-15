import {
	CompressedTexture,
	LinearFilter,
	LinearMipmapLinearFilter,
	RepeatWrapping,
	RGB_S3TC_DXT1_Format,
	SRGBColorSpace,
} from 'three';
import type { FurnitureRawReference } from '../../furniture/types.js';
import type { FurnitureResourceReader } from '../../resources/resources.js';

export interface RockProjectionCollectionPayload {
	asset: string;
	format: 'PF_DXT1';
	srgb: true;
	filter: 'TF_Default';
	addressX: 'TA_Wrap';
	addressY: 'TA_Wrap';
	mips: { level: number; width: number; height: number; native: FurnitureRawReference }[];
}

// The shader uses a fixed native lookup table. Pin each physical mip separately.
const physicalMipHashes = [
	'3f3c25b6ad8810af19baf664f4bbd1f7865a2d361fbbc0968481d5e9da2f1000',
	'4d61e6ff7b04c7c01b9ad597f2a7ef4ab4c26b028c1495b3a7fb5eea30e59e47',
	'1c95f4ea0fc780b980ed9a1d950c9c07b994788d8d40f46f60a8102adb4ab10e',
	'cd0cd25271e192eebbb786eed92578aed3418d31126339037b51260c949499c4',
	'62afa6b5ed81927c2e7dfabe371565b9ed7db1f11b2252b7652f6787dae15123',
	'fa274bd66dd2b2935493ce577944aa6c662b54b46e928e1c4950d50947c8eba7',
	'4cc1e6624204609208dfb1e74ee25f09326c3cf1b5b3abe7c52a7ab39d29d7b7',
	'a81fb2a773c895f42de2cd63bd0760d83d627c03d623782cd51bd26046e330b1',
	'a81fb2a773c895f42de2cd63bd0760d83d627c03d623782cd51bd26046e330b1',
	'a81fb2a773c895f42de2cd63bd0760d83d627c03d623782cd51bd26046e330b1',
];

const shaConstants = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

// Geometry admission requires synchronous hashing. Fixed block sizes bound each index.
export function rockProjectionBytesSHA256(bytes: Uint8Array): string {
	const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
	padded.set(bytes);
	padded[bytes.length] = 0x80;

	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
	view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);

	const hash = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	]);
	const words = new Uint32Array(64);
	for (let offset = 0; offset < padded.length; offset += 64) {
		for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);

		for (let i = 16; i < 64; i++) {
			const previous15 = words[i - 15]!;
			const previous2 = words[i - 2]!;
			const low = rotate(previous15, 7) ^ rotate(previous15, 18) ^ (previous15 >>> 3);
			const high = rotate(previous2, 17) ^ rotate(previous2, 19) ^ (previous2 >>> 10);
			words[i] = words[i - 16]! + low + words[i - 7]! + high;
		}

		let [a, b, c, d, e, f, g, h] = [
			hash[0]!,
			hash[1]!,
			hash[2]!,
			hash[3]!,
			hash[4]!,
			hash[5]!,
			hash[6]!,
			hash[7]!,
		] as [number, number, number, number, number, number, number, number];

		for (let i = 0; i < 64; i++) {
			const sum =
				(h +
					(rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
					((e & f) ^ (~e & g)) +
					shaConstants[i]! +
					words[i]!) >>>
				0;
			const base = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + sum) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (sum + base) >>> 0;
		}

		for (const [i, value] of [a, b, c, d, e, f, g, h].entries()) hash[i] = hash[i]! + value;
	}

	return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}

interface CollectionContext {
	payload: RockProjectionCollectionPayload;
	identity: string;
	expired: boolean;
	texture?: CompressedTexture;
}

const contexts = new WeakMap<RockProjectionCollectionPayload, CollectionContext>();
const owners = new WeakMap<FurnitureResourceReader, Set<CollectionContext>>();

export async function bindRockProjectionCollection(payload: RockProjectionCollectionPayload, resources: FurnitureResourceReader): Promise<void> {
	if (
		!payload ||
		payload.asset !==
			'/Game/Assets/W01/W01_A01_Shared/Nature/S_Nature_Grass_14/T_Landscape_Variant_Default.T_Landscape_Variant_Default' ||
		payload.format !== 'PF_DXT1' ||
		payload.srgb !== true ||
		payload.filter !== 'TF_Default' ||
		payload.addressX !== 'TA_Wrap' ||
		payload.addressY !== 'TA_Wrap' ||
		!Array.isArray(payload.mips) ||
		payload.mips.length !== 10
	) throw new Error('[RockProjectionEditor] wrong native collection source');

	const context: CollectionContext = { payload, identity: JSON.stringify(payload), expired: false };
	const descriptor = structuredClone(payload);
	contexts.set(payload, context);

	let owned = owners.get(resources);
	if (!owned) {
		owned = new Set();
		owners.set(resources, owned);
	}

	owned.add(context);

	const texture = await resources.texture(`rock-collection:${context.identity}`, async () => {
		const mips = await Promise.all(
			descriptor.mips.map(async (mip, level) => {
				const size = Math.max(1, 512 >> level);
				const expectedBytes = Math.max(1, Math.ceil(size / 4)) ** 2 * 8;
				if (!mip.native || mip.native.byteLength !== expectedBytes) throw new Error('[RockProjectionEditor] original physical mip range changed');

				const data = await resources.read(mip.native);
				if (
					mip.level !== level ||
					mip.width !== size ||
					mip.height !== size ||
					data.length !== expectedBytes ||
					rockProjectionBytesSHA256(data) !== physicalMipHashes[level]
				) throw new Error('[RockProjectionEditor] original physical mip identity changed');

				return { data, width: size, height: size };
			}),
		);
		const texture = new CompressedTexture(mips, 512, 512, RGB_S3TC_DXT1_Format);
		texture.colorSpace = SRGBColorSpace;
		texture.wrapS = texture.wrapT = RepeatWrapping;
		texture.magFilter = LinearFilter;
		texture.minFilter = LinearMipmapLinearFilter;
		texture.generateMipmaps = false;
		texture.flipY = false;
		texture.needsUpdate = true;
		return texture;
	});
	if (context.expired || JSON.stringify(payload) !== context.identity) throw new Error('[RockProjectionEditor] collection context expired or changed during loading');

	context.texture = texture as CompressedTexture;
}

export function createRockProjectionCollectionTexture(payload: RockProjectionCollectionPayload): CompressedTexture {
	const context = contexts.get(payload);
	if (!context?.texture || context.expired || JSON.stringify(payload) !== context.identity) throw new Error('[RockProjectionEditor] native collection context unavailable or changed');

	return context.texture.clone();
}

export function disposeRockProjectionCollections(resources: FurnitureResourceReader): void {
	for (const context of owners.get(resources) ?? []) {
		context.expired = true;
		context.texture = undefined;
		if (contexts.get(context.payload) === context) contexts.delete(context.payload);
	}

	owners.delete(resources);
}
