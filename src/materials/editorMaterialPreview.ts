import {
	AdditiveBlending,
	Color,
	MeshBasicMaterial,
	MeshStandardMaterial,
	MultiplyBlending,
	NoColorSpace,
	SRGBColorSpace,
	Vector4,
	type Material,
	type Texture,
} from 'three';

type Role = 'D' | 'N' | 'M';

interface Sampling {
	parameter?: string
	path?: string
	srgb: boolean
	uv: number
	transform: [number, number, number, number]
}

export interface EditorMaterialPreview {
	family: 'editor-material-1'
	version: 1
	color: [number, number, number]
	opacity: number
	roughness: number
	alpha: { role: 'D' | 'M'; channel: 'r' | 'g' | 'b' | 'a' }[]
	vertexColor: 'none' | 'rgb' | 'rgba' | 'alpha'
	textures?: Partial<Record<Role, string>>
	sampling: Partial<Record<Role, Sampling>>
	omitDynamicOverlay?: boolean
	omissionReason?: string
}

export function readEditorMaterialPreview(value: unknown): EditorMaterialPreview | null {
	if (!value || typeof value !== 'object') return null;

	const data = value as EditorMaterialPreview;

	const tuple = (values: unknown, size: number): values is number[] =>
		Array.isArray(values) &&
		values.length === size &&
		Array.from(values).every((value) => typeof value === 'number' && Number.isFinite(value));

	if (
		data.family !== 'editor-material-1' ||
		data.version !== 1 ||
		!tuple(data.color, 3) ||
		data.color.some((value) => value < 0) ||
		!Number.isFinite(data.opacity) ||
		data.opacity < 0 ||
		!Number.isFinite(data.roughness) ||
		data.roughness < 0 ||
		data.roughness > 1 ||
		!['none', 'rgb', 'rgba', 'alpha'].includes(data.vertexColor) ||
		!data.sampling ||
		typeof data.sampling !== 'object' ||
		!Array.isArray(data.alpha) ||
		data.alpha.length > 2 ||
		Object.keys(data.sampling).length > 3
	) return null;
	if (data.omitDynamicOverlay !== undefined && typeof data.omitDynamicOverlay !== 'boolean') return null;
	if (
		data.omitDynamicOverlay &&
		(data.opacity !== 0 || Object.keys(data.sampling).length || data.alpha.length)
	) return null;

	for (const [role, sample] of Object.entries(data.sampling)) {
		if (
			!['D', 'N', 'M'].includes(role) ||
			!sample ||
			typeof sample.srgb !== 'boolean' ||
			((role === 'N' || role === 'M') && sample.srgb) ||
			!Number.isInteger(sample.uv) ||
			sample.uv < 0 ||
			sample.uv > 2 ||
			!tuple(sample.transform, 4) ||
			sample.transform[0] <= 0 ||
			sample.transform[1] <= 0
		) return null;
	}

	if (
		data.alpha.some(
			(alpha) =>
				!alpha ||
				!['D', 'M'].includes(alpha.role) ||
				!'rgba'.includes(alpha.channel) ||
				alpha.channel.length !== 1 ||
				!data.sampling[alpha.role],
		)
	) return null;

	return data;
}

/** Authored D/N and explicit coverage on normal editor geometry. Complex native
 * lighting/animation is intentionally outside this static web preview. */
export function createEditorMaterialPreview(preview: EditorMaterialPreview, slots: Partial<Record<Role, Texture | null>>, source: Material): MeshBasicMaterial | MeshStandardMaterial {
	if (!readEditorMaterialPreview(preview)) throw new Error('[EditorPreview] invalid source contract');
	if (
		source.userData.nncloth ||
		source.userData.nnclothPreview ||
		source.userData.jewel ||
		source.userData.cabinetStatic
	) throw new Error('[EditorPreview] specialized material and generic preview conflict');

	const owned: Texture[] = [];
	const textures: Partial<Record<Role, Texture>> = {};
	try {
		for (const [key, sampling] of Object.entries(preview.sampling)) {
			const role = key as Role;
			const input = slots[role];
			if (
				!input ||
				'isCubeTexture' in input ||
				'isDataArrayTexture' in input ||
				'isCompressedArrayTexture' in input
			) throw new Error(`[EditorPreview] source 2D ${role} missing`);

			const texture = input.clone();
			texture.colorSpace = sampling.srgb ? SRGBColorSpace : NoColorSpace;
			texture.channel = sampling.uv;
			texture.repeat.set(sampling.transform[0], sampling.transform[1]);
			texture.offset.set(sampling.transform[2], sampling.transform[3]);
			texture.center.set(0, 0);
			texture.rotation = 0;
			texture.matrixAutoUpdate = true;
			texture.updateMatrix();
			texture.needsUpdate = true;
			textures[role] = texture;
			owned.push(texture);
		}
	} catch (error) {
		owned.forEach((texture) => texture.dispose());
		throw error;
	}

	const render = source.userData.render as { unlit?: boolean; blend?: string } | undefined;
	const material =
		render?.unlit || preview.omitDynamicOverlay
			? new MeshBasicMaterial({ map: textures.D ?? null })
			: new MeshStandardMaterial({
				map: textures.D ?? null,
				normalMap: textures.N ?? null,
				roughness: preview.roughness,
				metalness: 0,
			});
	material.name = source.name;
	material.userData = { ...source.userData, editorPreview: preview };
	material.color = new Color().setRGB(...preview.color);
	material.opacity = preview.opacity;
	material.side = source.side;
	material.transparent = preview.omitDynamicOverlay === true || source.transparent;
	material.depthWrite = !material.transparent;
	material.depthTest = source.depthTest;
	material.alphaTest = preview.omitDynamicOverlay ? 0 : source.alphaTest;
	material.blending = source.blending;
	switch (render?.blend) {
	case 'additive':
		material.blending = AdditiveBlending;
		material.transparent = true;
		material.depthWrite = false;
		break;
	case 'modulate':
		material.blending = MultiplyBlending;
		material.transparent = true;
		material.depthWrite = false;
		break;
	}

	material.toneMapped = source.toneMapped;
	material.visible = source.visible;
	material.vertexColors = preview.vertexColor !== 'none';
	if (material instanceof MeshStandardMaterial && source instanceof MeshStandardMaterial)
		material.normalScale.copy(source.normalScale);

	const checked = new WeakSet<object>();
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		if (checked.has(geometry)) return;

		for (const sample of Object.values(preview.sampling)) {
			if (geometry.getAttribute(sample.uv ? `uv${sample.uv}` : 'uv')?.itemSize !== 2) throw new Error('[EditorPreview] declared source UV missing');
		}

		const colorSize = geometry.getAttribute('color')?.itemSize;
		if (preview.vertexColor !== 'none' && colorSize !== 3 && colorSize !== 4) throw new Error('[EditorPreview] declared source color missing');
		if (['rgba', 'alpha'].includes(preview.vertexColor) && colorSize !== 4) throw new Error('[EditorPreview] source vertex alpha missing');

		checked.add(geometry);
	};

	const roles = [...new Set(preview.alpha.map((alpha) => alpha.role))];
	material.customProgramCacheKey = () =>
		`editor-material-2:${JSON.stringify({
			alpha: preview.alpha,
			uv: roles.map((role) => [role, preview.sampling[role]!.uv]),
			vertex: preview.vertexColor,
		})}`;
	material.onBeforeCompile = (shader) => {
		const declarations: string[] = [];
		const vertex: string[] = [];
		const fragment: string[] = [];
		const factors: string[] = [];
		const channels = new Set<number>();
		for (const role of roles) {
			const sample = preview.sampling[role];
			if (!sample) throw new Error('[EditorPreview] alpha resource missing');

			channels.add(sample.uv);
			shader.uniforms[`editorAlpha${role}`] = { value: textures[role] };
			declarations.push(`varying vec2 vEditorAlpha${role};`);
			shader.uniforms[`editorAlphaTransform${role}`] = { value: new Vector4(...sample.transform) };
			declarations.push(`uniform vec4 editorAlphaTransform${role};`);
			vertex.push(`vEditorAlpha${role}=${sample.uv ? `uv${sample.uv}` : 'uv'}*editorAlphaTransform${role}.xy+editorAlphaTransform${role}.zw;`);
			fragment.push(`uniform sampler2D editorAlpha${role};`);
		}

		for (const alpha of preview.alpha)
			factors.push(`texture2D(editorAlpha${alpha.role},vEditorAlpha${alpha.role}).${alpha.channel}`);

		const attrs = [...channels]
			.filter((channel) => channel > 0)
			.map((channel) => `#ifndef USE_UV${channel}\nattribute vec2 uv${channel};\n#endif`);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>\n${declarations.join('\n')}\n${attrs.join('\n')}`,
			)
			.replace('#include <uv_vertex>', `#include <uv_vertex>\n${vertex.join('\n')}`);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			`#include <common>\n${declarations.join('\n')}\n${fragment.join('\n')}`,
		);
		if (preview.vertexColor === 'alpha')
			shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '');

		if (preview.vertexColor === 'rgb')
			shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', 'diffuseColor.rgb*=vColor.rgb;');
		// Coverage is declared explicitly; an empty list must not inherit map alpha.
		const alpha = `diffuseColor.a=opacity${factors.map((factor) => `*${factor}`).join('')}${['alpha', 'rgba'].includes(preview.vertexColor) ? '*vColor.a' : ''};`;
		shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `${alpha}\n#include <alphatest_fragment>`);
	};
	material.addEventListener('dispose', () => owned.forEach((texture) => texture.dispose()));
	return material;
}
