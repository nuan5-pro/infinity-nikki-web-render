import { describe, expect, it } from 'vitest';
import { DoubleSide, MeshBasicMaterial, ShaderLib, Texture } from 'three';
import {
	createEditorMaterialPreview,
	type EditorMaterialPreview,
} from '../../src/materials/editorMaterialPreview.js';

function pattern(): EditorMaterialPreview {
	return {
		family: 'editor-material-1',
		version: 1,
		sourcePath: '/Game/UI/SysHome/VFX/Mat/Other/MI_Other_XGL_tuan5.MI_Other_XGL_tuan5',
		color: [0, 1, 0.985587],
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
				path: '/Game/UI/SysHome/VFX/Tex/Other/T_Other_011_XGL.T_Other_011_XGL',
				srgb: true,
				uv: 0,
				transform: [1, 1, 0, 0],
			},
			M: {
				parameter: 'Alpha',
				path: '/Game/Assets/VFX/Materials/MT/T_1x1.T_1x1',
				srgb: false,
				uv: 0,
				transform: [1, 1, 0, 0],
			},
		},
		approximation:
			'Source-bound lightweight ice pattern; RGBA Base alpha and independent mask, no native IR claim',
	};
}

function source() {
	const material = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
	material.userData.render = { blend: 'translucent', unlit: true };
	return material;
}

describe('ice pattern ordinary preview', () => {
	it('multiplies authored Base A, independent mask G and scalar coverage once', () => {
		const input = source();
		const d = new Texture();
		const m = new Texture();
		const material = createEditorMaterialPreview(pattern(), { D: d, M: m }, input);

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
		};

		material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], undefined as never);
		expect(material).toBeInstanceOf(MeshBasicMaterial);
		expect(material.opacity).toBe(0.1);
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);
		expect(material.side).toBe(DoubleSide);
		expect(shader.fragmentShader).toContain(
			'diffuseColor.a=opacity*texture2D(editorAlphaD,vEditorAlphaD).a*texture2D(editorAlphaM,vEditorAlphaM).g;',
		);
		expect(shader.fragmentShader.match(/diffuseColor.a=opacity/g)).toHaveLength(1);
		expect(material.color.toArray()).toEqual([0, 1, 0.985587]);
		material.dispose();
		input.dispose();
		d.dispose();
		m.dispose();
	});

	it('retains the authored transparent-zero filler without deleting its geometry or material', () => {
		const input = source();

		const preview = {
			...pattern(),
			sourcePath: '/Game/UI/SysHome/VFX/Mat/Other/MI_Other_None_XGL.MI_Other_None_XGL',
			color: [1, 1, 1] as [number, number, number],
			opacity: 0,
			alpha: [],
			textures: {},
			sampling: {},
		};

		const material = createEditorMaterialPreview(preview, {}, input);
		expect(material.opacity).toBe(0);
		expect(material.visible).toBe(true);
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);
		expect(material.map).toBeNull();
		material.dispose();
		input.dispose();
	});
});
