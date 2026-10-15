import { Material, MeshBasicMaterial, ShaderLib, Texture, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import {
	createEditorMaterialPreview,
	readEditorMaterialPreview,
	type EditorMaterialPreview,
} from '../../src/materials/editorMaterialPreview.js';

function fixture(): EditorMaterialPreview {
	return {
		family: 'editor-material-1',
		version: 1,
		sourcePath: '/Game/Materials/Actual.Actual',
		color: [0, 1, 3.5],
		opacity: 0.1,
		roughness: 0.65,
		vertexColor: 'none',
		alpha: [
			{ role: 'D', channel: 'a' },
			{ role: 'M', channel: 'g' },
		],
		textures: { D: 'Base', M: 'Alpha' },
		sampling: {
			D: {
				parameter: 'Base',
				path: '/Game/Textures/D.D',
				srgb: true,
				uv: 0,
				transform: [1, 1, 0, 0],
			},
			M: {
				parameter: 'Alpha',
				path: '/Game/Textures/M.M',
				srgb: false,
				uv: 1,
				transform: [0.98, 0.900295, 0, 0],
			},
		},
	};
}

describe('source-bound ordinary editor material preview', () => {
	it('keeps base alpha times separate mask G and authored scalar opacity', () => {
		const source = new MeshBasicMaterial({ transparent: true });
		source.userData.render = { unlit: true, blend: 'translucent' };

		const material = createEditorMaterialPreview(fixture(), { D: new Texture(), M: new Texture() }, source);
		expect(material).toBeInstanceOf(MeshBasicMaterial);
		expect(material.opacity).toBe(0.1);
		expect(material.color.b).toBe(3.5);
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
		} as Parameters<Material['onBeforeCompile']>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader).toContain(
			'diffuseColor.a=opacity*texture2D(editorAlphaD,vEditorAlphaD).a*texture2D(editorAlphaM,vEditorAlphaM).g;',
		);
		expect(shader.fragmentShader.indexOf('diffuseColor.a=opacity')).toBeLessThan(
			shader.fragmentShader.indexOf('#include <alphatest_fragment>'),
		);
		expect(shader.vertexShader).toContain('uv1*editorAlphaTransformM.xy+editorAlphaTransformM.zw');
		expect(shader.uniforms.editorAlphaTransformM!.value.toArray()).toEqual([0.98, 0.900295, 0, 0]);
		material.dispose();
	});

	it('shares structure across authored transforms and texture paths, but separates UV and coverage code', () => {
		const a = fixture();
		const b = fixture();
		const c = fixture();
		b.sampling.M!.transform = [2, 3, 0.2, 0.4];
		b.sampling.M!.path = '/Game/Another.Texture';
		c.sampling.M!.uv = 0;

		const make = (value: EditorMaterialPreview) => createEditorMaterialPreview(value, { D: new Texture(), M: new Texture() }, new MeshBasicMaterial());

		const first = make(a);
		const second = make(b);
		const different = make(c);
		expect(first.customProgramCacheKey()).toBe(second.customProgramCacheKey());
		expect(first.customProgramCacheKey()).not.toBe(different.customProgramCacheKey());

		const compile = (material: Material) => {
			const shader = {
				uniforms: {},
				vertexShader: ShaderLib.basic.vertexShader,
				fragmentShader: ShaderLib.basic.fragmentShader,
			} as Parameters<Material['onBeforeCompile']>[0];

			material.onBeforeCompile(shader, {} as WebGLRenderer);
			return shader;
		};

		const x = compile(first);
		const y = compile(second);
		const z = compile(different);
		expect(x.vertexShader).toBe(y.vertexShader);
		expect(x.fragmentShader).toBe(y.fragmentShader);
		expect(x.uniforms.editorAlphaTransformM!.value.toArray()).not.toEqual(y.uniforms.editorAlphaTransformM!.value.toArray());
		expect(x.vertexShader).not.toBe(z.vertexShader);
		first.dispose();
		second.dispose();
		different.dispose();
	});

	it('retains authored scalar zero rather than replacing it with default one', () => {
		const input = fixture();
		input.opacity = 0;

		const material = createEditorMaterialPreview(input, { D: new Texture(), M: new Texture() }, new MeshBasicMaterial({ transparent: true }));
		expect(material.opacity).toBe(0);
		expect(material.visible).toBe(true);
		material.dispose();
	});

	it('uses explicit opacity-only coverage when alpha is empty, after stock map/color processing', () => {
		const input = fixture();
		input.alpha = [];

		const material = createEditorMaterialPreview(input, { D: new Texture(), M: new Texture() }, new MeshBasicMaterial());

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
		} as Parameters<Material['onBeforeCompile']>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader).toContain('diffuseColor.a=opacity;');
		expect(shader.fragmentShader.indexOf('diffuseColor.a=opacity;')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <map_fragment>'));
		expect(shader.fragmentShader.indexOf('diffuseColor.a=opacity;')).toBeGreaterThan(
			shader.fragmentShader.indexOf('#include <color_fragment>'),
		);
		expect(shader.fragmentShader).not.toContain('uniform sampler2D editorAlphaD');
		material.dispose();
	});

	it('retains explicitly requested vertex alpha without inheriting map alpha', () => {
		const input = fixture();
		input.alpha = [];
		input.vertexColor = 'rgba';

		const material = createEditorMaterialPreview(input, { D: new Texture(), M: new Texture() }, new MeshBasicMaterial());

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
		} as Parameters<Material['onBeforeCompile']>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader).toContain('diffuseColor.a=opacity*vColor.a;');
		material.dispose();
	});

	it('keeps intentional dynamic-overlay omission explicit and depth-neutral', () => {
		const input = fixture();
		Object.assign(input, {
			omitDynamicOverlay: true,
			opacity: 0,
			alpha: [],
			textures: {},
			sampling: {},
		});

		const material = createEditorMaterialPreview(input, {}, new MeshBasicMaterial());
		expect(material.opacity).toBe(0);
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);
		expect(material.visible).toBe(true);
		expect(readEditorMaterialPreview({ ...input, opacity: 1 })).toBeNull();

		const {
			sourcePath: _path,
			textures: _textures,
			...compact
		} = input;
		expect(readEditorMaterialPreview(compact)).toBe(compact);
		material.dispose();
	});

	it('refuses missing coverage resources, wrong channels and native-preview mixtures', () => {
		expect(() => createEditorMaterialPreview(fixture(), { D: new Texture() }, new MeshBasicMaterial())).toThrow('M missing');
		expect(readEditorMaterialPreview({ ...fixture(), alpha: [{ role: 'M', channel: 'xy' }] })).toBeNull();

		const source = new MeshBasicMaterial();
		source.userData.jewel = { family: 'jewelry-matcap' };
		expect(() => createEditorMaterialPreview(fixture(), {}, source)).toThrow('conflict');
	});
});
