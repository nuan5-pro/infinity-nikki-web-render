import {
	ClampToEdgeWrapping,
	CompressedCubeTexture,
	CompressedTexture,
	CubeTexture,
	DataTexture,
	FloatType,
	LinearFilter,
	LinearMipmapLinearFilter,
	MirroredRepeatWrapping,
	NoColorSpace,
	RepeatWrapping,
	RGBAFormat,
	RGB_BPTC_UNSIGNED_Format,
	RGBA_S3TC_DXT1_Format,
	RGBA_S3TC_DXT5_Format,
	RED_GREEN_RGTC2_Format,
	SRGBColorSpace,
	UnsignedByteType,
	type Texture,
	type WebGLRenderer,
} from 'three';
import type { FurnitureRawReference } from '../../furniture/types.js';
import type { FurnitureResourceReader } from '../../resources/resources.js';
import { nativePayloadSHA256 } from '../nncloth/nnclothBinary.js';

export interface JewelryMaskedNativeMip {
	index: number
	available: boolean
	width: number
	height: number
	native: FurnitureRawReference
	decoded?: FurnitureRawReference
	transport: 'native2d-rgba8' | 'native-cube-rgba8' | 'native-cube-rgba32f'
	cubeFaces?: FurnitureRawReference & {
		width: number
		height: number
		slices: number
		laneOrder: string
		faceOrder: string[]
	}
}

export interface JewelryMaskedNativeResource {
	sourcePath: string
	type: 'Texture2D' | 'TextureCube'
	pixelFormat: 'PF_DXT1' | 'PF_DXT5' | 'PF_BC5' | 'PF_BC6H'
	sRGB: boolean
	filter: string
	nearest: boolean
	addressX: string
	addressY: string
	width: number
	height: number
	slices: number
	mips: number
	completeNativeMips: boolean
	firstAvailableMip: number
	package: FurnitureRawReference
	mipChain: JewelryMaskedNativeMip[]
	error?: string
}

const address = (value: string) => {
	switch (value) {
	case 'TA_Wrap':
		return RepeatWrapping;
	case 'TA_Clamp':
		return ClampToEdgeWrapping;
	case 'TA_Mirror':
		return MirroredRepeatWrapping;
	default:
		throw new Error('[JewelryMasked] unproved native texture addressing');
	}
};

interface ResourceSeal {
	identity: string
	payloadDigests: string
}

const verifiedTextures = new WeakMap<
	Texture,
	ResourceSeal & { resource: JewelryMaskedNativeResource; storage: string; addressDomain: string }
>();
const verifiedResources = new WeakMap<JewelryMaskedNativeResource, ResourceSeal>();

const resourceIdentity = (resource: JewelryMaskedNativeResource) =>
	JSON.stringify([
		resource.sourcePath,
		resource.type,
		resource.pixelFormat,
		resource.sRGB,
		resource.width,
		resource.height,
		resource.slices,
		resource.mips,
		resource.completeNativeMips,
		resource.firstAvailableMip,
		resource.package,
		resource.addressX,
		resource.addressY,
		resource.filter,
		resource.nearest,
		resource.mipChain,
	]);

const validReference = (value: FurnitureRawReference | undefined): value is FurnitureRawReference =>
	!!value &&
	/^r-[a-f0-9]{16}$/.test(value.resource) &&
	Number.isSafeInteger(value.byteOffset) &&
	value.byteOffset >= 0 &&
	Number.isSafeInteger(value.byteLength) &&
	value.byteLength > 0 &&
	value.byteLength <= 64 * 1024 * 1024;

export function assertJewelryMaskedNativeResource(resource: JewelryMaskedNativeResource): void {
	if (
		!resource ||
		typeof resource !== 'object' ||
		!Array.isArray(resource.mipChain) ||
		!resource.package
	) throw new Error('[JewelryMasked] native resource/header missing');

	const cube = resource.type === 'TextureCube';
	const blockBytes = resource.pixelFormat === 'PF_DXT1' ? 8 : 16;
	if (
		!['Texture2D', 'TextureCube'].includes(resource.type) ||
		!['PF_DXT1', 'PF_DXT5', 'PF_BC5', 'PF_BC6H'].includes(resource.pixelFormat) ||
		!resource.sourcePath ||
		resource.error ||
		!resource.completeNativeMips ||
		resource.firstAvailableMip !== 0 ||
		typeof resource.sRGB !== 'boolean' ||
		!Number.isInteger(resource.width) ||
		!Number.isInteger(resource.height) ||
		resource.width <= 0 ||
		resource.height <= 0 ||
		resource.width > 16384 ||
		resource.height > 16384 ||
		!Number.isInteger(resource.mips) ||
		resource.mips <= 0 ||
		resource.mips > 1 + Math.floor(Math.log2(Math.max(resource.width, resource.height))) ||
		resource.mipChain.length !== resource.mips ||
		resource.filter !== 'TF_Default' ||
		resource.nearest ||
		resource.slices !== (cube ? 6 : 1) ||
		(cube && (resource.sRGB || !['PF_DXT5', 'PF_BC6H'].includes(resource.pixelFormat))) ||
		(!cube && resource.pixelFormat === 'PF_BC6H') ||
		(resource.pixelFormat === 'PF_BC5' && resource.sRGB) ||
		!validReference(resource.package)
	) throw new Error('[JewelryMasked] incomplete native header/mip domain');

	address(resource.addressX);
	address(resource.addressY);
	for (const [index, mip] of resource.mipChain.entries()) {
		const width = Math.max(1, resource.width >> index);
		const height = Math.max(1, resource.height >> index);
		if (
			!mip.available ||
			mip.index !== index ||
			mip.width !== width ||
			mip.height !== height ||
			!validReference(mip.native) ||
			mip.native.byteLength !==
				Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes * resource.slices
		) throw new Error('[JewelryMasked] source compressed mip changed');

		if (cube) {
			const faces = mip.cubeFaces;
			const floating = resource.pixelFormat === 'PF_BC6H';
			if (
				!faces ||
				faces.width !== width ||
				faces.height !== height ||
				faces.slices !== 6 ||
				faces.laneOrder !== 'RGBA' ||
				!Array.isArray(faces.faceOrder) ||
				faces.faceOrder.join(',') !== '+X,-X,+Y,-Y,+Z,-Z' ||
				faces.byteLength !== width * height * 24 * (floating ? 4 : 1) ||
				!validReference(faces) ||
				mip.transport !== (floating ? 'native-cube-rgba32f' : 'native-cube-rgba8')
			) throw new Error('[JewelryMasked] requires original six faces, never latlong');
		} else if (
			!validReference(mip.decoded) ||
			mip.decoded.byteLength !== width * height * 4 ||
			mip.transport !== 'native2d-rgba8'
		) throw new Error('[JewelryMasked] source 2D mip payload changed');
	}
}

export function assertJewelryMaskedCubeCapability(renderer: WebGLRenderer, resource: JewelryMaskedNativeResource): void {
	if (resource.type !== 'TextureCube') throw new Error('[JewelryMasked] cube capability check requires the actual cube header');

	assertJewelryMaskedNativeTextureCapability(renderer, resource);
}

export function assertJewelryMaskedNativeTextureCapability(renderer: WebGLRenderer, resource: JewelryMaskedNativeResource): void {
	assertJewelryMaskedNativeResource(resource);

	const name =
		resource.pixelFormat === 'PF_BC6H'
			? 'EXT_texture_compression_bptc'
			: resource.pixelFormat === 'PF_BC5'
				? 'EXT_texture_compression_rgtc'
				: resource.sRGB
					? 'WEBGL_compressed_texture_s3tc_srgb'
					: 'WEBGL_compressed_texture_s3tc';
	if (!renderer.getContext().getExtension(name)) throw new Error(
		`[JewelryMasked] original compressed storage unsupported: ${name}; no decoded fallback`,
	);
}

/** Only verified resource ranges in their explicit source sampler domain may enter the native consumer. */
export function assertJewelryMaskedTextureBinding(
	texture: Texture,
	resource: JewelryMaskedNativeResource,
	addressDomain: 'asset-header' | 'explicit-editor-wrap',
): void {
	assertJewelryMaskedNativeResource(resource);

	const proof = verifiedTextures.get(texture);
	const seal = verifiedResources.get(resource);
	if (
		!proof ||
		!seal ||
		proof.resource !== resource ||
		proof.payloadDigests !== seal.payloadDigests ||
		seal.identity !== resourceIdentity(resource) ||
		proof.storage !== 'native-compressed' ||
		proof.identity !== resourceIdentity(resource) ||
		proof.addressDomain !== addressDomain ||
		texture.colorSpace !== (resource.sRGB ? SRGBColorSpace : NoColorSpace) ||
		texture.generateMipmaps ||
		texture.flipY ||
		texture.wrapS !==
			(addressDomain === 'explicit-editor-wrap' ? RepeatWrapping : address(resource.addressX)) ||
		texture.wrapT !==
			(addressDomain === 'explicit-editor-wrap' ? RepeatWrapping : address(resource.addressY)) ||
		texture.magFilter !== LinearFilter ||
		texture.minFilter !== (resource.mips > 1 ? LinearMipmapLinearFilter : LinearFilter)
	) throw new Error('[JewelryMasked] source texture requires verified transport and sampler domain');
}

/** Original compressed storage; decoded-reference is a separate diagnostic domain, never an automatic fallback. */
export async function createJewelryMaskedNativeTexture(
	resource: JewelryMaskedNativeResource,
	resources: FurnitureResourceReader,
	storage: 'native-compressed' | 'decoded-reference' = 'native-compressed',
	addressDomain: 'asset-header' | 'explicit-editor-wrap' = 'asset-header',
): Promise<Texture> {
	assertJewelryMaskedNativeResource(resource);
	if (
		!['native-compressed', 'decoded-reference'].includes(storage) ||
		!['asset-header', 'explicit-editor-wrap'].includes(addressDomain)
	) throw new Error('[JewelryMasked] invalid explicit source storage/sampler domain; no default fallback');

	const identity = resourceIdentity(resource);
	const cube = resource.type === 'TextureCube';
	const payloads = new Map<string, Promise<Uint8Array>>();

	const read = (reference: FurnitureRawReference) => {
		const key = JSON.stringify([reference.resource, reference.byteOffset, reference.byteLength]);
		let pending = payloads.get(key);
		if (!pending) {
			pending = resources.read(reference).then((data) => {
				if (!(data instanceof Uint8Array) || data.byteLength !== reference.byteLength) throw new Error('[JewelryMasked] native resource range length changed');

				return data;
			});
			payloads.set(key, pending);
		}

		return pending;
	};
	// Seal every original/decoded leaf, not merely the storage selected for this sampler.
	await read(resource.package);
	await Promise.all(
		resource.mipChain.flatMap((mip) => [
			read(mip.native),
			...(mip.decoded ? [read(mip.decoded)] : []),
			...(mip.cubeFaces ? [read(mip.cubeFaces)] : []),
		]),
	);

	const payloadDigests = JSON.stringify(
		await Promise.all([...payloads].map(async ([key, data]) => [key, await nativePayloadSHA256(await data)])),
	);
	const buffers = await Promise.all(
		resource.mipChain.map((mip) => read(storage === 'native-compressed' ? mip.native : cube ? mip.cubeFaces! : mip.decoded!)),
	);
	let texture: Texture;
	if (cube && storage === 'native-compressed') {
		const images = Array.from({ length: 6 }, (_, face) => ({
			width: resource.width,
			height: resource.height,
			mipmaps: buffers.map((buffer, index) => {
				const bytes = buffer;
				const stride = bytes.length / 6;
				if (!Number.isInteger(stride)) throw new Error('[JewelryMasked] native cube compressed face stride changed');

				return {
					data: bytes.subarray(face * stride, (face + 1) * stride),
					width: Math.max(1, resource.width >> index),
					height: Math.max(1, resource.height >> index),
				};
			}),
		}));
		texture = new CompressedCubeTexture(
			images,
			resource.pixelFormat === 'PF_BC6H' ? RGB_BPTC_UNSIGNED_Format : RGBA_S3TC_DXT5_Format,
			UnsignedByteType,
		);
	} else if (cube) {
		const floating = resource.pixelFormat === 'PF_BC6H';
		const levels = buffers.map((buffer, index) => {
			const width = Math.max(1, resource.width >> index);
			const height = Math.max(1, resource.height >> index);
			const pixels = floating
				? new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
				: buffer;
			if (floating && !pixels.every((value) => Number.isFinite(value) && value >= 0)) throw new Error('[JewelryMasked] invalid native HDR face pixels');

			const stride = width * height * 4;
			const images = Array.from(
				{ length: 6 },
				(_, face) =>
					new DataTexture(
						pixels.subarray(face * stride, (face + 1) * stride),
						width,
						height,
						RGBAFormat,
						floating ? FloatType : UnsignedByteType,
					),
			);
			return new CubeTexture(images);
		});
		const result = levels[0]!;
		result.mipmaps = levels.slice(1);
		result.type = floating ? FloatType : UnsignedByteType;
		texture = result;
	} else if (storage === 'native-compressed') {
		const levels = buffers.map((buffer, index) => ({
			data: buffer,
			width: Math.max(1, resource.width >> index),
			height: Math.max(1, resource.height >> index),
		}));
		const format =
			resource.pixelFormat === 'PF_DXT1'
				? RGBA_S3TC_DXT1_Format
				: resource.pixelFormat === 'PF_BC5'
					? RED_GREEN_RGTC2_Format
					: RGBA_S3TC_DXT5_Format;
		texture = new CompressedTexture(levels, resource.width, resource.height, format, UnsignedByteType);
	} else {
		const levels = buffers.map((buffer, index) => ({
			data: buffer,
			width: Math.max(1, resource.width >> index),
			height: Math.max(1, resource.height >> index),
		}));
		const first = levels[0]!;
		const result = new DataTexture(first.data, first.width, first.height, RGBAFormat, UnsignedByteType);
		result.mipmaps = levels;
		texture = result;
	}

	texture.name = resource.sourcePath;
	texture.colorSpace = resource.sRGB ? SRGBColorSpace : NoColorSpace;
	texture.wrapS = addressDomain === 'explicit-editor-wrap' ? RepeatWrapping : address(resource.addressX);
	texture.wrapT = addressDomain === 'explicit-editor-wrap' ? RepeatWrapping : address(resource.addressY);
	texture.magFilter = LinearFilter;
	texture.minFilter = resource.mips > 1 ? LinearMipmapLinearFilter : LinearFilter;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.premultiplyAlpha = false;
	texture.unpackAlignment = 1;
	texture.userData.jewelryMaskedNativeResource = {
		sourcePath: resource.sourcePath,
		packageResource: resource.package.resource,
		pixelFormat: resource.pixelFormat,
		nativeMips: resource.mips,
		regeneratedMips: false,
		transport:
			storage === 'native-compressed'
				? cube
					? 'original-native-compressed-cube'
					: 'original-native-compressed-2d'
				: cube
					? resource.pixelFormat === 'PF_BC6H'
						? 'decoded-native-cube-rgba32f'
						: 'decoded-native-cube-rgba8'
					: 'decoded-native2d-rgba8',
		samplerDomain: 'explicit-editor-linear-trilinear-not-live-RHI-sampler-capture',
		rgbScale: 1,
	};
	texture.needsUpdate = true;
	if (resourceIdentity(resource) !== identity) {
		texture.dispose();
		throw new Error('[JewelryMasked] source header changed during verified texture loading');
	}

	const seal = { identity, payloadDigests };
	const previous = verifiedResources.get(resource);
	if (previous && (previous.identity !== identity || previous.payloadDigests !== payloadDigests)) {
		texture.dispose();
		throw new Error('[JewelryMasked] verified resource identity/payload changed');
	}

	verifiedResources.set(resource, seal);
	verifiedTextures.set(texture, { ...seal, resource, storage, addressDomain });
	return texture;
}
