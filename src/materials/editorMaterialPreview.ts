import {
	AdditiveBlending,
	Color,
	MeshBasicMaterial,
	MeshStandardMaterial,
	MultiplyBlending,
	NoColorSpace,
	SRGBColorSpace,
	Vector2,
	Vector4,
	type Material,
	type Texture,
} from 'three';
import { applyFoliageNormals } from './foliage/foliageNormals.js';

type Role = 'D' | 'N' | 'M' | 'O' | 'T';

interface Sampling {
	parameter?: string;
	path?: string;
	srgb: boolean;
	uv: number;
	transform: [number, number, number, number];
}

export interface EditorMaterialPreview {
	family: 'editor-material-1';
	version: 1;
	color: [number, number, number];
	opacity: number;
	roughness: number;
	specular?: number;
	alpha: { role: 'D' | 'M'; channel: 'r' | 'g' | 'b' | 'a' }[];
	vertexColor: 'none' | 'rgb' | 'rgba' | 'alpha';
	textures?: Partial<Record<Role, string>>;
	sampling: Partial<Record<Role, Sampling>>;
	omitDynamicOverlay?: boolean;
	gradient?: { grid: [number, number]; params: [number, number, number, number] };
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
		Object.keys(data.sampling).length > 4
	) return null;
	if (data.omitDynamicOverlay !== undefined && typeof data.omitDynamicOverlay !== 'boolean') return null;
	if (data.specular !== undefined && (!Number.isFinite(data.specular) || data.specular < 0 || data.specular > 1)) return null;
	if (
		data.omitDynamicOverlay &&
		(data.opacity !== 0 || Object.keys(data.sampling).length || data.alpha.length)
	) return null;

	for (const [role, sample] of Object.entries(data.sampling)) {
		if (
			!['D', 'N', 'M', 'O', 'T'].includes(role) ||
			!sample ||
			typeof sample.srgb !== 'boolean' ||
			((role === 'N' || role === 'M' || role === 'O') && sample.srgb) ||
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
	if (data.gradient) {
		if (!tuple(data.gradient.grid, 2) || data.gradient.grid[0] < 1 || data.gradient.grid[1] <= 0 ||
			!tuple(data.gradient.params, 4) || data.gradient.params[1] < 0 || !data.sampling.T || !data.sampling.O) return null;
	} else if (data.sampling.T || data.sampling.O) return null;

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
				(('isDataArrayTexture' in input || 'isCompressedArrayTexture' in input) &&
					!['raw', 'raw-mod25', 'raw-div25'].includes(input.userData.paperLayer))
			) throw new Error(`[EditorPreview] source ${role} requires a 2D texture or declared Paper array`);

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
		if (preview.gradient) {
			for (const channel of [0, ...(preview.gradient.params[0] !== 1 ? [2] : []), ...(preview.gradient.params[0] !== 0 ? [3] : [])]) {
				if (geometry.getAttribute(channel ? `uv${channel}` : 'uv')?.itemSize !== 2) throw new Error('[EditorPreview] gradient source UV missing');
			}
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
			gradient: preview.gradient,
			specular: preview.specular !== undefined,
		})}`;
	material.onBeforeCompile = (shader) => {
		if (preview.specular !== undefined && material instanceof MeshStandardMaterial) {
			shader.uniforms.editorSpecular = { value: preview.specular };
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nuniform float editorSpecular;')
				.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= editorSpecular; material.specularF90 *= editorSpecular;');
		}
		const declarations: string[] = [];
		const vertex: string[] = [];
		const fragment: string[] = [];
		const factors: string[] = [];
		const channels = new Set<number>();
		if (preview.gradient) {
			const gradient = preview.gradient;
			channels.add(0);
			if (gradient.params[0] !== 1) channels.add(2);
			if (gradient.params[0] !== 0) channels.add(3);
			shader.uniforms.editorGradientMap = { value: textures.T };
			shader.uniforms.editorGradientMask = { value: textures.O };
			shader.uniforms.editorGradientGrid = { value: new Vector2(...gradient.grid) };
			shader.uniforms.editorGradientParams = { value: new Vector4(...gradient.params) };
			shader.uniforms.editorGradientMaskTransform = { value: new Vector4(...preview.sampling.O!.transform) };
			shader.uniforms.foliageRaw = { value: 0 };
			declarations.push('varying vec2 vEditorGradientUv; varying float vEditorGradientWeight;');
			vertex.push(`vEditorGradientUv=uv; vEditorGradientWeight=mix(${gradient.params[0] !== 1 ? 'uv2.y' : '0.0'},${gradient.params[0] !== 0 ? 'uv3.y' : '0.0'},${gradient.params[0].toFixed(8)});`);
			fragment.push('uniform sampler2D editorGradientMap, editorGradientMask; uniform vec2 editorGradientGrid; uniform vec4 editorGradientParams, editorGradientMaskTransform; uniform float foliageRaw;');
			shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
float editorColumns=floor(editorGradientGrid.x);
vec2 editorCell=vec2(mod(foliageRaw,editorColumns),floor(foliageRaw/editorColumns));
vec2 editorAtlasUv=editorCell/editorGradientGrid+vEditorGradientUv/(editorGradientGrid*vec2(1.0,2.0));
vec3 editorA=texture2D(editorGradientMap,editorAtlasUv).rgb;
vec3 editorB=texture2D(editorGradientMap,editorAtlasUv+vec2(0.0,1.0/(2.0*editorGradientGrid.y))).rgb;
float editorWeight=vEditorGradientWeight>0.0?min(pow(vEditorGradientWeight,editorGradientParams.y),1.0):0.0;
editorWeight+=(1.0-2.0*editorWeight)*editorGradientParams.z;
vec3 editorPalette=mix(mix(editorA,editorB,editorWeight),vEditorGradientUv.x<=0.5?editorA:editorB,editorGradientParams.w);
float editorLuma=dot(diffuseColor.rgb,vec3(0.299,0.587,0.114));
vec3 editorOverlay=mix(2.0*editorPalette*editorLuma,1.0-2.0*(1.0-editorPalette)*(1.0-editorLuma),step(vec3(0.5),editorPalette));
float editorMask=texture2D(editorGradientMask,vEditorGradientUv*editorGradientMaskTransform.xy+editorGradientMaskTransform.zw).a;
diffuseColor.rgb=clamp(mix(diffuseColor.rgb,editorOverlay,editorMask),0.0,1.0);`);
		}
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
	return applyFoliageNormals(material);
}
