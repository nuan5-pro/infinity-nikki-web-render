import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial } from 'three';
import {
	assertWaterFxMaterialAdmission,
	bindWaterFxResources,
	createWaterFxResourceMaterial,
	disposeWaterFxResources,
} from '../../src/materials/water/waterFxAsset.js';
import {
	FurnitureResourceCache,
	FurnitureResources,
} from '../../src/resources/resources.js';
import { waterFxTextureKeys, type WaterFX } from '../../src/materials/water/waterFx.js';
import { type WaterFxNativeResource } from '../../src/materials/water/waterFxResources.js';
import { type WaterFxMaterialOptions } from '../../src/materials/water/waterFxMaterial.js';
import type { FurniturePackedResource } from '../../src/furniture/types.js';
import { bundleFixture } from './bundleFixture';

const options: WaterFxMaterialOptions = {
	lighting: 'editor-standard-preview',
	nativeBitangentSign: -1,
	emissiveScale: 1,
	preExposure: 1,
	roughness: 0.04,
	metalness: 0,
	primitiveHoldout: 0,
	objectCenter: [0, 0, 0],
	nativePrimitiveSign: 1,
};

let cache = new FurnitureResourceCache();
afterEach(() => {
	cache.dispose();
	cache = new FurnitureResourceCache();
});

function fixture() {
	const buffers = new Map<string, ArrayBuffer>();
	const rawResources: Record<string, FurniturePackedResource> = {};
	const bundles: Record<string, number> = {};
	const byPath = new Map<string, ArrayBuffer>();

	const blob = (bytes: number) => {
		const data = new Uint8Array(bytes);
		const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
		const resource = `r-${hash}`;
		const packet = bundleFixture([data]);
		buffers.set(resource, packet.data.buffer);
		byPath.set(packet.asset.path, packet.data.buffer);
		rawResources[resource] = packet.resource;
		Object.assign(bundles, packet.bundles);
		return { resource, byteOffset: 0, byteLength: bytes };
	};

	const resources: WaterFxNativeResource[] = waterFxTextureKeys.map((key) => {
		const cube = key === 'Cubemap';
		return {
			sourcePath: `/Game/Native/${key}.${key}`,
			type: cube ? 'TextureCube' : 'Texture2D',
			pixelFormat: cube ? 'PF_BC6H' : 'PF_DXT1',
			sRGB: !cube && key !== 'NormalMap',
			compression: cube ? 'TC_HDR_Compressed' : 'TC_Default',
			filter: 'TF_Default',
			nearest: false,
			addressX: 'TA_Wrap',
			addressY: 'TA_Wrap',
			width: 1,
			height: 1,
			slices: cube ? 6 : 1,
			mips: 1,
			firstAvailableMip: 0,
			completeNativeMips: true,
			package: blob(1),
			mipChain: [
				{
					index: 0,
					available: true,
					width: 1,
					height: 1,
					native: blob(cube ? 96 : 8),
					decoded: blob(cube ? 16 : 4),
					transport: cube ? 'native-linear-panorama-f32' : 'native2d-rgba8',
					...(cube
						? {
							cubeFaces: {
								...blob(96),
								width: 1,
								height: 1,
								slices: 6,
								laneOrder: 'RGBA',
								faceOrder: ['+X', '-X', '+Y', '-Y', '+Z', '-Z'],
							},
						}
						: {}),
				},
			],
		};
	});

	const config: WaterFX = {
		blend: 'additive',
		shader: 'cd1d929db9a76a43e10b8bfe42bc8abbf6845982',
		requires: [],
		material: Array.from({ length: 35 }, () => [0, 0, 0, 0]),
		textures: Object.fromEntries(waterFxTextureKeys.map((key) => [key, `/Game/Native/${key}.${key}`])),
		resources,
		transport: 'x6fx-native-resource-views-v1',
	};

	const material = new MeshStandardMaterial();
	material.userData.waterFx = config;

	const dependency = vi.fn(async (asset: { path: string }) => {
		const hash = asset.path.match(/-([a-f0-9]{16})\./)![1]!;
		const data = byPath.get(asset.path)!;
		if (!createHash('sha256').update(Buffer.from(data)).digest('hex').startsWith(hash)) throw new Error('resource digest changed');

		return data;
	});
	const result = new FurnitureResources({ textures: {}, rawResources, bundles }, '/', cache, undefined, dependency);
	return { config, material, result, buffers, dependency };
}

describe('native FX split resource context', () => {
	it('refuses invalid native profiles, mip ranges and missing resource headers', () => {
		const { material, config, result } = fixture();
		const invalid = material.clone();
		invalid.userData.waterFx.shader = 'unreviewed';
		expect(() => assertWaterFxMaterialAdmission(invalid)).toThrow('contract');
		config.resources![0]!.mipChain[0]!.native.byteLength = 0;
		expect(() => bindWaterFxResources(material, result)).toThrow('captured mip');
		config.resources!.pop();
		expect(() => bindWaterFxResources(material, result)).toThrow('Cubemap');
	});
	it('consumes typed original blocks through the pack parser for an ordinary visible canvas material', async () => {
		const { material, result, dependency } = fixture();
		bindWaterFxResources(material, result);

		const clone = material.clone();
		clone.userData = { ...material.userData };

		const output = await createWaterFxResourceMaterial(clone, options);
		expect(dependency).toHaveBeenCalled();
		expect(output.visible).toBe(true);
		output.dispose();
		disposeWaterFxResources(result);
		result.dispose();
		await expect(createWaterFxResourceMaterial(material, options)).rejects.toThrow('context');
	});
	it('rejects a mutated native block instead of decoding a PNG replacement', async () => {
		const { material, config, result, buffers } = fixture();
		bindWaterFxResources(material, result);
		new Uint8Array(buffers.get(config.resources![0]!.mipChain[0]!.native.resource)!)[16] = 1;
		await expect(createWaterFxResourceMaterial(material, options)).rejects.toThrow('digest');
		disposeWaterFxResources(result);
		result.dispose();
	});
});
