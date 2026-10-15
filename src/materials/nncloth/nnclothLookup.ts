import {
	ClampToEdgeWrapping,
	DataTexture,
	HalfFloatType,
	LinearFilter,
	NoColorSpace,
	RGBAFormat,
} from 'three';
import { readNNClothMipBytes, type NNClothMipPayload } from './nnclothBinary.js';

export interface NNClothLookup {
	kind: 'lookupAtlas'
	indexDomain: 'referenced-textures'
	sourcePath: string
	sRGB: true
	sampler: 'view-world-clamp'
	format: 'rgba16f-native'
	width: 64
	height: 64
	mips: (NNClothMipPayload & { width: number; height: number })[]
}

/** Original float atlas transport. Asset sRGB is retained as evidence, not
 * converted into an sRGB SRV for the native floating-point storage format. */
export function createNNClothLookup(source: NNClothLookup) {
	if (
		source.kind !== 'lookupAtlas' ||
		source.indexDomain !== 'referenced-textures' ||
		source.sourcePath !==
			'/Game/Assets/Buildin/MasterMaterials/Textures/Character/Curve/CA_Fabric_Attr.CA_Fabric_Attr' ||
		source.sRGB !== true ||
		source.sampler !== 'view-world-clamp' ||
		source.format !== 'rgba16f-native' ||
		source.width !== 64 ||
		source.height !== 64 ||
		source.mips.length !== 1
	) throw new Error('[NNCloth] invalid native attribute lookupAtlas');

	const mip = source.mips[0]!;
	const bytes = readNNClothMipBytes(mip);
	if (mip.width !== 64 || mip.height !== 64 || bytes.length !== 64 * 64 * 8) throw new Error('[NNCloth] invalid original half-float atlas payload');

	const data = new Uint16Array(bytes.length / 2);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let index = 0; index < data.length; index++) {
		data[index] = view.getUint16(index * 2, true);
		if ((data[index]! & 0x7c00) === 0x7c00) throw new Error('[NNCloth] nonfinite native half-float atlas');
	}

	const texture = new DataTexture(data, source.width, source.height, RGBAFormat, HalfFloatType);
	texture.name = source.sourcePath;
	texture.colorSpace = NoColorSpace;
	texture.wrapS = ClampToEdgeWrapping;
	texture.wrapT = ClampToEdgeWrapping;
	texture.magFilter = LinearFilter;
	texture.minFilter = LinearFilter;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.userData.nativeAtlasSRGBFlag = source.sRGB;
	texture.userData.nativeAtlasTransferProof = 'source-pf-floatrgba-linear-srv';
	texture.needsUpdate = true;
	return texture;
}
