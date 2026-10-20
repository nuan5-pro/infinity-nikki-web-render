import { expect, it } from 'vitest';
import { BoxGeometry, Matrix4, MeshBasicMaterial, ShaderLib, type WebGLRenderer } from 'three';
import { processGeometryForItem } from '../src/furniture/geometry.js';
import { bindPaperMaterial } from '../src/furniture/paperMaterial.js';
import { CustomDataBuffer } from '../src/furniture/customData.js';
import type { FurnitureModelConfig } from '../src/furniture/types.js';

it('decodes PaperCustomData before native fragment consumers, including the depth path', () => {
	const material = new MeshBasicMaterial();
	material.userData.foliage = { home: true };
	const data = new CustomDataBuffer([0xffffffff], 1, 64);
	try {
		bindPaperMaterial(material, data);
		for (const template of [ShaderLib.basic, ShaderLib.depth]) {
			const shader = { uniforms: {}, vertexShader: template.vertexShader, fragmentShader: template.fragmentShader };
			material.onBeforeCompile(shader, {} as WebGLRenderer);
			expect(shader.vertexShader).toContain('nuanPaperCustomDataBytes = nuanEncodePaperCustomData(nuanPaperCustomData)');
			expect(shader.fragmentShader).toMatch(/void\s+main\s*\(\s*\)\s*\{\s*nuanPaperCustomData = nuanDecodePaperCustomData/);
			expect(shader.vertexShader).not.toContain('flat out');
			expect(shader.fragmentShader).not.toContain('flat in');
		}
	} finally {
		data.dispose();
		material.dispose();
	}
});

// Smooth byte transport is valid only if component identity is constant within
// each triangle. Exercise the real transform/merge path, including winding flips.
it.each([true, false])('preserves component identity across merged triangle vertices (indexed=%s)', async (indexed) => {
	const box = new BoxGeometry();
	const geometry = indexed ? box : box.toNonIndexed();
	const material = new MeshBasicMaterial();
	const config: FurnitureModelConfig = {
		id: 1, componentCount: 2, customData: [0, 0xffffffff], colorings: {}, root_offset: { x: 0, y: 0, z: 0 },
		meshes: [0, 1].map(sourceIndex => ({
			sourceIndex, slots: ['m'], models: { full: { path: `${sourceIndex}.glb`, bytes: 1 } },
			rotation: { x: 0, y: 0, z: 0, w: 1 },
			scale: { x: sourceIndex ? -1 : 1, y: 1, z: 1 },
			trans: { x: sourceIndex * 200, y: 0, z: 0 },
		})),
	};
	const result = await processGeometryForItem(1, config, { model: 'full', material: 'full' }, async () => ({
		meshEntries: [{ geometry, localMatrix: new Matrix4(), material, baseName: null }],
		materialRegistry: new Map(), dispose() {},
	}));
	try {
		expect(result).toBeDefined();
		const merged = result!.geometry, component = merged.getAttribute('nuanSourceMesh');
		expect(new Set(component.array)).toEqual(new Set([0, 1]));
		const count = merged.index?.count ?? component.count;
		for (let i = 0; i < count; i += 3) {
			const at = (vertex: number) => component.getX(merged.index?.getX(vertex) ?? vertex);
			expect(at(i + 1)).toBe(at(i));
			expect(at(i + 2)).toBe(at(i));
		}
	} finally {
		result?.geometry.dispose();
		for (const owned of result?.plainMaterials ?? []) owned.dispose();
		geometry.dispose();
		if (geometry !== box) box.dispose();
		material.dispose();
	}
});
