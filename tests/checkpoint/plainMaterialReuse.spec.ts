import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, Texture } from 'three';
import {
	buildDefaultPlainMaterial,
	cloneSourceMaterialForItem,
	createPlainMaterialBuilder,
} from '../../src/materials/factory.js';

function source() {
	const material = new MeshStandardMaterial();
	material.name = 'shared-source';
	material.userData.render = {};
	return material;
}

describe('item-local standard material reuse', () => {
	it('precomputes authored UV transforms while preserving explicit matrices', async () => {
		const material = new MeshStandardMaterial();
		const map = new Texture();
		const normal = new Texture();
		map.repeat.set(2, 3);
		map.offset.set(0.25, 0.5);
		map.rotation = 0.3;

		const expected = map.clone();
		expected.updateMatrix();
		normal.matrixAutoUpdate = false;
		normal.matrix.set(2, 0, 0.5, 0, 4, 0.2, 0, 0, 1);

		const explicit = normal.matrix.clone();
		material.map = map;
		material.normalMap = normal;
		await buildDefaultPlainMaterial(material, null, new Map());
		expect(map.matrixAutoUpdate).toBe(false);
		expect(map.matrix.equals(expected.matrix)).toBe(true);
		expect(normal.matrix.equals(explicit)).toBe(true);
	});

	it('shares only identical clones of the same admitted source', async () => {
		const origin = source();
		const build = createPlainMaterialBuilder(new Map());
		const first = await build(cloneSourceMaterialForItem(origin), 'source:shared');
		const second = await build(cloneSourceMaterialForItem(cloneSourceMaterialForItem(origin)), 'source:shared');
		expect(second).toBe(first);
		expect(await build(cloneSourceMaterialForItem(source()), 'source:shared')).not.toBe(first);
		expect(await createPlainMaterialBuilder(new Map())(cloneSourceMaterialForItem(origin), 'source:shared')).not.toBe(first);
	});

	it('preserves all slot-specific presentation, geometry and sampler state', async () => {
		const origin = source();
		const build = createPlainMaterialBuilder(new Map());
		const first = await build(cloneSourceMaterialForItem(origin), 'source:shared');

		const changes = [
			(m: MeshStandardMaterial) => {
				m.normalScale.y = -1;
			},
			(m: MeshStandardMaterial) => {
				m.color.r = 0.5;
			},
			(m: MeshStandardMaterial) => {
				m.vertexColors = true;
			},
			(m: MeshStandardMaterial) => {
				m.flatShading = true;
			},
			(m: MeshStandardMaterial) => {
				m.depthWrite = false;
			},
			(m: MeshStandardMaterial) => {
				m.map = new Texture();
			},
			(m: MeshStandardMaterial) => {
				m.userData.render = { unlit: true };
			},
		];

		for (const change of changes) {
			const variant = cloneSourceMaterialForItem(origin) as MeshStandardMaterial;
			change(variant);
			expect(await build(variant, 'source:shared')).not.toBe(first);
		}

		expect(await build(cloneSourceMaterialForItem(origin), 'source:other')).not.toBe(first);
	});

	it('does not share native profiles, transparent sources or custom callbacks', async () => {
		const origins = [source(), source(), source(), source()];
		origins[0]!.userData.homeWallBasis = {};
		origins[1]!.transparent = true;
		origins[2]!.onBeforeRender = () => {};
		origins[3]!.onBeforeCompile = () => {};
		for (const origin of origins) {
			const build = createPlainMaterialBuilder(new Map());
			const first = cloneSourceMaterialForItem(origin);
			const second = cloneSourceMaterialForItem(origin);
			// Three.clone deliberately omits callbacks; admission must inspect the
			// actual source passed to the builder, including callbacks added later.
			first.onBeforeRender = second.onBeforeRender = origin.onBeforeRender;
			first.onBeforeCompile = second.onBeforeCompile = origin.onBeforeCompile;
			expect(await build(first, null)).not.toBe(await build(second, null));
		}
	});
});
