import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial } from 'three';
import { arraySampler, bindPaperMaterial } from '../src/furniture/paperMaterial.js';
import { CustomDataBuffer } from '../src/furniture/customData.js';
import { materialBindingRevision, registerMaterialDependencies } from '../src/runtime/materialPreparation.js';
import { resolveCustomData } from '../src/furniture/colorings.js';
import type { FurnitureModelConfig } from '../src/furniture/types.js';

describe('native array shader consumers', () => {
	it('changes binding revisions only when the owned texture changes, including shadow dependencies', () => {
		const material = new MeshBasicMaterial();
		const shadow = new MeshBasicMaterial();
		material.userData.foliage = shadow.userData.foliage = { home: true };
		registerMaterialDependencies(material, [shadow]);
		const first = new CustomDataBuffer([1], 1, 64);
		const second = new CustomDataBuffer([1], 16, 64);
		try {
			for (const owner of [material, shadow]) expect(materialBindingRevision(owner)).toBe(0);
			bindPaperMaterial(material, first);
			for (const owner of [material, shadow]) expect(materialBindingRevision(owner)).toBe(1);
			const compile = material.onBeforeCompile;
			const key = material.customProgramCacheKey();
			bindPaperMaterial(material, first);
			first.set(0, [2]);
			first.flush();
			bindPaperMaterial(material, first);
			for (const owner of [material, shadow]) expect(materialBindingRevision(owner)).toBe(1);
			bindPaperMaterial(material, second);
			for (const owner of [material, shadow]) expect(materialBindingRevision(owner)).toBe(2);
			expect(material.onBeforeCompile).toBe(compile);
			expect(material.customProgramCacheKey()).toBe(key);
		} finally {
			first.dispose();
			second.dispose();
			material.dispose();
			shadow.dispose();
		}
	});

	it('preserves unrelated samplers, nested coordinates and explicit gradients', () => {
		const source = `uniform sampler2D diffuse, normal;
      vec4 a = texture2D(diffuse, mix(uv, vec2(1., 2.), 0.5));
      vec4 b = textureGrad(diffuse, uv, dFdx(uv), dFdy(uv));
      vec4 c = texture2D(normal, uv);`;
		const output = arraySampler(source, 'diffuse', 'layer');
		expect(output).toContain('uniform highp sampler2DArray diffuse;');
		expect(output).toContain('uniform sampler2D normal;');
		expect(output).toContain('texture(diffuse, vec3( mix(uv, vec2(1., 2.), 0.5), layer))');
		expect(output).toContain('textureGrad(diffuse, vec3( uv, layer), dFdx(uv), dFdy(uv))');
		expect(output).toContain('texture2D(normal, uv)');
	});
	it('preserves raw integers and original component indices across UI choices', () => {
		const config = { customData: [0, 0, 158], colorings: { '0': { '0': [[2, 158]], '1': [[2, 26]] } } };
		expect([...resolveCustomData(config as never, new Map([[0, 1]]))]).toEqual([0, 0, 26]);
		expect(config.customData).toEqual([0, 0, 158]);
		expect([...resolveCustomData(config as never, { '0': 2 })]).toEqual([0, 0, 158]);
	});
	it.each(['map', 'record'])('ignores unknown areas and schemes while preserving valid %s selections', (format) => {
		const config: Pick<FurnitureModelConfig, 'customData' | 'colorings'> = {
			customData: [158, 7, 9],
			colorings: { '0': { '1': [[0, 26]] }, '1': { '2': [[1, 88]] }, '2': { '0': [[2, 77]] } },
		};

		const entries: [number, number][] = [[0, 1], [1, 5], [9, 5], [2, 0]];
		const selections = format === 'map' ? new Map(entries) : Object.fromEntries(entries);
		const originalConfig = structuredClone(config);
		const originalSelections = structuredClone(selections);

		expect([...resolveCustomData(config, selections)]).toEqual([26, 7, 77]);
		expect(config).toEqual(originalConfig);
		expect(selections).toEqual(originalSelections);
	});
});
