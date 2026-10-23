import { DoubleSide, MeshStandardMaterial, ShaderLib, Texture, type Material, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { buildDefaultPlainMaterial } from '../../src/materials/factory.js';
import { createEditorMaterialPreview } from '../../src/materials/editorMaterialPreview.js';
import { applyShadingQuality, type ShadingQuality } from '../../src/runtime/shadingQuality.js';
import { applyFoliageNormals } from '../../src/index.js';

function source(authored: boolean) {
	const material = new MeshStandardMaterial({ side: DoubleSide, alphaTest: 0.3333 });
	material.userData.render = { blend: 'masked', twoSided: true, ...(authored ? { foliageNormals: 'authored' } : {}) };
	return material;
}

function compile(material: Material) {
	const shader = {
		uniforms: {},
		vertexShader: ShaderLib.standard.vertexShader,
		fragmentShader: ShaderLib.standard.fragmentShader,
	};
	material.onBeforeCompile(shader as never, {} as WebGLRenderer);
	return shader.fragmentShader;
}

describe('authored foliage normals in standard previews', () => {
	it('installs the public GLTF material hook only once', () => {
		const material = source(true);
		applyFoliageNormals(material);
		const hook = material.onBeforeCompile;
		const key = material.customProgramCacheKey();
		applyFoliageNormals(material);
		expect(material.onBeforeCompile).toBe(hook);
		expect(material.customProgramCacheKey()).toBe(key);
		expect(compile(material).split('normal *= faceDirection;')).toHaveLength(2);
		material.dispose();
	});

	it.each<ShadingQuality>(['original', 'performance', 'economy'])('retains canopy direction through %s shading', async (quality) => {
		const input = source(true);
		const material = await buildDefaultPlainMaterial(input, null, new Map());
		applyShadingQuality(material, quality, 'standard');
		const shader = compile(material);
		expect(shader).toContain('#include <normal_fragment_maps>\nnormal *= faceDirection;');
		expect(shader.indexOf('normal *= faceDirection;')).toBeLessThan(shader.indexOf('#include <lights_physical_fragment>'));
		expect(material.alphaTest).toBe(0.3333);
		expect(material.side).toBe(DoubleSide);
		material.dispose();
		input.dispose();
	});

	it('applies to editorPreview while preserving alpha and optional normal-map bindings', () => {
		const input = source(true);
		const texture = new Texture();
		const material = createEditorMaterialPreview({
			family: 'editor-material-1', version: 1, color: [1, 1, 1], opacity: 1,
			roughness: 1, vertexColor: 'none', alpha: [{ role: 'D', channel: 'a' }],
			sampling: { D: { srgb: true, uv: 0, transform: [1, 1, 0, 0] } },
		}, { D: texture }, input);
		const shader = compile(material);
		expect(shader).toContain('normal *= faceDirection;');
		expect(shader).toContain('diffuseColor.a=opacity*texture2D(editorAlphaD,vEditorAlphaD).a;');
		expect(material.map).not.toBeNull();
		material.dispose();
		input.dispose();
		texture.dispose();
	});

	it('leaves ordinary double-sided materials intact and separates their program cache', async () => {
		const inputs = [source(false), source(true)];
		const [ordinary, foliage] = await Promise.all(inputs.map(input => buildDefaultPlainMaterial(input, null, new Map())));
		expect(compile(ordinary)).not.toContain('normal *= faceDirection;');
		expect(ordinary.customProgramCacheKey()).not.toBe(foliage.customProgramCacheKey());
		for (const material of [...inputs, ordinary, foliage]) material.dispose();
	});
});
