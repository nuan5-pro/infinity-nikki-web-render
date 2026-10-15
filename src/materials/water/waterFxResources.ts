import {
	ClampToEdgeWrapping,
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
	RGBA_S3TC_DXT1_Format,
	SRGBColorSpace,
	UnsignedByteType,
	type BufferGeometry,
	type Texture,
} from 'three';
import { waterFxTextureKeys, type WaterFX } from './waterFx.js';
import type { FurnitureRawReference } from '../../furniture/types.js';

export type WaterFxBlob = FurnitureRawReference;

export interface WaterFxNativeMip {
	index: number;
	available: boolean;
	width: number;
	height: number;
	native: WaterFxBlob;
	transport: 'native2d-rgba8' | 'native-linear-panorama-f32';
	decoded: WaterFxBlob;
	cubeFaces?: WaterFxBlob & {
		width: number;
		height: number;
		slices: number;
		laneOrder: string;
		faceOrder: string[];
	};
}

export interface WaterFxNativeResource {
	sourcePath: string;
	type: 'Texture2D' | 'TextureCube';
	pixelFormat: string;
	sRGB: boolean;
	compression: string;
	filter: string;
	nearest: boolean;
	addressX: string;
	addressY: string;
	width: number;
	height: number;
	slices: number;
	mips: number;
	firstAvailableMip: number;
	completeNativeMips: boolean;
	package: WaterFxBlob;
	mipChain: WaterFxNativeMip[];
	error?: string;
}

const wrapping = (address: string) => {
	switch (address) {
	case 'TA_Wrap':
		return RepeatWrapping;
	case 'TA_Clamp':
		return ClampToEdgeWrapping;
	case 'TA_Mirror':
		return MirroredRepeatWrapping;
	default:
		throw new Error(`X6FX unsupported native addressing: ${address}`);
	}
};

export function assertWaterFxResource(resource: WaterFxNativeResource): void {
	const cube = resource.type === 'TextureCube';
	if (
		resource.error ||
		!resource.completeNativeMips ||
		resource.firstAvailableMip !== 0 ||
		!Number.isInteger(resource.mips) ||
		resource.mips <= 0 ||
		resource.mipChain.length !== resource.mips ||
		resource.mips > 1 + Math.floor(Math.log2(Math.max(resource.width, resource.height))) ||
		!['Texture2D', 'TextureCube'].includes(resource.type) ||
		resource.slices !== (cube ? 6 : 1) ||
		resource.pixelFormat !== (cube ? 'PF_BC6H' : 'PF_DXT1') ||
		(cube && resource.sRGB) ||
		resource.filter !== 'TF_Default' ||
		resource.nearest
	) throw new Error(`X6FX unproven native texture/mip contract: ${resource.sourcePath}`);

	wrapping(resource.addressX);
	wrapping(resource.addressY);
	for (const [i, mip] of resource.mipChain.entries()) {
		const width = Math.max(1, resource.width >> i);
		const height = Math.max(1, resource.height >> i);
		const data = cube ? mip.cubeFaces : mip.decoded;
		const nativeBytes = Math.ceil(width / 4) * Math.ceil(height / 4) * (cube ? 96 : 8);
		if (
			!mip.available ||
			mip.index !== i ||
			mip.native.byteLength !== nativeBytes ||
			!data ||
			data.byteLength !== width * height * 4 * (cube ? 24 : 1) ||
			(cube
				? mip.cubeFaces?.width !== width ||
					mip.cubeFaces.height !== height ||
					mip.cubeFaces.slices !== 6 ||
					mip.cubeFaces.laneOrder !== 'RGBA' ||
					mip.cubeFaces.faceOrder.join(',') !== '+X,-X,+Y,-Y,+Z,-Z'
				: mip.width !== width || mip.height !== height || mip.transport !== 'native2d-rgba8')
		) throw new Error(`X6FX invalid captured mip ${i}: ${resource.sourcePath}`);
	}
}

export async function readWaterFxBlob(blob: WaterFxBlob, read: (reference: FurnitureRawReference) => Promise<Uint8Array>): Promise<ArrayBuffer> {
	const data = await read(blob);
	if (data.byteLength !== blob.byteLength) throw new Error(`X6FX resource range changed: ${blob.resource}`);

	return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

// Caller chooses the transport URL; this module never reaches a local path or
// rewrites source assets. Exact native mip payloads are uploaded, not regenerated.
export async function createWaterFxTexture(
	resource: WaterFxNativeResource,
	fetchBlob: (reference: FurnitureRawReference) => Promise<Uint8Array>,
	transport: 'native-bc1' | 'decoded-rgba8' = 'native-bc1',
): Promise<Texture> {
	assertWaterFxResource(resource);

	const cube = resource.type === 'TextureCube';
	const blobs = await Promise.all(
		resource.mipChain.map((mip) => readWaterFxBlob(cube ? mip.cubeFaces! : transport === 'native-bc1' ? mip.native : mip.decoded, fetchBlob)),
	);
	let texture: Texture;
	if (cube) {
		const levels = blobs.map((blob, i) => {
			const width = Math.max(1, resource.width >> i);
			const height = Math.max(1, resource.height >> i);
			const floats = new Float32Array(blob);
			if (!floats.every((v) => Number.isFinite(v) && v >= 0)) throw new Error('X6FX invalid native HDR cube values');

			const stride = width * height * 4;
			const faces = Array.from(
				{ length: 6 },
				(_, face) => new DataTexture(floats.subarray(face * stride, (face + 1) * stride), width, height, RGBAFormat, FloatType),
			);
			return new CubeTexture(faces);
		});
		const result = levels[0]!;
		// Three's uncompressed cube mipmap array excludes mip0; each level owns
		// six DataTexture images. Retain actual face dimensions down to native1x1.
		result.mipmaps = levels.slice(1);
		result.type = FloatType;
		texture = result;
	} else if (transport === 'native-bc1') {
		const levels = blobs.map((blob, i) => ({
			data: new Uint8Array(blob),
			width: Math.max(1, resource.width >> i),
			height: Math.max(1, resource.height >> i),
		}));
		texture = new CompressedTexture(levels, resource.width, resource.height, RGBA_S3TC_DXT1_Format);
	} else {
		const levels = blobs.map((blob, i) => ({
			data: new Uint8Array(blob),
			width: Math.max(1, resource.width >> i),
			height: Math.max(1, resource.height >> i),
		}));
		const first = levels[0]!;
		const result = new DataTexture(first.data, first.width, first.height, RGBAFormat, UnsignedByteType);
		result.mipmaps = levels;
		texture = result;
	}

	texture.name = resource.sourcePath;
	texture.colorSpace = resource.sRGB ? SRGBColorSpace : NoColorSpace;
	texture.wrapS = wrapping(resource.addressX);
	texture.wrapT = wrapping(resource.addressY);
	texture.magFilter = LinearFilter;
	texture.minFilter = resource.mips > 1 ? LinearMipmapLinearFilter : LinearFilter;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.premultiplyAlpha = false;
	texture.unpackAlignment = 1;
	texture.userData.waterFxNativeResource = {
		sourcePath: resource.sourcePath,
		resource: resource.package.resource,
		nativeMips: resource.mips,
		regeneratedMips: false,
		transport: cube
			? 'native-cube-rgba32f'
			: transport === 'native-bc1'
				? 'native-bc1-mips'
				: 'native2d-rgba8',
		rgbScale: 1,
	};
	texture.needsUpdate = true;
	return texture;
}

export async function loadWaterFxTextures(
	config: WaterFX,
	resources: WaterFxNativeResource[],
	fetchBlob: (reference: FurnitureRawReference) => Promise<Uint8Array>,
	active = new Set<string>(waterFxTextureKeys),
	acquire?: (resource: WaterFxNativeResource) => Promise<Texture>,
) {
	const owned = new Map<string, Texture>();
	try {
		const bindings: Record<string, Texture> = {};
		for (const key of waterFxTextureKeys) {
			if (!active.has(key)) continue;
			const path = config.textures[key]!;
			const resource = resources.find((row) => row.sourcePath === path);
			if (!resource) throw new Error(`X6FX missing native header: ${path}`);

			let texture = owned.get(path);
			if (!texture) {
				texture = acquire
					? (await acquire(resource)).clone()
					: await createWaterFxTexture(resource, fetchBlob);
				texture.name = resource.sourcePath;
				texture.userData.waterFxNativeResource = {
					...texture.userData.waterFxNativeResource,
					sourcePath: resource.sourcePath,
					resource: resource.package.resource,
				};
				owned.set(path, texture);
			}

			bindings[key] = texture;
		}

		return { bindings,

			dispose: () => owned.forEach((texture) => texture.dispose()) };
	} catch (error) {
		owned.forEach((texture) => texture.dispose());
		throw error;
	}
}

// The shared VM core emits an independently proven full-RGBA _layer_color
// carrier. Alias it for FX without changing diffuse vertexColors or geometry
// routes. Proof ownership stays with that core; a bare COLOR_0 is not admission.
export interface WaterFxColorProof {
	sourceKind: string;
	route: string;
	quality: string;
	liveRHI: boolean;
	consumerMask: string;
	checkedVertices: number;
	rgbaFloat32Sha256: string;
	projectionBasisVerified?: boolean;
}

export async function bindWaterFxNativeColor(geometry: BufferGeometry, proof: WaterFxColorProof): Promise<void> {
	const source = geometry.getAttribute('_layer_color') ?? geometry.getAttribute('ueLayerColor');
	const count = geometry.getAttribute('position')?.count;
	if (
		!source ||
		source.itemSize !== 4 ||
		source.count !== count ||
		source.normalized ||
		!(source.array instanceof Float32Array)
	) throw new Error('X6FX requires admitted native full-RGBA carrier');
	if (
		proof.sourceKind !== 'native-vm-packed-position-w-rgba4' ||
		proof.route !== 'catalog-PC-VM-material-color-preview' ||
		proof.quality !== 'static-captured-Num-SM5' ||
		proof.liveRHI !== false ||
		proof.consumerMask !== 'xyzw' ||
		proof.checkedVertices !== count
	) throw new Error('X6FX requires exact native VM/VS/PS colour admission proof');

	const copied = new Float32Array(source.array);
	const digest = await crypto.subtle.digest('SHA-256', copied.buffer);
	const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
	if (hash !== proof.rgbaFloat32Sha256) throw new Error('X6FX native RGBA carrier changed after admission');

	geometry.setAttribute('ueWaterFxColor', source);
	geometry.userData.waterFxColorProof = { ...proof };
}
