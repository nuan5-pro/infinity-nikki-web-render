import {
	Color,
	MeshStandardMaterial,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector3,
	Vector4,
	type Material,
	type Texture,
} from 'three';

export interface NNClothPreview {
	family: 'nncloth-simple-1';
	version: 1;
	color: [number, number, number];
	patternColor: [number, number, number];
	patternUV: [number, number, number];
	patternTiling: [number, number, number, number];
	patternBlend: number;
	roughness: number;
	alphaCutoff: number;
	masked: boolean;
}

export function readNNClothPreview(value: unknown): NNClothPreview | null {
	if (!value || typeof value !== 'object') return null;

	const data = value as Record<string, unknown>;

	const tuple = (key: string, size: number) => {
		const values = data[key];
		return (
			Array.isArray(values) &&
			values.length === size &&
			Array.from(values).every((component) => typeof component === 'number' && Number.isFinite(component))
		);
	};

	if (
		data.family !== 'nncloth-simple-1' ||
		data.version !== 1 ||
		typeof data.masked !== 'boolean' ||
		!tuple('color', 3) ||
		!tuple('patternColor', 3) ||
		!tuple('patternUV', 3) ||
		!tuple('patternTiling', 4)
	) return null;

	for (const key of ['patternBlend', 'roughness', 'alphaCutoff']) {
		const number = data[key];
		if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1) return null;
	}

	const uv = data.patternUV as [number, number, number];
	const tiling = data.patternTiling as [number, number, number, number];
	if (
		uv.some((value) => value < 0) ||
		uv.reduce((sum, value) => sum + value, 0) !== 1 ||
		tiling[0] <= 0 ||
		tiling[1] <= 0
	) return null;

	return value as NNClothPreview;
}

/** Three material samplers: authored base, base normal and the alpha-bearing
 * decorative layer. Geometry, lighting and transforms use the normal editor. */
export function createNNClothPreviewMaterial(
	preview: NNClothPreview,
	slots: Partial<Record<'D' | 'N' | 'D1', Texture | null>>,
	source: Material,
): MeshStandardMaterial {
	if (source.userData.nncloth) throw new Error('[NNClothPreview] native and editor preview contracts conflict');

	const owned: Texture[] = [];

	const texture = (role: 'D' | 'N' | 'D1') => {
		const input = slots[role];
		if (
			!input ||
			'isCubeTexture' in input ||
			'isDataArrayTexture' in input ||
			'isCompressedArrayTexture' in input
		) throw new Error(`[NNClothPreview] original 2D ${role} input missing`);

		const result = input.clone();
		result.colorSpace = role === 'N' ? NoColorSpace : SRGBColorSpace;
		result.channel = 0;
		result.wrapS = result.wrapT = RepeatWrapping;
		result.repeat.set(1, 1);
		result.offset.set(0, 0);
		result.center.set(0, 0);
		result.rotation = 0;
		result.matrixAutoUpdate = true;
		result.updateMatrix();
		result.needsUpdate = true;
		owned.push(result);
		return result;
	};

	let material: MeshStandardMaterial;
	let pattern: Texture;
	try {
		const main = texture('D');
		const normal = texture('N');
		pattern = texture('D1');
		material = new MeshStandardMaterial({
			color: new Color().setRGB(...preview.color),
			map: main,
			normalMap: normal,
			roughness: preview.roughness,
			metalness: 0,
			transparent: false,
			depthWrite: true,
			alphaTest: preview.masked ? preview.alphaCutoff : 0,
			side: source.side,
		});
	} catch (error) {
		owned.forEach((texture) => texture.dispose());
		throw error;
	}

	if (source instanceof MeshStandardMaterial) {
		material.normalScale.copy(source.normalScale);
		material.flatShading = source.flatShading;
	}

	material.name = source.name;
	material.visible = source.visible;
	material.depthTest = source.depthTest;
	material.colorWrite = source.colorWrite;
	material.toneMapped = source.toneMapped;
	material.userData = { ...source.userData, nnclothPreview: preview };

	const channels = preview.patternUV.flatMap((weight, channel) => (weight > 0 ? [channel] : []));
	const checkedGeometries = new WeakSet<object>();
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		if (checkedGeometries.has(geometry)) return;

		for (const channel of channels) {
			const name = channel === 0 ? 'uv' : `uv${channel}`;
			if (geometry.getAttribute(name)?.itemSize !== 2) throw new Error(`[NNClothPreview] source ${name} missing`);
		}

		checkedGeometries.add(geometry);
	};
	// Only UV weights are emitted as GLSL literals. Palette, tiling, blend and
	// roughness are uniforms; their values must not split identical programs.
	material.customProgramCacheKey = () => `nncloth-simple-2:${JSON.stringify(preview.patternUV)}`;
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, {
			nnPreviewPattern: { value: pattern },
			nnPreviewTint: { value: new Vector3(...preview.patternColor) },
			nnPreviewTiling: { value: new Vector4(...preview.patternTiling) },
			nnPreviewBlend: { value: preview.patternBlend },
		});

		const uv = preview.patternUV
			.flatMap((weight, channel) => weight > 0 ? [`${channel === 0 ? 'uv' : `uv${channel}`}*${weight.toFixed(8)}`] : [],
			)
			.join('+');
		const declarations = channels
			.filter((channel) => channel !== 0)
			.map((channel) => `#ifndef USE_UV${channel}\nattribute vec2 uv${channel};\n#endif`)
			.join('\n');
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>\nvarying vec2 vNNPreviewUV;\nuniform vec4 nnPreviewTiling;\n${declarations}`,
			)
			.replace(
				'#include <uv_vertex>',
				`#include <uv_vertex>\nvNNPreviewUV=(${uv})*nnPreviewTiling.xy+nnPreviewTiling.zw;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying vec2 vNNPreviewUV;\nuniform sampler2D nnPreviewPattern;\nuniform vec3 nnPreviewTint;\nuniform float nnPreviewBlend;',
			)
			.replace(
				'#include <map_fragment>',
				`#include <map_fragment>
vec4 nnPattern=texture2D(nnPreviewPattern,vNNPreviewUV);
diffuseColor.rgb=mix(diffuseColor.rgb,nnPattern.rgb*nnPreviewTint,clamp(nnPattern.a*nnPreviewBlend,0.0,1.0));`,
			);
	};
	material.addEventListener('dispose', () => owned.forEach((texture) => texture.dispose()));
	return material;
}
