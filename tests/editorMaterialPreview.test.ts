import { describe, expect, it } from 'vitest';
import { DataArrayTexture, MeshStandardMaterial, ShaderLib, Texture, UniformsUtils } from 'three';
import { createEditorMaterialPreview, readEditorMaterialPreview, type EditorMaterialPreview } from '../src/materials/editorMaterialPreview.js';
import { installPaperMaterial } from '../src/furniture/paperMaterial.js';

const preview = (): EditorMaterialPreview => ({
	family: 'editor-material-1', version: 1, color: [1, 1, 1], opacity: 2, roughness: 0.65,
	alpha: [{ role: 'D', channel: 'a' }], vertexColor: 'none',
	sampling: { D: { srgb: true, uv: 0, transform: [1, 1, 0, 0] } },
});

function compile(material: MeshStandardMaterial) {
	const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader,
		uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms) };
	material.onBeforeCompile(shader, null as never);
	return shader;
}

describe('mobile static preview', () => {
	it.each(['raw', 'raw-mod25'])('uses %s for both color and explicit alpha array samples', (recipe) => {
		const texture = new DataArrayTexture(new Uint8Array(4 * 2), 1, 1, 2);
		texture.userData.paperLayer = recipe;
		const source = new MeshStandardMaterial({ alphaTest: 0.3333 });
		source.userData.textureInputs = { D: { paperLayer: recipe } };
		const material = createEditorMaterialPreview(preview(), { D: texture }, source) as MeshStandardMaterial;
		try {
			installPaperMaterial(material);
			const shader = compile(material);
			expect(shader.fragmentShader).toContain('uniform highp sampler2DArray map;');
			expect(shader.fragmentShader).toContain('uniform highp sampler2DArray editorAlphaD;');
			expect(shader.fragmentShader).toContain('diffuseColor.a=opacity*texture(editorAlphaD,');
			expect(shader.fragmentShader.includes('nuanPaperCustomData % 25u')).toBe(recipe === 'raw-mod25');
			expect(material.opacity).toBe(2);
			expect(material.alphaTest).toBe(0.3333);
		} finally {
			material.dispose(); source.dispose(); texture.dispose();
		}
	});

	it('binds Paper data for a 2D gradient atlas without any array texture', () => {
		const data = preview();
		data.gradient = { grid: [5, 5], params: [0.25, 2, 0, 0] };
		data.specular = 0;
		data.sampling.O = { srgb: false, uv: 0, transform: [1, 1, 0, 0] };
		data.sampling.T = { srgb: true, uv: 0, transform: [1, 1, 0, 0] };
		const textures = { D: new Texture(), O: new Texture(), T: new Texture() };
		const source = new MeshStandardMaterial();
		const material = createEditorMaterialPreview(data, textures, source) as MeshStandardMaterial;
		try {
			installPaperMaterial(material);
			const shader = compile(material);
			expect(shader.uniforms.nuanCustomData).toBeDefined();
			expect(shader.uniforms.editorSpecular!.value).toBe(0);
			expect(shader.fragmentShader).toContain('material.specularColor *= editorSpecular;');
			expect(shader.fragmentShader).not.toMatch(/\bfoliageRaw\b/);
			expect(shader.fragmentShader).toContain('mod(float(nuanPaperCustomData),editorColumns)');
			expect(shader.vertexShader).toContain('mix(uv2.y,uv3.y,0.25000000)');
			expect(shader.fragmentShader).toContain('uniform sampler2D editorGradientMap, editorGradientMask;');
		} finally {
			material.dispose(); source.dispose(); Object.values(textures).forEach(texture => texture.dispose());
		}
	});

	it('rejects undeclared arrays and incomplete gradient inputs', () => {
		const source = new MeshStandardMaterial();
		const texture = new DataArrayTexture();
		try {
			expect(() => createEditorMaterialPreview(preview(), { D: texture }, source)).toThrow('declared Paper array');
			expect(readEditorMaterialPreview({ ...preview(), gradient: { grid: [0, 5], params: [0, 1, 0, 0] } })).toBeNull();
		} finally {
			source.dispose(); texture.dispose();
		}
	});
});
