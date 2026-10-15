import {
	DataTexture,
	LinearFilter,
	NearestFilter,
	NoColorSpace,
	RedFormat,
	RepeatWrapping,
	UnsignedByteType,
} from 'three';
import { readNNClothMipBytes, type NNClothMipPayload } from './nnclothBinary.js';

export interface NNClothCoverageNoise {
	sourcePath: string;
	uniformReferencedTextureIndex: 7 | 8;
	indexDomain: 'referenced-textures';
	pixelFormat: 'PF_G8';
	sRGB: false;
	nearest: boolean;
	addressX: 'TA_Wrap';
	addressY: 'TA_Wrap';
	width: number;
	height: number;
	mips: (NNClothMipPayload & { width: number; height: number; bytes: number })[];
}

export function createNNClothCoverageNoise(source: NNClothCoverageNoise) {
	const paths = {
		7: '/Engine/EngineMaterials/Good64x64TilingNoiseHighFreq.Good64x64TilingNoiseHighFreq',
		8: '/Game/Assets/Buildin/MasterMaterials/Textures/Character/GoodBlueNoise16x16.GoodBlueNoise16x16',
	};

	const size = source.uniformReferencedTextureIndex === 7 ? 64 : 16;
	const mip = source.mips[0];
	if (
		source.indexDomain !== 'referenced-textures' ||
		source.sourcePath !== paths[source.uniformReferencedTextureIndex] ||
		source.pixelFormat !== 'PF_G8' ||
		source.sRGB !== false ||
		source.width !== size ||
		source.height !== size ||
		source.addressX !== 'TA_Wrap' ||
		source.addressY !== 'TA_Wrap' ||
		source.mips.length !== 1 ||
		!mip ||
		mip.width !== size ||
		mip.height !== size ||
		mip.bytes !== size * size ||
		!/^[a-f0-9]{64}$/.test(mip.sha256 ?? '')
	) throw new Error('[NNCloth] invalid original indexed coverage noise');

	const data = readNNClothMipBytes(mip);
	if (data.length !== size * size) throw new Error('[NNCloth] original coverage noise size mismatch');

	const texture = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
	texture.name = source.sourcePath;
	texture.colorSpace = NoColorSpace;
	texture.wrapS = texture.wrapT = RepeatWrapping;
	texture.magFilter = texture.minFilter = source.nearest ? NearestFilter : LinearFilter;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}
