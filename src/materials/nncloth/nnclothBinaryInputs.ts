import {
	nativePayloadSHA256,
	readNNClothResource,
	type NNClothResourceReader,
	type NNClothResourceReference,
} from './nnclothBinary.js';
import { createNNClothNativeTexture, type NNClothNativeTexture } from './nnclothTexture.js';
import { createNNClothNativeArray, type NNClothNativeArray } from './nnclothArrays.js';
import { createNNClothLookup, type NNClothLookup } from './nnclothLookup.js';
import { createNNClothCoverageNoise, type NNClothCoverageNoise } from './nnclothCoverageNoise.js';
import { createNNClothMPT, type NNClothMPT } from './nnclothInputs.js';
import type { Texture } from 'three';
import { createNNClothSourceArray } from './nnclothSourceArray.js';
import {
	validateNNClothSourceDescriptors,
	validateNNClothSourceSelectors,
	type NNClothSourceDomain,
} from './nnclothSourceDomain.js';
import type { NNClothRendererLease } from './nnclothRendererContext.js';

type BinaryMips<T extends { mips: object[] }> = Omit<T, 'mips'> & {
	mips: (Omit<T['mips'][number], 'data' | 'bytes' | 'sha256'> & NNClothResourceReference)[]
};

export interface NNClothBinaryInputs {
	transport: 'nncloth-original-buffer-views-1'
	textures: Record<string, BinaryMips<NNClothNativeTexture>>
	arrays: {
		Fabric_NArray: BinaryMips<NNClothNativeArray>
		Matcap_TArray: BinaryMips<NNClothNativeArray>
	}
	lookup: BinaryMips<NNClothLookup>
	noise: { 7: BinaryMips<NNClothCoverageNoise>; 8: BinaryMips<NNClothCoverageNoise> }
	mpt: Omit<NNClothMPT, 'rgba' | 'sha256'> & NNClothResourceReference
}

async function hydrateMips<T extends { mips: NNClothResourceReference[] }>(resources: NNClothResourceReader, source: T) {
	return {
		...source,
		mips: await Promise.all(
			source.mips.map(async (mip: T['mips'][number]) => {
				const data = await readNNClothResource(resources, mip);
				return { ...mip, data, bytes: data.byteLength, sha256: await nativePayloadSHA256(data) };
			}),
		),
	};
}

function textureKey(kind: string, descriptor: object, generation = 0): string {
	const {
		sourcePath: _alias,
		SourcePath: _arrayAlias,
		...storage
	} = descriptor as Record<string, unknown>;
	return `nn-${kind}:${JSON.stringify(storage)}:${generation}`;
}

/** The production transport boundary verifies original bytes before handing
 * them to the same typed texture consumers exercised by the source probes.
 * No PNG fallback or generated mips are available on this path.
 */
export async function createNNClothBinaryInputs(
	resources: NNClothResourceReader,
	source: NNClothBinaryInputs,
	options?: { domain: NNClothSourceDomain; lease: NNClothRendererLease },
) {
	if (source.transport !== 'nncloth-original-buffer-views-1') throw new Error('[NNCloth] original binary transport version missing');

	const textures: Record<string, Texture> = {};
	try {
		options?.lease.assertCurrent();

		const hydrated = {
			...source,
			textures: Object.fromEntries(
				await Promise.all(
					Object.entries(source.textures).map(async ([key, value]) => [
						key,
						await hydrateMips(resources, value),
					]),
				),
			),
			arrays: {
				Fabric_NArray: await hydrateMips(resources, source.arrays.Fabric_NArray),
				Matcap_TArray: await hydrateMips(resources, source.arrays.Matcap_TArray),
			},
			lookup: await hydrateMips(resources, source.lookup),
			noise: {
				7: await hydrateMips(resources, source.noise[7]),
				8: await hydrateMips(resources, source.noise[8]),
			},
			mpt: {
				...source.mpt,
				sha256: await nativePayloadSHA256(await readNNClothResource(resources, source.mpt)),
			},
		};

		if (options) await validateNNClothSourceDescriptors(hydrated, options.domain);
		const expected = ['t3', 't5', 't6', 't7', 't12', 't13', 't14', 't15'];
		if (Object.keys(source.textures).sort().join(',') !== expected.sort().join(',')) throw new Error('[NNCloth] active native binary resource set changed');

		for (const [resource, descriptor] of Object.entries(source.textures)) {
			const native = hydrated.textures[resource]!;
			options?.lease.assertCurrent();

			const key = textureKey('2d', descriptor, options?.lease.generation);
			textures[resource] = (
				await resources.texture(key, async () => createNNClothNativeTexture(native, 'view-wrap', options?.lease.gl))
			).clone();
			textures[resource]!.name = descriptor.sourcePath;
		}

		for (const [resource, parameter] of [
			['t17', 'Fabric_NArray'],
			['t18', 'Matcap_TArray'],
		] as const) {
			const native = hydrated.arrays[parameter];
			options?.lease.assertCurrent();

			const key = textureKey('array', source.arrays[parameter], options?.lease.generation);
			textures[resource] = (
				await resources.texture(key, async () =>
					options
						? createNNClothSourceArray(native, parameter, options.lease.gl)
						: createNNClothNativeArray(native, parameter),
				)
			).clone();
			textures[resource]!.name = source.arrays[parameter].SourcePath;
		}

		textures.t11 = (
			await resources.texture(textureKey('lookup', source.lookup), async () => createNNClothLookup(hydrated.lookup))
		).clone();
		textures.noise7 = (
			await resources.texture(textureKey('noise', source.noise[7]), async () => createNNClothCoverageNoise(hydrated.noise[7]))
		).clone();
		textures.noise8 = (
			await resources.texture(textureKey('noise', source.noise[8]), async () => createNNClothCoverageNoise(hydrated.noise[8]))
		).clone();

		const mpt = await readNNClothResource(resources, source.mpt);
		if (mpt.byteLength !== 1008) throw new Error('[NNCloth] original HDR MPT binary shape changed');

		const view = new DataView(mpt.buffer, mpt.byteOffset, mpt.byteLength);
		const rgba = new Float32Array(252);
		for (let index = 0; index < rgba.length; index++) rgba[index] = view.getFloat32(index * 4, true);

		options?.lease.assertCurrent();
		if (options)
			validateNNClothSourceSelectors(rgba, source.arrays.Fabric_NArray.Depth, source.arrays.Matcap_TArray.Depth);

		textures.t4 = (
			await resources.texture(textureKey('mpt', source.mpt), async () => createNNClothMPT({ ...hydrated.mpt, rgba }))
		).clone();

		const fabricNormal = textures.t17;
		if (!fabricNormal || fabricNormal.name !== source.arrays.Fabric_NArray.SourcePath) throw new Error('[NNCloth] Fabric_NArray t17 source role missing or mismatched');

		textures.t17Far = fabricNormal.clone();
		textures.noise7Shared = textures.noise7.clone();
		options?.lease.assertCurrent();
		return textures;
	} catch (error) {
		for (const texture of Object.values(textures)) texture.dispose();

		throw error;
	}
}
