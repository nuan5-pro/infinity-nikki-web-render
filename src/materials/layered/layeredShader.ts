import {
	Color,
	LinearFilter,
	LinearMipmapLinearFilter,
	LinearMipmapNearestFilter,
	MeshStandardMaterial,
	MirroredRepeatWrapping,
	ClampToEdgeWrapping,
	NearestFilter,
	NearestMipmapNearestFilter,
	NoColorSpace,
	RepeatWrapping,
	ShaderChunk,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4,
	type Material,
	type Texture,
} from 'three';
import {
	createLayeredVCHeightMaterial,
	validLayeredVCHeight,
	type LayeredVCHeight,
} from './layeredVCHeightShader.js';
import {
	rockHomeCore,
	rockHomeUniforms,
	validLayeredRockHome,
	type LayeredRockHome,
} from './layeredRockHomeShader.js';
import {
	rockTopLayerCore,
	rockTopLayerUniforms,
	rockTopLayerValues,
	validRockTopLayer,
	type LayeredRockTopLayer,
} from './rockTopLayerFoliageShader.js';
import {
	validRockProjectionEditor,
	type RockProjectionEditorConfig,
} from './layeredRockProjectionEditorShader.js';
import { createRockProjectionEditorMaterial } from './rockProjectionEditorMaterial.js';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

export type LayeredRole =
	| 'D'
	| 'N'
	| 'O'
	| 'T'
	| 'D1'
	| 'N1'
	| 'O1'
	| 'B'
	| 'C'
	| 'M'
	| 'T1'
	| 'D2'
	| 'N2'
	| 'O2';

type Pair = [number, number];

type RGB = [number, number, number];

type RGBA = [number, number, number, number];

export interface LayeredTexture {
	key: string;
	slice: number;
	srgb: boolean;
	mipmaps: boolean;
	filter: 'TF_Default' | 'TF_Bilinear' | 'TF_Trilinear' | 'TF_Nearest';
	addressX: 'TA_Wrap' | 'TA_Clamp' | 'TA_Mirror';
	addressY: 'TA_Wrap' | 'TA_Clamp' | 'TA_Mirror';
	sampler: 'view-world-wrap' | 'texture-asset';
	constant?: RGBA;
}

export interface LayeredLayer {
	uv: RGBA;
	transform: RGBA;
	normalUv: RGBA;
	color: RGB;
	albedo: RGB;
	normalEncoding: 'rg' | 'native-rgb';
	normalIntensity: number;
	roughness: Pair;
	ao: number;
}

export interface LayeredRock {
	mainNormalIntensity: number;
	detailNormalUv: RGBA;
	detailNormalTiling: number;
	detailNormalIntensity: number;
	macroAmount: number;
	macroBlend: number;
	macroTiling: number;
	maskUv: RGBA;
	maskIntensity: RGBA;
	maskColor: [RGB, RGB, RGB, RGB];
	maskRoughness: RGBA;
	macroRoughness: number;
	useRoughness: number;
	useMetallic: number;
}

export interface FurnitureLayered {
	family: 'layered-static';
	version: 1;
	mode:
		| 'scene-pattern'
		| 'terrain-height'
		| 'rock-vertex'
		| 'rock-projection'
		| 'vc-height-2'
		| 'rock-home'
		| 'rock-top-layer';
	textures: Partial<Record<LayeredRole, LayeredTexture>>;
	layers: [LayeredLayer, LayeredLayer];
	requiredUv: number[];
	uvFallback: 'local-last-channel' | 'none';
	colorMask: boolean;
	colorSource?: 'local-vf-null-white';
	blend: RGBA;
	edge: RGB;
	vertexChannel: RGBA;
	metalness: Pair;
	ao: Pair;
	specular: number;
	useOrm: number;
	emissive: [RGB, RGB];
	coverage?: 'diffuse-alpha';
	cutoff?: number;
	rock?: LayeredRock;
	projection?: LayeredProjection;
	vcHeight?: LayeredVCHeight;
	rockHome?: LayeredRockHome;
	rockTop?: LayeredRockTopLayer;
}

export interface LayeredProjection {
	editor?: RockProjectionEditorConfig;
	worldFrame: 'CUE Gltf.SwapYZ(position*0.01f)';
	rotations: Pair;
	control: [RGBA, RGBA];
	desaturation: Pair;
	baseNormalIntensity: number;
	mask: RGBA;
	top: RGBA;
	topColor: RGB;
	topDesaturation: number;
	maskControl: RGBA;
	orientation: RGB;
	moss: number;
	curvature: RGB;
	curvatureColor: RGB;
	baseColorIntensity: number;
	topRoughness: number;
	topAO: number;
	rockAO: Pair;
	topSpecular: number;
}

const roles: LayeredRole[] = [
	'D',
	'N',
	'O',
	'T',
	'D1',
	'N1',
	'O1',
	'B',
	'C',
	'M',
	'T1',
	'D2',
	'N2',
	'O2',
];

const finiteArray = (value: unknown, count: number): value is number[] =>
	Array.isArray(value) &&
	value.length === count &&
	value.every((component) => typeof component === 'number' && Number.isFinite(component));

export function readFurnitureLayered(value: unknown): FurnitureLayered | null {
	if (!value || typeof value !== 'object') return null;

	const config = value as FurnitureLayered;
	if (
		config.family !== 'layered-static' ||
		config.version !== 1 ||
		![
			'scene-pattern',
			'terrain-height',
			'rock-vertex',
			'rock-projection',
			'vc-height-2',
			'rock-home',
			'rock-top-layer',
		].includes(config.mode)
	) return null;

	const nullWhite =
		['rock-projection', 'rock-top-layer'].includes(config.mode) &&
		config.colorSource === 'local-vf-null-white';
	if (config.colorSource !== undefined && !nullWhite) return null;
	if (
		typeof config.colorMask !== 'boolean' ||
		config.colorMask !== (!nullWhite && config.mode !== 'scene-pattern')
	) return null;
	if (
		!Array.isArray(config.requiredUv) ||
		!config.requiredUv.includes(0) ||
		config.requiredUv.some((index) => !Number.isInteger(index) || index < 0 || index > 3)
	) return null;
	if (
		config.uvFallback !==
		(config.mode === 'terrain-height' ||
		config.mode === 'rock-projection' ||
		config.mode === 'rock-top-layer' ||
		config.mode === 'vc-height-2' ||
		config.mode === 'rock-home'
			? 'none'
			: 'local-last-channel')
	) return null;

	for (const [key, count] of [
		['blend', 4],
		['edge', 3],
		['vertexChannel', 4],
		['metalness', 2],
		['ao', 2],
	] as const) {
		if (!finiteArray(config[key], count)) return null;
	}

	if (!Number.isFinite(config.specular) || !Number.isFinite(config.useOrm)) return null;
	if (
		!Array.isArray(config.layers) ||
		config.layers.length !== 2 ||
		!Array.isArray(config.emissive) ||
		config.emissive.length !== 2
	) return null;

	for (const layer of config.layers) {
		if (
			!layer ||
			!['rg', 'native-rgb'].includes(layer.normalEncoding) ||
			!Number.isFinite(layer.normalIntensity) ||
			!Number.isFinite(layer.ao)
		) return null;

		for (const [key, count] of [
			['uv', 4],
			['normalUv', 4],
			['transform', 4],
			['color', 3],
			['albedo', 3],
			['roughness', 2],
		] as const) {
			if (!finiteArray(layer[key], count)) return null;
		}

		if (layer.normalEncoding !== (config.mode === 'terrain-height' ? 'native-rgb' : 'rg')) return null;
	}

	if (!config.emissive.every((color) => finiteArray(color, 3))) return null;
	if (!config.textures || typeof config.textures !== 'object') return null;

	for (const [role, texture] of Object.entries(config.textures)) {
		if (
			!roles.includes(role as LayeredRole) ||
			!texture ||
			typeof texture.key !== 'string' ||
			!texture.key ||
			!Number.isInteger(texture.slice) ||
			texture.slice < -1 ||
			texture.slice > 2 ||
			typeof texture.srgb !== 'boolean' ||
			typeof texture.mipmaps !== 'boolean' ||
			!['TF_Default', 'TF_Bilinear', 'TF_Trilinear', 'TF_Nearest'].includes(texture.filter) ||
			!['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(texture.addressX) ||
			!['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(texture.addressY) ||
			!['view-world-wrap', 'texture-asset'].includes(texture.sampler) ||
			(texture.constant !== undefined && !finiteArray(texture.constant, 4))
		) return null;
	}

	const mandatory: LayeredRole[] =
		config.mode === 'scene-pattern'
			? ['D', 'N', 'O', 'D1', 'N1', 'O1', 'T', 'T1']
			: config.mode === 'vc-height-2'
				? ['D', 'N', 'O', 'D1', 'N1', 'O1', 'B', 'C']
				: config.mode === 'terrain-height'
					? ['D', 'N', 'O', 'D1', 'N1', 'O1', 'B']
					: config.mode === 'rock-home'
						? ['D', 'N', 'O', 'N1', 'D2', 'N2', 'O2']
						: config.mode === 'rock-top-layer'
							? ['D', 'N', 'O', 'N1', 'M', 'D2', 'N2', 'O2']
							: config.mode === 'rock-projection'
								? ['D', 'N', 'O', 'D1', 'N1', 'O1', 'D2', 'N2', 'O2', 'B', 'C', 'M']
								: ['D', 'N', 'O', 'D1', 'N1', 'N2', 'B', 'C', 'M'];
	if (mandatory.some((role) => !config.textures[role])) return null;

	for (const [index, layer] of config.layers.entries()) {
		const colorRoles: LayeredRole[] = index === 0 ? ['D', 'O', 'T'] : ['D1', 'O1', 'T1'];
		const activeColor = colorRoles.some((role) => config.textures[role] && !config.textures[role]!.constant);
		const normal = config.textures[index === 0 ? 'N' : 'N1']!;
		if (
			(activeColor &&
				layer.uv.some((weight, index) => weight !== 0 && !config.requiredUv.includes(index))) ||
			(!normal.constant &&
				layer.normalUv.some((weight, index) => weight !== 0 && !config.requiredUv.includes(index)))
		) return null;
	}

	if (
		config.coverage !== undefined &&
		(config.coverage !== 'diffuse-alpha' ||
			config.mode !== 'scene-pattern' ||
			config.cutoff !== 0.3333)
	) return null;
	if (!config.coverage && config.cutoff !== undefined) return null;

	if (config.mode === 'rock-vertex' || config.mode === 'rock-top-layer') {
		const rock = config.rock;
		if (
			!rock ||
			!finiteArray(rock.detailNormalUv, 4) ||
			!finiteArray(rock.maskUv, 4) ||
			!finiteArray(rock.maskIntensity, 4) ||
			!finiteArray(rock.maskRoughness, 4) ||
			!Array.isArray(rock.maskColor) ||
			rock.maskColor.length !== 4 ||
			!rock.maskColor.every((color) => finiteArray(color, 3))
		) return null;
		if (
			rock.detailNormalUv.some((weight, index) => weight !== 0 && !config.requiredUv.includes(index)) ||
			rock.maskUv.some((weight, index) => weight !== 0 && !config.requiredUv.includes(index)) ||
			(rock.macroAmount !== 0 && !config.requiredUv.includes(2))
		) return null;

		for (const key of [
			'mainNormalIntensity',
			'detailNormalTiling',
			'detailNormalIntensity',
			'macroAmount',
			'macroBlend',
			'macroTiling',
			'macroRoughness',
			'useRoughness',
			'useMetallic',
		] as const) {
			if (!Number.isFinite(rock[key])) return null;
		}
	} else if (config.rock !== undefined) return null;

	if (config.mode === 'rock-projection') {
		const p = config.projection;
		if (
			!p ||
			p.worldFrame !== 'CUE Gltf.SwapYZ(position*0.01f)' ||
			config.requiredUv.length !== 1 ||
			config.requiredUv[0] !== 0 ||
			!Array.isArray(p.control) ||
			p.control.length !== 2 ||
			!p.control.every((value) => finiteArray(value, 4))
		) return null;
		if (
			p.editor !== undefined &&
			(!validRockProjectionEditor(p.editor) ||
				!config.textures.T ||
				config.textures.T.key !== 'T Detail Normal' ||
				config.textures.T.srgb ||
				config.textures.T.sampler !== 'texture-asset')
		) return null;

		for (const [key, count] of [
			['rotations', 2],
			['desaturation', 2],
			['mask', 4],
			['top', 4],
			['topColor', 3],
			['maskControl', 4],
			['orientation', 3],
			['curvature', 3],
			['curvatureColor', 3],
			['rockAO', 2],
		] as const) {
			if (!finiteArray(p[key], count)) return null;
		}

		for (const key of [
			'baseNormalIntensity',
			'topDesaturation',
			'moss',
			'baseColorIntensity',
			'topRoughness',
			'topAO',
			'topSpecular',
		] as const) {
			if (!Number.isFinite(p[key])) return null;
		}

		for (const [role, slice] of [
			['D2', 0],
			['N2', 1],
			['O2', 2],
		] as const) {
			if (config.textures[role]?.slice !== slice) return null;
		}
	} else if (config.projection !== undefined) return null;

	if (config.mode === 'vc-height-2' ? !validLayeredVCHeight(config) : config.vcHeight !== undefined) return null;
	if (config.mode === 'rock-home' ? !validLayeredRockHome(config) : config.rockHome !== undefined) return null;

	if (config.mode === 'rock-top-layer') {
		if (
			!validRockTopLayer(config.rockTop) ||
			!nullWhite ||
			config.requiredUv.length !== 1 ||
			config.requiredUv[0] !== 0 ||
			config.rock?.macroAmount !== 0
		) return null;

		for (const [role, slice] of [
			['D2', 0],
			['N2', 1],
			['O2', 2],
		] as const) {
			if (config.textures[role]?.slice !== slice || config.textures[role]?.srgb) return null;
		}
	} else if (config.rockTop !== undefined) return null;

	return config;
}

/** Actual two-layer consumers share one PBR pass and source TBN. Original COLOR
 * is a separate mask attribute; stock instance color still owns highlighting.
 * textures contains the exact already-selected array slice for each role.
 */
export function createLayeredMaterial(config: FurnitureLayered, inputs: Partial<Record<LayeredRole, Texture | null>>, source: Material): MeshStandardMaterial {
	if (
		config.mode === 'rock-vertex' &&
		(!config.textures.N2 ||
			!Number.isFinite(config.rock?.mainNormalIntensity) ||
			!Number.isFinite(config.rock?.detailNormalIntensity) ||
			!Number.isFinite(config.rock?.detailNormalTiling) ||
			!finiteArray(config.rock?.detailNormalUv, 4))
	) throw new Error('Rock vertex material lacks the authored Detail normal stack; regenerate its material contract');
	if (config.mode === 'vc-height-2') return createLayeredVCHeightMaterial(config, inputs, source);
	if (config.mode === 'rock-projection' && config.projection?.editor) return createRockProjectionEditorMaterial(config, inputs, source);

	const worldFrame = config.projection?.worldFrame ?? config.rockHome?.worldFrame ?? config.rockTop?.worldFrame;
	const owned: Partial<Record<LayeredRole, Texture>> = {};
	for (const role of roles) {
		const descriptor = config.textures[role];
		if (!descriptor || descriptor.constant) continue;
		const texture = inputs[role];
		if (!texture) throw new Error(`Layered core requires native ${role}: ${descriptor.key}[${descriptor.slice}]`);

		const clone = texture.clone();
		clone.colorSpace = descriptor.srgb ? SRGBColorSpace : NoColorSpace;
		clone.channel = 0;

		const wrap = (address: LayeredTexture['addressX']) =>
			address === 'TA_Clamp'
				? ClampToEdgeWrapping
				: address === 'TA_Mirror'
					? MirroredRepeatWrapping
					: RepeatWrapping;

		clone.wrapS = wrap(descriptor.addressX);
		clone.wrapT = wrap(descriptor.addressY);
		clone.repeat.set(1, 1);
		clone.offset.set(0, 0);
		clone.center.set(0, 0);
		clone.rotation = 0;
		clone.matrixAutoUpdate = true;
		clone.updateMatrix();
		clone.magFilter = descriptor.filter === 'TF_Nearest' ? NearestFilter : LinearFilter;
		clone.minFilter =
			descriptor.filter === 'TF_Nearest'
				? descriptor.mipmaps
					? NearestMipmapNearestFilter
					: NearestFilter
				: !descriptor.mipmaps
					? LinearFilter
					: descriptor.filter === 'TF_Bilinear'
						? LinearMipmapNearestFilter
						: LinearMipmapLinearFilter;
		clone.generateMipmaps = descriptor.mipmaps;
		clone.needsUpdate = true;
		owned[role] = clone;
	}

	if (!owned.D) throw new Error('Layered core requires its base diffuse texture');

	const material = new MeshStandardMaterial({
		color: new Color(1, 1, 1),
		map: owned.D,
		normalMap: owned.N ?? owned.D,
		aoMap: owned.O ?? owned.D,
		roughness: 1,
		metalness: 1,
		vertexColors: false,
		transparent: false,
		opacity: 1,
		alphaTest: config.coverage ? config.cutoff! : 0,
		side: source.side,
		forceSinglePass: true,
	});
	material.name = source.name;
	material.userData = { ...source.userData, layered: config };
	material.depthTest = source.depthTest;
	material.colorWrite = source.colorWrite;
	material.toneMapped = source.toneMapped;
	material.visible = source.visible;

	const standard = source as MeshStandardMaterial;
	if (standard.isMeshStandardMaterial) {
		material.normalScale.set(standard.normalScale.x < 0 ? -1 : 1, standard.normalScale.y < 0 ? -1 : 1);
		material.flatShading = standard.flatShading;
	}

	material.defines = Object.fromEntries(config.requiredUv.filter((index) => index !== 0).map((index) => [`USE_UV${index}`, '']));

	const checked = new WeakSet<object>();
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		if (checked.has(geometry)) return;

		for (const index of config.requiredUv) {
			const key = index === 0 ? 'uv' : `uv${index}`;
			if (!geometry.getAttribute(key)) throw new Error(`Layered core requires original ${key}`);
		}

		if (config.colorMask && geometry.getAttribute('ueLayerColor')?.itemSize !== 4) throw new Error(
			'Layered core requires verified native RGBA ueLayerColor',
		);

		if (worldFrame) {
			const proof = geometry.userData.ueLayerWorldFrameProof;
			if (
				!geometry.getAttribute('normal') ||
				geometry.getAttribute('tangent')?.itemSize !== 4 ||
				!proof ||
				proof.coordinateTransform !== worldFrame ||
				proof.sourceNativeIndex !== '_UE_VERTEX_INDEX' ||
				proof.positionMatched !== true ||
				proof.basisMatched !== true ||
				proof.mismatches !== 0
			) throw new Error('Projection core requires a verified native position/normal/tangent frame');
		}

		if (config.colorSource === 'local-vf-null-white') {
			const proofs = geometry.userData.ueLayerNullWhiteProofs;
			if (
				!Array.isArray(proofs) ||
				proofs.length === 0 ||
				proofs.some((proof) => proof.sourceVertexColorCount !== 0 || proof.sourceVertexColorSource !== 'absent')
			) throw new Error('Projection null-white requires admitted source sections without a native COLOR buffer');
		}

		checked.add(geometry);
	};
	material.addEventListener('dispose', () => Object.values(owned).forEach((texture) => texture.dispose()));

	const declarations = roles
		.filter((role) => owned[role])
		.map((role) => `uniform sampler2D layered${role};`)
		.join('\n');

	const sample = (role: LayeredRole, uv: string): string => {
		const descriptor = config.textures[role];
		if (!descriptor) throw new Error(`Missing Layered consumer ${role}`);

		return descriptor.constant
			? `vec4(${descriptor.constant.map((value) => value.toFixed(12)).join(', ')})`
			: `texture2D(layered${role}, ${uv})`;
	};

	const uvDecl = config.requiredUv.map((index) => `varying vec2 vLayerUv${index};`).join('\n');
	const uvAssign = config.requiredUv
		.map((index) => `vLayerUv${index} = ${index === 0 ? 'uv' : `uv${index}`};`)
		.join('\n');
	const uvFunction = `vec2 layeredUv(vec4 weights) { return ${config.requiredUv.map((index) => `vLayerUv${index} * weights.${'xyzw'[index]}`).join(' + ')}; }`;
	const colorDecl = config.colorMask
		? 'varying vec4 vLayerColor;'
		: config.colorSource === 'local-vf-null-white'
			? 'const vec4 vLayerColor = vec4(1.0);'
			: '';
	const projectionDecl = worldFrame
		? `
varying vec3 vLayerWorldPosition;
varying vec3 vLayerWorldNormal;
varying vec3 vLayerWorldTangent;
varying vec3 vLayerWorldBitangent;
varying vec3 vLayerObjectOrientation;
varying vec2 vLayerObjectScale;
varying float vLayerWorldParity;
${config.rockHome ? 'varying float vLayerNativeHandedness;' : ''}
${nativeWorldFrameGLSL}`
		: '';
	const uniforms = `
uniform vec4 layerUv[2];
uniform vec4 layerNormalUv[2];
uniform vec4 layerTransform[2];
uniform vec3 layerColor[2];
uniform vec3 layerAlbedo[2];
uniform vec2 layerNormalIntensity;
uniform vec2 layerRoughness[2];
uniform vec2 layerAO;
uniform vec4 layerBlend;
uniform vec3 layerEdge;
uniform vec4 layerVertexChannel;
uniform vec2 layeredMetalness;
uniform vec2 layeredAO;
uniform float layeredSpecular;
uniform float layeredUseORM;
uniform vec3 layerEmissive[2];
vec3 layeredNormal;
float layeredRoughness;
float layeredMetal;
float layeredOcclusion;
vec3 layeredEmission;`;
	const helpers = `
${uvFunction}
vec3 layeredRG(vec4 sampleValue, float intensity, float zIntensity) {
  vec2 rg = sampleValue.rg * 2.0 - 1.0;
  return vec3(rg * intensity, sqrt(max(1.0 - dot(rg * zIntensity, rg * zIntensity), 0.0)));
}
vec3 layeredRNM(vec3 base, vec3 overlay) {
  vec3 t = base + vec3(0.0, 0.0, 1.0);
  vec3 u = overlay * vec3(-1.0, -1.0, 1.0);
  return t * dot(t, u) - u * t.z;
}
vec3 layeredAlbedo(vec3 value, vec3 tint, vec3 controls) {
  float gray = dot(value, vec3(0.3, 0.59, 0.11));
  return pow(max(mix(vec3(gray), value, controls.x) * controls.y * tint, vec3(0.0)), vec3(controls.z));
}
vec3 layeredSrgbDecode(vec3 value) {
  return mix(value / 12.92, pow(max((value + 0.055) / 1.055, vec3(0.0)), vec3(2.4)), step(vec3(0.04045), value));
}
float layeredContrast(float value, float contrast) { return clamp(value * (1.0 + 2.0 * contrast) - contrast, 0.0, 1.0); }
`;
	const samples =
		config.mode === 'rock-home' || config.mode === 'rock-top-layer'
			? ''
			: `
vec2 layerUv0 = layeredUv(layerUv[0]) * layerTransform[0].xy + layerTransform[0].zw;
vec2 layerUv1 = layeredUv(layerUv[1]) * layerTransform[1].xy + layerTransform[1].zw;
vec2 layerNormalUV0 = ${config.mode === 'rock-vertex' ? 'vLayerUv0' : 'layeredUv(layerNormalUv[0]) * layerTransform[0].xy + layerTransform[0].zw'};
vec2 layerNormalUV1 = layeredUv(layerNormalUv[1]) * layerTransform[1].xy + layerTransform[1].zw;
vec4 layerD0 = ${sample('D', 'layerUv0')};
vec4 layerD1 = ${sample('D1', 'layerUv1')};
vec4 layerN0 = ${sample('N', 'layerNormalUV0')};
vec4 layerN1 = ${sample('N1', 'layerNormalUV1')};
${
	config.mode === 'rock-vertex'
		? `vec2 layerNormalUV01 = layeredUv(rockDetailNormalUv) * rockDetailNormalTiling;
vec4 layerN01 = ${sample('N2', 'layerNormalUV01')};`
		: ''
}
vec4 layerO0 = ${sample('O', 'layerUv0')};`;
	let core: string;
	switch (config.mode) {
	case 'rock-top-layer':
		core = rockTopLayerCore(sample);
		break;
	case 'rock-home':
		core = rockHomeCore(sample);
		break;
	case 'scene-pattern':
		core = `${samples}
vec4 layerO1 = ${sample('O1', 'layerUv1')};
vec3 baseColor = layerD0.rgb * layerColor[0];
vec3 patternColor = mix(layerD1.rgb, baseColor * layerD1.rgb, clamp(layerBlend.x - 1.0, 0.0, 1.0));
diffuseColor.rgb = clamp(mix(baseColor, patternColor, layerD1.a * clamp(layerBlend.x, 0.0, 1.0)), 0.0, 1.0);
vec3 baseNormal = layeredRG(layerN0, layerNormalIntensity.x, 1.0);
vec3 flattenedBase = mix(vec3(0.0, 0.0, 1.0), baseNormal, layerBlend.z);
vec3 patternNormal = layeredRG(layerN1, layerNormalIntensity.y, clamp(layerNormalIntensity.y, 0.0, 1.0));
layeredNormal = mix(baseNormal, layeredRNM(flattenedBase, patternNormal), layerD1.a);
float baseRoughness = mix(layerRoughness[0].x, layerRoughness[0].y, layerO0.g);
layeredRoughness = clamp(mix(baseRoughness, 1.0 - layerO1.g, layerD1.a * layerBlend.w), 0.0, 1.0);
layeredMetal = clamp(mix(mix(layeredMetalness.x, layeredMetalness.y, layerO0.b), mix(layerO1.r, layerO1.b, layeredUseORM), layerD1.a * layerBlend.w), 0.0, 1.0);
layeredOcclusion = clamp(mix(layeredAO.x, layeredAO.y, layerO0.r), 0.0, 1.0);
vec4 emission0 = ${sample('T', 'vLayerUv0')};
vec4 emission1 = ${sample('T1', 'layerUv1')};
layeredEmission = max(emission0.rgb * emission0.a * layerEmissive[0] + emission1.rgb * emission1.a * layerEmissive[1], vec3(0.0));`;
		break;
	case 'terrain-height':
		core = `${samples}
vec4 layerO1 = ${sample('O1', 'layerUv1')};
vec4 edgeSample = ${sample('B', 'vLayerUv0 * layerEdge.x')};
float blendHeight = mix(1.0 - clamp(layerO0.b, 0.0, 1.0), layerO1.b, layerBlend.x) * layerBlend.y;
blendHeight = mix(blendHeight, 1.0 - blendHeight, layerBlend.w);
float edgeValue = layeredContrast(edgeSample.r, layerEdge.y) * layerEdge.z * 0.5;
float vertexValue = dot(vLayerColor, layerVertexChannel);
float layerWeight = layeredContrast(clamp(blendHeight * (1.0 + edgeValue) - 1.0 + vertexValue * 2.0, 0.0, 1.0), layerBlend.z);
vec3 albedo0 = layeredAlbedo(layerD0.rgb, layerColor[0], layerAlbedo[0]);
vec3 albedo1 = layeredAlbedo(layerD1.rgb, layerColor[1], layerAlbedo[1]);
diffuseColor.rgb = clamp(layeredSrgbDecode(mix(albedo0, albedo1, layerWeight)), 0.0, 1.0);
// Array slice 1 is authored RGB normal, not an RG reconstruction.
vec3 normal0 = (layerN0.rgb * 2.0 - 1.0) * vec3(layerNormalIntensity.x, layerNormalIntensity.x, 1.0);
vec3 normal1 = (layerN1.rgb * 2.0 - 1.0) * vec3(layerNormalIntensity.y, layerNormalIntensity.y, 1.0);
layeredNormal = mix(normal0, normal1, layerWeight);
layeredRoughness = clamp(mix(mix(layerRoughness[0].x, layerRoughness[0].y, layerO0.g), mix(layerRoughness[1].x, layerRoughness[1].y, layerO1.g), layerWeight), 0.0, 1.0);
layeredMetal = 0.0;
layeredOcclusion = clamp(mix(layerAO.x, layerAO.y, layerWeight), 0.0, 1.0);
layeredEmission = vec3(0.0);`;
		break;
	case 'rock-vertex':
		core = `${samples}
vec4 edgeSample = ${sample('B', 'vLayerUv0 * layerEdge.x')};
float edgeValue = (layeredContrast(edgeSample.g, layerEdge.y) - 0.5) * 2.0 * layerEdge.z;
float vertexG = vLayerColor.g;
float layerWeight = clamp(vertexG + edgeValue * (1.0 - vertexG) * vertexG * 4.0, 0.0, 1.0);
vec3 baseColor = mix(layerD0.rgb * layerColor[0], layerD1.rgb * layerColor[1], layerWeight);
vec4 macroSample = ${sample('C', config.requiredUv.includes(2) ? 'vLayerUv2 * rockMacroTiling' : 'vec2(0.0)')};
float macroWeight = clamp(macroSample.a * rockMacroAmount, 0.0, 1.0);
vec3 macroColor = mix(baseColor, vec3(1.0), rockMacroBlend) * macroSample.rgb;
baseColor = mix(baseColor, macroColor, macroWeight);
vec4 tintSample = ${sample('M', 'layeredUv(rockMaskUv)')};
vec4 tintWeight = tintSample * rockMaskIntensity;
baseColor = mix(baseColor, rockMaskColor[0], tintWeight.r);
baseColor = mix(baseColor, rockMaskColor[1], tintWeight.g);
baseColor = mix(baseColor, rockMaskColor[2], tintWeight.b);
baseColor = mix(baseColor, rockMaskColor[3], tintWeight.a);
diffuseColor.rgb = clamp(baseColor, 0.0, 1.0);
vec3 mainNormal = layeredRG(layerN0, rockMainNormalIntensity, 1.0);
vec3 normal0 = layeredRNM(mainNormal, layeredRG(layerN01, rockDetailNormalIntensity, 1.0));
vec3 normal1 = layeredRG(layerN1, layerNormalIntensity.y, 1.0);
layeredNormal = mix(normal0, layeredRNM(normal0, normal1), layerWeight);
float roughness1 = mix(1.0, layerO0.g, rockUseRoughness);
float roughValue = mix(layerO0.g, roughness1, layerWeight) + macroWeight * rockMacroRoughness;
roughValue *= mix(1.0, rockMaskRoughness.r, tintWeight.r);
roughValue *= mix(1.0, rockMaskRoughness.g, tintWeight.g);
roughValue *= mix(1.0, rockMaskRoughness.b, tintWeight.b);
roughValue *= mix(1.0, rockMaskRoughness.a, tintWeight.a);
layeredRoughness = clamp(roughValue, 0.0, 1.0);
layeredMetal = clamp(layerO0.b * rockUseMetallic * (1.0 - layerWeight), 0.0, 1.0);
layeredOcclusion = clamp(layerO0.r, 0.0, 1.0);
layeredEmission = vec3(0.0);`;
		break;
	case 'rock-projection':
		core = `
vec2 projectionUv0 = layeredRotate(vLayerUv0 * vLayerObjectScale * layerTransform[0].xy, projectionRotations.x);
vec2 projectionUv1 = layeredRotate(vLayerUv0 * vLayerObjectScale * layerTransform[1].xy, projectionRotations.y);
vec2 projectionMaskUV = layeredRotate(vLayerUv0 * projectionMask.x, projectionMask.y);
vec4 projectionMaskSample = ${sample('B', 'projectionMaskUV')};
float innerWeight = clamp(projectionMaskSample.g * (1.0 + 2.0 * projectionMask.z) - projectionMask.z, 0.0, 1.0) * projectionMask.w;
vec4 projectionBaseMask = ${sample('C', 'vLayerUv0')};
vec3 baseN = layeredRG(${sample('M', 'vLayerUv0')}, projectionBaseNormalIntensity, 1.0);
vec3 n0 = layeredRG(${sample('N', 'projectionUv0')}, 1.0, 1.0);
vec3 n1 = layeredRG(${sample('N1', 'projectionUv1')}, 1.0, 1.0);
n0 = mix(vec3(0.0, 0.0, 1.0), n0, layerNormalIntensity.x);
n1 = mix(vec3(0.0, 0.0, 1.0), n1, layerNormalIntensity.y);
vec3 innerN = mix(vec3(baseN.xy + n0.xy, baseN.z * n0.z), vec3(baseN.xy + n1.xy, baseN.z * n1.z), innerWeight);
vec3 sourceN = normalize(vLayerWorldNormal);
vec3 sourceT = normalize(vLayerWorldTangent);
vec3 sourceB = normalize(vLayerWorldBitangent);
vec3 innerWorldN = sourceT * innerN.x + sourceB * innerN.y + sourceN * innerN.z;
vec3 effectiveWorldN = normalize(mix(sourceN, innerWorldN, projectionOrientation.x));
vec3 orientation = normalize(mix(vLayerObjectOrientation, vec3(0.0, 0.0, 1.0), projectionOrientation.y));
float topAngle = ((dot(effectiveWorldN, orientation) + sourceN.z * projectionOrientation.z + 1.0) * 0.5 + 1.0) * 0.5;
float topWeight = mix(projectionMaskControl.x, projectionMaskControl.y, topAngle) * vLayerColor.r;
topWeight = clamp(topWeight * (1.0 + 2.0 * projectionMaskControl.z) - projectionMaskControl.z, 0.0, 1.0);
topWeight = clamp((topWeight + projectionBaseMask.g * projectionMaskControl.w) * projectionBaseMask.a * projectionMoss, 0.0, 1.0);
// Reference PS mixes native UE-world XY (1/800 cm) with UV0, then scales.
vec2 projectionTopUV = mix(vLayerWorldPosition.xy * 0.00125, vLayerUv0, projectionTop.y) * projectionTop.x;
vec3 topN = ${sample('N2', 'projectionTopUV')}.rgb * 2.0 - 1.0;
topN = mix(topN, layeredRNM(sourceN, topN), projectionTop.w);
vec3 topTangentN = vec3(dot(sourceT, topN), dot(sourceB, topN), dot(sourceN, topN));
topTangentN.xy *= projectionTop.z;
layeredNormal = normalize(mix(innerN, topTangentN, topWeight));
vec3 c0 = ${sample('D', 'projectionUv0')}.rgb * layerColor[0];
vec3 c1 = ${sample('D1', 'projectionUv1')}.rgb * layerColor[1];
c0 = mix(c0, vec3(dot(c0, vec3(0.3, 0.59, 0.11))), projectionDesaturation.x);
c1 = mix(c1, vec3(dot(c1, vec3(0.3, 0.59, 0.11))), projectionDesaturation.y);
vec3 innerColor = mix(c0, c1, innerWeight);
float curvatureValue = projectionBaseMask.r > 0.0 ? pow(projectionBaseMask.r, projectionCurvature.y) * projectionCurvature.x : 0.0;
innerColor = mix(innerColor, curvatureValue * projectionCurvatureColor, curvatureValue * projectionCurvature.z);
vec3 topColor = ${sample('D2', 'projectionTopUV')}.rgb * projectionTopColor;
topColor = mix(topColor, vec3(dot(topColor, vec3(0.3, 0.59, 0.11))), projectionTopDesaturation);
topColor = layeredSrgbDecode(topColor);
vec3 finalColor = mix(innerColor, topColor, topWeight);
diffuseColor.rgb = clamp(mix(finalColor, finalColor * projectionBaseColorIntensity, projectionMaskSample.b), 0.0, 1.0);
vec4 or0 = ${sample('O', 'projectionUv0')};
vec4 or1 = ${sample('O1', 'projectionUv1')};
vec4 or2 = ${sample('O2', 'projectionTopUV')};
layeredMetal = clamp(mix(or0.b * projectionControl[0].g, or1.b * projectionControl[1].g, innerWeight) * (1.0 - topWeight), 0.0, 1.0);
layeredRoughness = clamp(mix(mix(or0.g * projectionControl[0].r, or1.g * projectionControl[1].r, innerWeight), or2.g * projectionTopRoughness, topWeight), 0.0, 1.0);
float ao0 = clamp(mix(projectionControl[0].b, projectionControl[0].a, or0.r), 0.0, 1.0);
float ao1 = clamp(mix(projectionControl[1].b, projectionControl[1].a, or1.r), 0.0, 1.0);
layeredOcclusion = clamp(mix(mix(ao0, ao1, innerWeight), projectionTopAO, topWeight) * mix(projectionRockAO.x, projectionRockAO.y, projectionBaseMask.b), 0.0, 1.0);
layeredEmission = max(mix(layerEmissive[0], layerEmissive[1], projectionMaskSample.a), vec3(0.0));
layeredSpecularValue = mix(0.5, projectionTopSpecular, topWeight);`;
		break;
	}

	const rockUniforms = config.rock
		? `
uniform float rockMainNormalIntensity;
uniform vec4 rockDetailNormalUv;
uniform float rockDetailNormalTiling;
uniform float rockDetailNormalIntensity;
uniform float rockMacroAmount;
uniform float rockMacroBlend;
uniform float rockMacroTiling;
uniform vec4 rockMaskUv;
uniform vec4 rockMaskIntensity;
uniform vec3 rockMaskColor[4];
uniform vec4 rockMaskRoughness;
uniform float rockMacroRoughness;
uniform float rockUseRoughness;
uniform float rockUseMetallic;`
		: '';
	const projectionUniforms = config.projection
		? `
uniform vec2 projectionRotations;
uniform vec4 projectionControl[2];
uniform vec2 projectionDesaturation;
uniform float projectionBaseNormalIntensity;
uniform vec4 projectionMask;
uniform vec4 projectionTop;
uniform vec3 projectionTopColor;
uniform float projectionTopDesaturation;
uniform vec4 projectionMaskControl;
uniform vec3 projectionOrientation;
uniform float projectionMoss;
uniform vec3 projectionCurvature;
uniform vec3 projectionCurvatureColor;
uniform float projectionBaseColorIntensity;
uniform float projectionTopRoughness;
uniform float projectionTopAO;
uniform vec2 projectionRockAO;
uniform float projectionTopSpecular;
vec2 layeredRotate(vec2 uv, float turns) {
  vec2 centered = uv - 0.5;
  float a = turns * 6.2831854820251465;
  return vec2(dot(centered, vec2(cos(a), -sin(a))), dot(centered, vec2(sin(a), cos(a)))) + 0.5;
}`
		: '';
	material.onBeforeCompile = (shader) => {
		for (const role of roles)
			if (owned[role]) shader.uniforms[`layered${role}`] = { value: owned[role] };

		shader.uniforms.layerUv = { value: config.layers.map((layer) => new Vector4(...layer.uv)) };
		shader.uniforms.layerNormalUv = {
			value: config.layers.map((layer) => new Vector4(...layer.normalUv)),
		};
		shader.uniforms.layerTransform = {
			value: config.layers.map((layer) => new Vector4(...layer.transform)),
		};
		shader.uniforms.layerColor = {
			value: config.layers.map((layer) => new Vector3(...layer.color)),
		};
		shader.uniforms.layerAlbedo = {
			value: config.layers.map((layer) => new Vector3(...layer.albedo)),
		};
		shader.uniforms.layerNormalIntensity = {
			value: new Vector2(config.layers[0].normalIntensity, config.layers[1].normalIntensity),
		};
		shader.uniforms.layerRoughness = {
			value: config.layers.map((layer) => new Vector2(...layer.roughness)),
		};
		shader.uniforms.layerAO = { value: new Vector2(config.layers[0].ao, config.layers[1].ao) };
		shader.uniforms.layerBlend = { value: new Vector4(...config.blend) };
		shader.uniforms.layerEdge = { value: new Vector3(...config.edge) };
		shader.uniforms.layerVertexChannel = { value: new Vector4(...config.vertexChannel) };
		shader.uniforms.layeredMetalness = { value: new Vector2(...config.metalness) };
		shader.uniforms.layeredAO = { value: new Vector2(...config.ao) };
		shader.uniforms.layeredSpecular = { value: config.specular };
		shader.uniforms.layeredUseORM = { value: config.useOrm };
		shader.uniforms.layerEmissive = { value: config.emissive.map((color) => new Vector3(...color)) };
		if (config.rock) {
			const rock = config.rock;
			for (const key of [
				'mainNormalIntensity',
				'detailNormalTiling',
				'detailNormalIntensity',
				'macroAmount',
				'macroBlend',
				'macroTiling',
				'macroRoughness',
				'useRoughness',
				'useMetallic',
			] as const) {
				shader.uniforms[`rock${key[0]!.toUpperCase()}${key.slice(1)}`] = { value: rock[key] };
			}

			shader.uniforms.rockDetailNormalUv = { value: new Vector4(...rock.detailNormalUv) };
			shader.uniforms.rockMaskUv = { value: new Vector4(...rock.maskUv) };
			shader.uniforms.rockMaskIntensity = { value: new Vector4(...rock.maskIntensity) };
			shader.uniforms.rockMaskColor = {
				value: rock.maskColor.map((color) => new Vector3(...color)),
			};
			shader.uniforms.rockMaskRoughness = { value: new Vector4(...rock.maskRoughness) };
		}

		if (config.projection) {
			const p = config.projection;
			for (const [key, value] of Object.entries(p)) {
				if (key === 'worldFrame' || key === 'editor') continue;
				let uniformValue: number | Vector2 | Vector3 | Vector4 | Vector4[];
				if (key === 'control') uniformValue = p.control.map((v) => new Vector4(...v));
				else if (Array.isArray(value)) {
					uniformValue =
						value.length === 2
							? new Vector2(value[0], value[1])
							: value.length === 3
								? new Vector3(value[0], value[1], value[2])
								: new Vector4(value[0], value[1], value[2], value[3]);
				} else uniformValue = value;

				shader.uniforms[`projection${key[0]!.toUpperCase()}${key.slice(1)}`] = {
					value: uniformValue,
				};
			}
		}

		if (config.rockHome) {
			for (const [key, value] of Object.entries(config.rockHome)) {
				if (key === 'worldFrame') continue;
				shader.uniforms[`home${key[0]!.toUpperCase()}${key.slice(1)}`] = {
					value: Array.isArray(value) ? new Vector3(...value) : value,
				};
			}
		}

		if (config.rockTop) Object.assign(shader.uniforms, rockTopLayerValues(config.rockTop));
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>\n${uvDecl}\n${colorDecl}\n${projectionDecl}\n${config.colorMask ? 'attribute vec4 ueLayerColor;' : ''}`,
			)
			.replace(
				'#include <uv_vertex>',
				`#include <uv_vertex>\n${uvAssign}\n${config.colorMask ? 'vLayerColor = ueLayerColor;' : ''}`,
			);
		if (worldFrame) {
			shader.vertexShader = shader.vertexShader
				.replace(
					'#include <defaultnormal_vertex>',
					`#include <defaultnormal_vertex>
mat4 layerWorldMatrix = modelMatrix;
#ifdef USE_INSTANCING
layerWorldMatrix = layerWorldMatrix * instanceMatrix;
#endif
#ifdef USE_BATCHING
layerWorldMatrix = layerWorldMatrix * batchingMatrix;
#endif
// Baked mirrors already changed tangent.w. Only the unbaked world determinant
// remains (including the editor's parent Y mirror); do not reflect it twice.
vLayerWorldParity = sign(dot(cross(layerWorldMatrix[0].xyz, layerWorldMatrix[1].xyz), layerWorldMatrix[2].xyz));
mat3 layerWorldAxes = furnitureUnscaledBasis(layerWorldMatrix);
vLayerWorldNormal = furnitureNativeWorld(layerWorldAxes * objectNormal);
#ifdef USE_TANGENT
vLayerWorldTangent = furnitureNativeWorld(layerWorldAxes * objectTangent);
vLayerWorldBitangent = cross(vLayerWorldNormal, vLayerWorldTangent) * (vLayerWorldParity * tangent.w);
${config.rockHome ? 'vLayerNativeHandedness = vLayerWorldParity * tangent.w;' : ''}
#endif`,
				)
				.replace(
					'#include <project_vertex>',
					`#include <project_vertex>
vLayerWorldPosition = furnitureNativeWorld((layerWorldMatrix * vec4(transformed, 1.0)).xyz);
vLayerObjectOrientation = normalize(furnitureNativeWorld((layerWorldMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz));
vLayerObjectScale = vec2(length(layerWorldMatrix[1].xyz), length(layerWorldMatrix[0].xyz));`,
				);
		}

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>\n${uvDecl}\n${colorDecl}\n${projectionDecl}\n${declarations}\n${uniforms}\n${rockUniforms}\n${helpers}\n${projectionUniforms}\n${config.rockHome ? rockHomeUniforms : ''}\n${config.rockTop ? rockTopLayerUniforms : ''}`,
			)
			.replace(
				'#include <map_fragment>',
				`float layeredSpecularValue = layeredSpecular;\n${core}\ndiffuseColor.a = ${config.coverage ? 'layerD0.a' : '1.0'};`,
			)
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = layeredRoughness;')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = layeredMetal;')
			.replace(
				'#include <normal_fragment_maps>',
				ShaderChunk.normal_fragment_maps.replace(
					'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
					// Every layer/constant keeps original native channels during RG/RGB
					// decode and RNM. Reflect once at the exporter-to-glTF TBN boundary.
					worldFrame
						? 'vec3 mapN = layeredNormal; mapN.y *= -vLayerWorldParity;'
						: 'vec3 mapN = layeredNormal; mapN.y = -mapN.y;',
				),
			)
			.replace(
				'#include <emissivemap_fragment>',
				`totalEmissiveRadiance = layeredEmission;
#if defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)
totalEmissiveRadiance *= vColor;
#endif`,
			)
			.replace(
				'#include <aomap_fragment>',
				ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'layeredOcclusion'),
			)
			.replace(
				'#include <lights_physical_fragment>',
				ShaderChunk.lights_physical_fragment.replace(
					'material.specularColor = vec3( 0.04 );',
					'material.specularColor = vec3(0.08 * clamp(layeredSpecularValue, 0.0, 1.0));',
				),
			);
	};
	material.customProgramCacheKey = () =>
		`furniture_layered_v1_${config.mode}_${!!config.coverage}_${config.requiredUv.join('')}_${roles.map((role) => config.textures[role]?.constant?.join(',') ?? (owned[role] ? 'sample' : '')).join(';')}${worldFrame ? '_native_world_cm_parity_v3' : ''}${config.rockHome ? '_rock_home_capture_v1' : ''}${config.rock ? '_three_normal_stack_v2' : ''}`;
	return material;
}
