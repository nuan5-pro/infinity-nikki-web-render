import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';
import {
	mergeWaterFxDomains,
	padWaterFxMergeAttributes,
	restoreWaterFxGeometry,
} from '../../src/materials/water/waterFxGeometry.js';
import { waterFxTextureKeys, type WaterFX } from '../../src/materials/water/waterFx.js';

const config: WaterFX = {
	blend: 'additive',
	shader: 'cd1d929db9a76a43e10b8bfe42bc8abbf6845982',
	requires: [],
	material: Array.from({ length: 35 }, () => [0, 0, 0, 0]),
	textures: Object.fromEntries(waterFxTextureKeys.map((key) => [key, `/native/${key}`])),
};

const hash = (data: ArrayBufferView) =>
	createHash('sha256')
		.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
		.digest('hex');

function fixture() {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
	geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
	geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
	geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
	geometry.setAttribute('_layer_color', new Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 4));
	geometry.setAttribute('_ue_vertex_index', new Uint32BufferAttribute([0, 1, 2], 1));
	geometry.setIndex(new Uint32BufferAttribute([0, 1, 2], 1));

	const streams = Object.fromEntries(
		[
			['POSITION', 'position'],
			['NORMAL', 'normal'],
			['TANGENT', 'tangent'],
			['TEXCOORD_0', 'uv'],
			['_LAYER_COLOR', '_layer_color'],
			['_UE_VERTEX_INDEX', '_ue_vertex_index'],
			['indices', 'indices'],
		].map(([semantic, name]) => {
			const attribute = name === 'indices' ? geometry.index! : geometry.getAttribute(name!);
			const type = ['SCALAR', 'VEC2', 'VEC3', 'VEC4'][attribute.itemSize - 1];
			return [
				semantic,
				{
					sha256: hash(attribute.array),
					bytes: attribute.array.byteLength,
					count: attribute.count,
					type,
					componentType: attribute.array instanceof Float32Array ? 5126 : 5125,
				},
			];
		}),
	);
	geometry.userData.waterFxGeometry = {
		domain: 'x6fx-source-streams-lossless-v1',
		sourceModelSha256: 'a'.repeat(64),
		shader: config.shader,
		streams,
	};
	geometry.userData.virtualColorSource = {
		sourceKind: 'native-vm-packed-position-w-rgba4',
		route: 'catalog-PC-VM-material-color-preview',
		quality: 'static-captured-Num-SM5',
		liveRHI: false,
		consumerMask: 'xyzw',
		checkedVertices: 3,
		rgbaFloat32Sha256: hash(geometry.getAttribute('_layer_color').array),
		projectionBasisVerified: true,
	};
	return geometry;
}

describe('native FX original and merged geometry admission', () => {
	it('checks native source witnesses before transforming or padding', async () => {
		const geometry = fixture();
		await restoreWaterFxGeometry(geometry, config);
		expect(geometry.hasAttribute('ueWaterFxColor')).toBe(true);
		expect(geometry.hasAttribute('_ue_vertex_index')).toBe(false);
		expect(geometry.userData.waterFxColorProof.checkedVertices).toBe(3);
	});
	it('rejects changed TBN/UV/topology even when source colour is unchanged', async () => {
		for (const name of ['normal', 'tangent', 'uv', 'indices']) {
			const geometry = fixture();
			const attribute = name === 'indices' ? geometry.index! : geometry.getAttribute(name);
			attribute.setX(0, name === 'indices' ? 1 : 0.5);
			await expect(restoreWaterFxGeometry(geometry, config)).rejects.toThrow('bytes changed');
		}
	});
	it('consumes the exact dedicated native-ID carrier retained after production diagnostic stripping', async () => {
		const geometry = fixture();
		geometry.setAttribute('_water_fx_vertex_index', geometry.getAttribute('_ue_vertex_index'));
		geometry.deleteAttribute('_ue_vertex_index');
		await restoreWaterFxGeometry(geometry, config);
		expect(geometry.hasAttribute('ueWaterFxColor')).toBe(true);
		expect(geometry.hasAttribute('_water_fx_vertex_index')).toBe(false);
	});
	it('pads only non-FX slots and preserves separate checked vertex/center ownership', async () => {
		const fx = fixture();
		await restoreWaterFxGeometry(fx, config);

		const ordinary = new BufferGeometry();
		ordinary.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
		padWaterFxMergeAttributes([ordinary, fx]);
		expect(Array.from(ordinary.getAttribute('ueWaterFxColor').array)).toEqual([0, 0, 0, 0]);
		expect(ordinary.userData.waterFxColorProof).toBeUndefined();

		const merged = new BufferGeometry();
		mergeWaterFxDomains(merged, [ordinary, fx], new Map([[1, new Vector3(5, 6, 7)]]));
		expect(merged.userData.waterFxDomains[1].vertexStart).toBe(1);
		expect(merged.userData.waterFxDomains[1].objectCenter).toEqual([5, 6, 7]);

		const missing = fixture();
		expect(() => padWaterFxMergeAttributes([ordinary, missing])).toThrow('native RGBA carrier required');
	});
});
