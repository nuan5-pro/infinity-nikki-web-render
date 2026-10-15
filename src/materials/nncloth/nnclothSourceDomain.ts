import type { NNClothBinaryInputs } from './nnclothBinaryInputs.js';

export const NN_CLOTH_SOURCE_DOMAIN = 'ps4f9048-words34fed0-static-carrier-1';
export const NN_CLOTH_SOURCE_WORDS = '34fed0e4a0c589d58136a561a19b1029feda357e82a426a97552027833c5bc63';

export const NN_CLOTH_SOURCE_PROGRAMS = {
	body: '701b8564d1d420007f783d552f845eaeeca7274cf1605335272ccb98aa44365c',
	depth: '64adcc4a3cb149405af9705baf1fe7ea76bbff6c4503dae92a11277e6ccd5818',
	shadow: '2158466457afcb6a0d8dd62455c4911fd4d42a07d8930f4ba9caca727392ce6a',
} as const;

export interface NNClothSourceDomain {
	readonly identity: string;
	readonly resourceDescriptorSHA256: string;
	readonly sourcePath: string;
}

// Bind each reviewed material path to its resource descriptor.
const sourceDomains: Record<string, Omit<NNClothSourceDomain, 'identity'>> = {
	cf21b27749125766ff38ef43cb326c7ca5551650cf373be9946d69a394e7b0bc: {
		resourceDescriptorSHA256: 'd44382397c3b2450b4dd16600150e3501db1c48838be28e44418c29458e0d448',
		sourcePath: '/Game/Assets/Buildin/Parts/Jewelry/PABJ0004/Material/M_PABJ0004_02.M_PABJ0004_02',
	},
	'3d6add604fb2d3ac28a8955a40d32ae8b611d9c972c8eaaa6381fd5dfa3439a9': {
		resourceDescriptorSHA256: '5d7ebc3fd229f985ca3a3cbe8ae27d9d5ce71da2f7cf924bc7c2de5bed4ed7fc',
		sourcePath: '/Game/Assets/Buildin/Parts/Jewelry/PABJ0004/Different/Material/M_PABJ0004_02_1.M_PABJ0004_02_1',
	},
};

export function readNNClothSourceDomain(identity: unknown): NNClothSourceDomain | null {
	if (
		typeof identity !== 'string' ||
		!Object.prototype.hasOwnProperty.call(sourceDomains, identity)
	) return null;

	return { identity, ...sourceDomains[identity]! };
}

/** Validate native descriptors before payload hydration. */
export async function validateNNClothSourceDescriptors(
	source: NNClothBinaryInputs & { mpt: NNClothBinaryInputs['mpt'] & { sha256?: string } },
	domain: NNClothSourceDomain,
) {
	const fields = [
		'sourcePath',
		'SourcePath',
		'pixelFormat',
		'PixelFormat',
		'format',
		'width',
		'Width',
		'height',
		'Height',
		'Depth',
		'sRGB',
		'SRGB',
		'nearest',
		'Filter',
		'addressX',
		'addressY',
		'AddressX',
		'AddressY',
		'kind',
		'indexDomain',
		'sampler',
		'sourceType',
		'sourceSRGB',
	];

	const resources = {
		...source.textures,
		...source.arrays,
		lookup: source.lookup,
		noise7: source.noise[7],
		noise8: source.noise[8],
	};

	const descriptors = Object.keys(resources)
		.sort()
		.map((key) => {
			const resource = resources[key as keyof typeof resources] as unknown as Record<string, unknown>;
			const mips = resource.mips as Record<string, unknown>[];
			if (!Array.isArray(mips)) throw new Error('[NNCloth] native source descriptor mips missing');

			return [
				key,
				fields.map((field) => resource[field] ?? null),
				mips.map((mip) => [mip.width, mip.height, mip.depth ?? null, mip.bytes, mip.sha256]),
			];
		});

	const fingerprint = [
		descriptors,
		[source.mpt.sourcePath, source.mpt.width, source.mpt.height, source.mpt.sha256],
	];

	const bytes = new TextEncoder().encode(JSON.stringify(fingerprint));
	const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('');
	if (
		readNNClothSourceDomain(domain.identity)?.resourceDescriptorSHA256 !== hash ||
		domain.resourceDescriptorSHA256 !== hash
	) throw new Error('[NNCloth] source binding/header/mip identity changed');
}

export function validateNNClothSourceSelectors(rgba: Float32Array, normalDepth: number, matcapDepth: number) {
	if (
		rgba.length !== 252 ||
		normalDepth !== 2 ||
		matcapDepth !== 48 ||
		!rgba.every(Number.isFinite)
	) throw new Error('[NNCloth] reviewed MPT/array domain changed');

	for (let column = 0; column < 9; column++) {
		const value = rgba[column * 4]!;
		const floor = Math.floor(value);
		const normal = value - floor === 0.5 ? floor + (floor % 2 === 0 ? 0 : 1) : Math.round(value);
		const matcap = Math.floor(rgba[(4 * 9 + column) * 4]! + 0.5);
		if (normal < 0 || normal >= normalDepth || matcap < 0 || matcap >= matcapDepth) throw new Error('[NNCloth] native source array selector outside its actual layers');
	}
}
