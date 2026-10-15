import type { Material, Texture } from 'three';
import type { FurnitureResourceReader } from '../../resources/resources.js';
import { createNNClothBinaryInputs, type NNClothBinaryInputs } from './nnclothBinaryInputs.js';
import {
	nativePayloadSHA256,
	readNNClothResource,
	type NNClothResourceReference,
} from './nnclothBinary.js';
import { createNNClothCompiledMaterial } from './nnclothCompiledMaterial.js';
import { createNNClothGeometryABI } from './nnclothGeometryABI.js';
import { createNNClothShadowMaterial } from './nnclothShadowMaterial.js';
import { NN_CLOTH_PROGRAM_SHA256 } from './nnclothProgramIdentity.js';
import {
	NN_CLOTH_SOURCE_DOMAIN,
	NN_CLOTH_SOURCE_PROGRAMS,
	NN_CLOTH_SOURCE_WORDS,
	readNNClothSourceDomain,
	type NNClothSourceDomain,
} from './nnclothSourceDomain.js';
import { requireNNClothRendererLease, type NNClothRendererLease } from './nnclothRendererContext.js';
import { assertNNClothReviewedGeometry } from './nnclothSourceGeometry.js';

interface NNClothProfile {
	family: 'nncloth-native-v7'
	version: 1
	requiredUV: number[]
	shaderUVMap: number[]
	specialization: {
		domain: string
		materialWordsSHA256: string
		sourceIdentity?: string
		sourceLocalVS?: string
		baseBodyPS?: string
		depthPS?: string
		shadowPS?: string
	}
	programs: Record<'body' | 'depth' | 'shadow', NNClothResourceReference>
	materialWords: NNClothResourceReference
	binaryInputs: NNClothBinaryInputs
	collections: {
		domain: 'native-authored-defaults-static-preview-not-live'
		tod: NNClothResourceReference
		weather: NNClothResourceReference
	}
}

interface NNClothResources {
	textures: Record<string, Texture>
	programs: Record<'body' | 'depth' | 'shadow', string>
	words: Record<string, number>
	collections: {
		domain: 'native-authored-defaults-static-preview-not-live'
		tod: [number, number, number, number][]
		weather: [number, number, number, number][]
	}
}

interface NNClothRequest {
	lease: NNClothRendererLease
	active: boolean
	resources?: NNClothResources
	loading: Promise<NNClothResources>
	cancel(): void
}

interface NNClothContext {
	reader: FurnitureResourceReader
	disposed: boolean
	resources?: NNClothResources
	loading?: Promise<NNClothResources>
	requests: Map<NNClothRendererLease, NNClothRequest>
}

const contexts = new WeakMap<object, NNClothContext>();
const assetContexts = new WeakMap<FurnitureResourceReader, Set<NNClothContext>>();
const shadowMaterials = new WeakMap<Material, Material>();

export function getNNClothShadowMaterial(material: Material) {
	return shadowMaterials.get(material);
}

export function readFurnitureNNCloth(value: unknown): NNClothProfile | null {
	if (!value || typeof value !== 'object') return null;

	const profile = value as NNClothProfile;
	if (
		profile.family !== 'nncloth-native-v7' ||
		profile.version !== 1 ||
		profile.requiredUV?.join(',') !== '0,1,2' ||
		profile.shaderUVMap?.join(',') !== '0,1,2,2' ||
		profile.collections?.domain !== 'native-authored-defaults-static-preview-not-live'
	) return null;

	for (const key of ['body', 'depth', 'shadow'] as const)
		if (!profile.programs?.[key]?.resource) return null;

	const specialization = profile.specialization;
	switch (specialization?.domain) {
	case NN_CLOTH_SOURCE_DOMAIN:
		if (
			!readNNClothSourceDomain(specialization.sourceIdentity) ||
			specialization.materialWordsSHA256 !== NN_CLOTH_SOURCE_WORDS ||
			specialization.sourceLocalVS !== 'af2ca7d3f7ae9869ed35ddd1a633b0a5e8e8e371' ||
			specialization.baseBodyPS !== '4f9048bf28caea97b67e19873500be1945b2f3c0' ||
			specialization.depthPS !== '760993f8df605d2bf10ca7033b96a164a2b0f912' ||
			specialization.shadowPS !== 'ccec016086b33f6dca8e84e5732b43fd408642d4'
		) return null;

		return profile;
	case 'pabj0001-01-native-material-zero-domain-1':
		if (
			specialization.materialWordsSHA256 !== '33b619fb59e4f5155f0a4080dd22b3e7d9e59fd8b6a85e2ed0dc960854df3837' ||
			!profile.materialWords?.resource
		) return null;

		return profile;
	default:
		return null;
	}
}

export function assertNNClothMaterialAdmission(material: Material) {
	const sourceBinding = material.userData.nnclothSourceGeometry?.sourceBinding;
	if (!material.userData.nncloth) {
		if (sourceBinding !== undefined) throw new Error('[NNCloth] reviewed geometry has no admitted material profile');

		return;
	}

	const profile = readFurnitureNNCloth(material.userData.nncloth);
	if (!profile) throw new Error('[NNCloth] complete native geometry admission required');

	if (profile.specialization.domain === NN_CLOTH_SOURCE_DOMAIN) {
		assertNNClothReviewedGeometry(material.userData.nnclothSourceGeometry, profile.specialization.sourceIdentity);
	} else if (sourceBinding !== undefined) throw new Error('[NNCloth] reviewed geometry requires a matching material domain');
}

/** Resource ownership is independent of the model's original stream admission. */
export function bindNNClothResources(material: Material, reader: FurnitureResourceReader) {
	if (!material.userData.nncloth) return;

	const profile = readFurnitureNNCloth(material.userData.nncloth);
	if (!profile) throw new Error('[NNCloth] complete native binary resource profile required');

	const previous = contexts.get(profile);
	if (previous && !previous.disposed) {
		if (previous.reader !== reader) throw new Error('[NNCloth] material profile has ambiguous resource ownership');

		return;
	}

	const context: NNClothContext = { reader, disposed: false, requests: new Map() };
	contexts.set(profile, context);

	let owned = assetContexts.get(reader);
	if (!owned) {
		owned = new Set();
		assetContexts.set(reader, owned);
	}

	owned.add(context);
}

export function disposeNNClothResources(reader: FurnitureResourceReader) {
	for (const context of assetContexts.get(reader) ?? []) {
		context.disposed = true;
		for (const request of [...context.requests.values()]) request.cancel();

		for (const texture of Object.values(context.resources?.textures ?? {})) texture.dispose();
	}

	assetContexts.delete(reader);
}

async function loadNNClothResources(
	profile: NNClothProfile,
	context: NNClothContext,
	options?: { domain: NNClothSourceDomain; lease: NNClothRendererLease },
): Promise<NNClothResources> {
	options?.lease.assertCurrent();
	if (context.disposed) throw new Error('[NNCloth] source asset disposed before resource loading');

	const reader = context.reader;
	const expectedPrograms =
		profile.specialization.domain === NN_CLOTH_SOURCE_DOMAIN
			? NN_CLOTH_SOURCE_PROGRAMS
			: NN_CLOTH_PROGRAM_SHA256;
	const programs = {} as NNClothResources['programs'];
	for (const key of ['body', 'depth', 'shadow'] as const) {
		const data = await readNNClothResource(reader, profile.programs[key]);
		if ((await nativePayloadSHA256(data)) !== expectedPrograms[key]) throw new Error('[NNCloth] Native program identity changed');

		programs[key] = new TextDecoder('utf-8', { fatal: true }).decode(data);
	}

	const raw = await readNNClothResource(reader, profile.materialWords);
	const words: Record<string, number> = {};
	if ((await nativePayloadSHA256(raw)) !== profile.specialization.materialWordsSHA256) throw new Error('[NNCloth] Native material words changed');
	if (raw.byteLength !== 290 * 8) throw new Error('[NNCloth] original material-word domain length changed');

	const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	let previous = -1;
	for (let offset = 0; offset < raw.byteLength; offset += 8) {
		const index = view.getUint32(offset, true);
		const value = view.getFloat32(offset + 4, true);
		if (index <= previous || !Number.isFinite(value)) throw new Error('[NNCloth] original material-word domain invalid');

		words[index] = value;
		previous = index;
	}

	const collection = async (key: 'tod' | 'weather', rows: number) => {
		const data = await readNNClothResource(reader, profile.collections[key]);
		if (data.byteLength !== rows * 16) throw new Error('[NNCloth] original collection shape changed');

		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const values = Array.from(
			{ length: rows },
			(_, row) =>
				[0, 1, 2, 3].map((lane) => view.getFloat32(row * 16 + lane * 4, true)) as [
					number,
					number,
					number,
					number,
				],
		);
		if (values.some((row) => row.some((value) => !Number.isFinite(value)))) throw new Error('[NNCloth] original collection contains nonfinite words');

		return values;
	};

	const collections = {
		domain: profile.collections.domain,
		tod: await collection('tod', 31),
		weather: await collection('weather', 40),
	};

	options?.lease.assertCurrent();

	const textures = await createNNClothBinaryInputs(reader, profile.binaryInputs, options);
	try {
		options?.lease.assertCurrent();
		if (context.disposed) throw new Error('[NNCloth] source asset disposed during native resource loading');
	} catch (error) {
		for (const texture of Object.values(textures)) texture.dispose();

		throw error;
	}

	const resources = { textures, programs, words, collections };
	if (!options) context.resources = resources;
	return resources;
}

function sourceRequest(profile: NNClothProfile, context: NNClothContext, domain: NNClothSourceDomain) {
	const lease = requireNNClothRendererLease(context.reader.renderer);
	const previous = context.requests.get(lease);
	if (previous?.active) return previous;

	let unsubscribe = () => {};

	const request: NNClothRequest = {
		lease,
		active: true,
		loading: Promise.resolve()
			.then(() => loadNNClothResources(profile, context, { domain, lease }))
			.then((resources) => {
				if (!request.active || context.disposed || context.requests.get(lease) !== request) {
					for (const texture of Object.values(resources.textures)) texture.dispose();

					throw new Error('[NNCloth] canceled native resource request');
				}

				request.resources = resources;
				return resources;
			})
			.catch((error) => {
				request.cancel();
				throw error;
			}),

		cancel() {
			if (!request.active) return;

			request.active = false;
			unsubscribe();
			if (context.requests.get(lease) === request) context.requests.delete(lease);
			for (const texture of Object.values(request.resources?.textures ?? {})) texture.dispose();

			request.resources = undefined;
		},
	};

	unsubscribe = lease.onInvalidate(request.cancel);
	context.requests.set(lease, request);
	return request;
}

export async function createNNClothMaterial(source: Material) {
	assertNNClothMaterialAdmission(source);

	const profile = readFurnitureNNCloth(source.userData.nncloth);
	if (!profile) throw new Error('[NNCloth] source material contract invalid');

	const context = contexts.get(profile);
	if (!context || context.disposed) throw new Error('[NNCloth] native resource context missing');

	const domain = readNNClothSourceDomain(profile.specialization.sourceIdentity);
	const request = domain ? sourceRequest(profile, context, domain) : undefined;
	let created: Material | undefined;
	try {
		const resources = await (request
			? request.loading
			: (context.loading ??= loadNNClothResources(profile, context).catch((error) => {
				context.loading = undefined;
				throw error;
			})));
		if (context.disposed) throw new Error('[NNCloth] source asset disposed before material creation');

		if (request) {
			request.lease.assertCurrent();
			if (!request.active) throw new Error('[NNCloth] resource request expired before material creation');
		}

		const component = {
			domain: 'tracked-preview-component-custom-data' as const,
			customPrimitiveData: [] as number[],
		};

		const abi = () => createNNClothGeometryABI(resources.collections, resources.words, undefined, component);

		const cacheDomain = `${profile.specialization.domain}:${profile.specialization.materialWordsSHA256}${domain ? ':' + domain.identity : ''}:static-preview-no-vlm-df-contact-unjittered-empty-custom-data`;
		const programHashes = domain ? NN_CLOTH_SOURCE_PROGRAMS : NN_CLOTH_PROGRAM_SHA256;
		const material = createNNClothCompiledMaterial(
			{
				body: resources.programs.body,
				depthCoverage: resources.programs.depth,
				bodySHA256: programHashes.body,
				depthSHA256: programHashes.depth,
				cacheDomain,
			},
			resources.textures,
			abi(),
			source,
		);
		created = material;

		const shadow = createNNClothShadowMaterial(
			resources.programs.shadow,
			programHashes.shadow,
			cacheDomain,
			resources.textures,
			abi(),
			source,
		);
		if (request)
			for (const target of [material, shadow]) {
				const before = target.onBeforeRender;
				target.onBeforeRender = (...args) => {
					request.lease.assertCurrent(args[0]);
					if (!request.active || context.disposed) throw new Error('[NNCloth] disposed native resources reached a draw');

					before.call(target, ...args);
				};
			}

		shadowMaterials.set(material, shadow);

		const dispose = material.dispose.bind(material);
		material.dispose = () => {
			shadow.dispose();
			shadowMaterials.delete(material);
			dispose();
		};
		return material;
	} catch (error) {
		created?.dispose();
		request?.cancel();
		throw error;
	}
}
