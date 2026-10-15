import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, SRGBColorSpace } from 'three';
import {
	assertWaterFxResource,
	bindWaterFxNativeColor,
	createWaterFxTexture,
	readWaterFxBlob,
	type WaterFxNativeResource,
} from '../../src/materials/water/waterFxResources.js';

const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function fixture() {
	const pixels = new Uint8Array([128, 64, 32, 255]);

	const blob = {
		resource: `r-${hash(pixels).slice(0, 16)}`,
		byteOffset: 0,
		byteLength: pixels.length,
	};

	const resource: WaterFxNativeResource = {
		sourcePath: '/Game/Native.Native',
		type: 'Texture2D',
		pixelFormat: 'PF_DXT1',
		sRGB: true,
		compression: 'TC_Default',
		filter: 'TF_Default',
		nearest: false,
		addressX: 'TA_Wrap',
		addressY: 'TA_Wrap',
		width: 1,
		height: 1,
		slices: 1,
		mips: 1,
		firstAvailableMip: 0,
		completeNativeMips: true,
		package: blob,
		mipChain: [
			{
				index: 0,
				available: true,
				width: 1,
				height: 1,
				native: {
					resource: `r-${hash(new Uint8Array(8)).slice(0, 16)}`,
					byteOffset: 0,
					byteLength: 8,
				},
				decoded: blob,
				transport: 'native2d-rgba8',
			},
		],
	};

	return { resource, pixels,

		fetchBlob: async () => pixels };
}

describe('native FX resource and geometry admission', () => {
	it('uploads source transfer with exact mip ownership and no regeneration', async () => {
		const { resource, fetchBlob } = fixture();
		const texture = await createWaterFxTexture(resource, fetchBlob, 'decoded-rgba8');
		expect(texture.colorSpace).toBe(SRGBColorSpace);
		expect(texture.mipmaps.length).toBe(1);
		expect(texture.generateMipmaps).toBe(false);
		expect(texture.flipY).toBe(false);
		expect(texture.userData.waterFxNativeResource.sourcePath).toBe(resource.sourcePath);
	});
	it('rejects mutated bytes, missing mip and fabricated source headers', async () => {
		const { resource, fetchBlob } = fixture();
		await expect(readWaterFxBlob({ ...resource.package, byteLength: 3 }, fetchBlob)).rejects.toThrow('range changed');
		expect(() => assertWaterFxResource({ ...resource, completeNativeMips: false })).toThrow('mip contract');
		expect(() => assertWaterFxResource({ ...resource, pixelFormat: 'invented' })).toThrow('mip contract');
		expect(() => assertWaterFxResource({ ...resource, type: 'TextureCube' })).toThrow('mip contract');
	});
	it('requires native proof/hash even when actual captured values happen to be white', async () => {
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));

		const data = new Float32Array([1, 1, 1, 1]);
		geometry.setAttribute('_layer_color', new Float32BufferAttribute(data, 4));

		const proof = {
			sourceKind: 'native-vm-packed-position-w-rgba4',
			route: 'catalog-PC-VM-material-color-preview',
			quality: 'static-captured-Num-SM5',
			liveRHI: false,
			consumerMask: 'xyzw',
			checkedVertices: 1,
			rgbaFloat32Sha256: hash(new Uint8Array(data.buffer)),
		};

		await bindWaterFxNativeColor(geometry, proof);
		expect(geometry.getAttribute('ueWaterFxColor')).toBe(geometry.getAttribute('_layer_color'));
		geometry.getAttribute('_layer_color').setX(0, 0.5);
		await expect(bindWaterFxNativeColor(geometry, proof)).rejects.toThrow('changed after admission');
		await expect(bindWaterFxNativeColor(geometry, { ...proof, liveRHI: true })).rejects.toThrow('proof');
	});
});
