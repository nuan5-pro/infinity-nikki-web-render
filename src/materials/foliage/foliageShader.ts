import {
	DoubleSide,
	ClampToEdgeWrapping,
	DataTexture,
	HalfFloatType,
	LinearFilter,
	MeshStandardMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	RGBAFormat,
	ShaderChunk,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4,
	type Texture,
} from 'three';
import type { FurnitureRawReference } from '../../furniture/types.js';
import type { FurnitureResourceReader } from '../../resources/resources.js';

export interface FoliageCycleAtlas extends FurnitureRawReference {
	width: number;
	height: number;
	nearest: boolean;
	addressX: 'TA_Wrap' | 'TA_Clamp' | 'TA_Mirror';
	addressY: 'TA_Wrap' | 'TA_Clamp' | 'TA_Mirror';
}

interface AtlasContext {
	atlas: FoliageCycleAtlas;
	identity: string;
	expired: boolean;
	texture?: Texture;
}

const atlasContexts = new WeakMap<FoliageCycleAtlas, AtlasContext>();
const atlasOwners = new WeakMap<FurnitureResourceReader, Set<AtlasContext>>();

export async function bindFoliageCycleAtlas(atlas: FoliageCycleAtlas, resources: FurnitureResourceReader): Promise<void> {
	if (
		!atlas ||
		!/^r-[a-f0-9]{16}$/.test(atlas.resource) ||
		!Number.isSafeInteger(atlas.byteOffset) ||
		atlas.byteOffset < 0 ||
		!Number.isSafeInteger(atlas.width) ||
		!Number.isSafeInteger(atlas.height) ||
		atlas.width < 1 ||
		atlas.height < 1 ||
		atlas.width > 1024 ||
		atlas.height > 1024 ||
		atlas.byteLength !== atlas.width * atlas.height * 8 ||
		typeof atlas.nearest !== 'boolean' ||
		![atlas.addressX, atlas.addressY].every((value) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(value))
	) throw new Error('Invalid native cycle atlas descriptor/range');

	const context: AtlasContext = { atlas, identity: JSON.stringify(atlas), expired: false };
	const descriptor = { ...atlas };
	atlasContexts.set(atlas, context);

	let owned = atlasOwners.get(resources);
	if (!owned) {
		owned = new Set();
		atlasOwners.set(resources, owned);
	}

	owned.add(context);

	const key = `foliage-cycle:${context.identity}`;
	const texture = await resources.texture(key, async () => {
		const bytes = await resources.read(descriptor);
		if (bytes.byteLength !== descriptor.width * descriptor.height * 8) throw new Error('Invalid native cycle RGBA16F length');

		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const halves = new Uint16Array(bytes.byteLength / 2);
		for (let index = 0; index < halves.length; index++) {
			const half = view.getUint16(index * 2, true);
			if ((half & 0x7c00) === 0x7c00) throw new Error('Nonfinite native cycle half-float');

			halves[index] = half;
		}

		const texture = new DataTexture(halves, descriptor.width, descriptor.height, RGBAFormat, HalfFloatType);
		texture.colorSpace = NoColorSpace;
		texture.flipY = false;
		texture.generateMipmaps = false;
		texture.minFilter = texture.magFilter = descriptor.nearest ? NearestFilter : LinearFilter;

		const addresses = {
			TA_Wrap: RepeatWrapping,
			TA_Clamp: ClampToEdgeWrapping,
			TA_Mirror: MirroredRepeatWrapping,
		} as const;

		texture.wrapS = addresses[descriptor.addressX];
		texture.wrapT = addresses[descriptor.addressY];
		texture.needsUpdate = true;
		return texture;
	});
	if (context.expired || JSON.stringify(atlas) !== context.identity) throw new Error('Foliage native atlas owner expired or changed during loading');

	context.texture = texture;
}

export function cloneFoliageCycleAtlas(atlas: FoliageCycleAtlas): Texture {
	const context = atlasContexts.get(atlas);
	if (!context?.texture || context.expired || JSON.stringify(atlas) !== context.identity) throw new Error('Foliage native atlas context unavailable or changed');

	return context.texture.clone();
}

export function disposeFoliageCycleAtlases(resources: FurnitureResourceReader): void {
	for (const context of atlasOwners.get(resources) ?? []) {
		context.expired = true;
		context.texture = undefined;
		if (atlasContexts.get(context.atlas) === context) atlasContexts.delete(context.atlas);
	}

	atlasOwners.delete(resources);
}

export interface FurnitureFoliage {
	family:
		| 'foliage-3tex-v02-1'
		| 'foliage-3tex-array-v02-1'
		| 'foliage-home-st9'
		| 'foliage-home-array-st9';
	version: 1;
	mode: 'static-core-preview';
	sourceAlpha: boolean;
	home?: FurnitureFoliageHome;
	textureSRGB?: [boolean, boolean, boolean, boolean, boolean];
	nearest?: [boolean, boolean, boolean, boolean, boolean];
	color: [number, number, number];
	colorBack: [number, number, number];
	separateTint: number;
	gradient: [number, number, number];
	roughnessFront: [number, number];
	roughnessBack: [number, number];
	specular: [number, number, number, number];
	ao: [number, number];
	metallic: number;
	uvScale: number;
	normalFlatness: number;
	cutoff: number;
	emissive: [number, number, number];
	emissiveBaseColor: number;
}

export interface FurnitureFoliageHome {
	vertexMask: 'source-red';
	tintStrength: number;
	hue: number;
	opacityMask: number;
	specularTexture: boolean;
	specularConstant?: [number, number, number];
	coverage?: { mode: 'uco-static-noise-zero'; cutoff: number };
	cycle?: {
		uv: 1;
		width: number;
		nightIndex: number;
		useRaw: number;
		raw: number;
		atlas: FoliageCycleAtlas;
	};
	specularChannel: [number, number, number];
	specularUv: 3;
	specularIntensity: [number, number];
	gradient?: {
		grid: [number, number];
		params: [number, number, number, number];
		raw: number;
	};
	glow?: {
		maskConstant?: number;
		day: [[number, number, number], [number, number, number], [number, number, number]];
		night: [[number, number, number], [number, number, number], [number, number, number]];
		uvSelect: [number, number, number, number];
		tile: number;
		speeds: [number, number, number, number];
		breathSpeed: number;
		params: [number, number, number, number];
		mask: [number, number];
		textureSRGB: [boolean, boolean];
		nearest: [boolean, boolean];
	};
}

/** Geometry must provide normalized source COLOR_0.A under this distinct name.
 * It is AO/specular data, never ordinary vertex color or instance highlight.
 */
export const FOLIAGE_ALPHA_ATTRIBUTE = 'foliageAlpha';
export const FOLIAGE_RED_ATTRIBUTE = 'foliageRed';
export const FOLIAGE_GRADIENT_ATTRIBUTE = 'foliageGradientInput';
export const FOLIAGE_SPECULAR_UV_ATTRIBUTE = 'foliageSpecularUv';
export const FOLIAGE_CYCLE_U_ATTRIBUTE = 'foliageCycleU';

export function readFurnitureFoliage(value: unknown): FurnitureFoliage | null {
	if (!value || typeof value !== 'object') return null;

	const config = value as Record<string, unknown>;
	const homeFamily = config.family === 'foliage-home-st9' || config.family === 'foliage-home-array-st9';
	if (
		(!homeFamily &&
			config.family !== 'foliage-3tex-v02-1' &&
			config.family !== 'foliage-3tex-array-v02-1') ||
		config.version !== 1 ||
		config.mode !== 'static-core-preview' ||
		config.sourceAlpha !== !homeFamily
	) return null;

	const lengths: Record<string, number> = {
		color: 3,
		colorBack: 3,
		gradient: 3,
		roughnessFront: 2,
		roughnessBack: 2,
		specular: 4,
		ao: 2,
		emissive: 3,
	};

	for (const [key, length] of Object.entries(lengths)) {
		const array = config[key];
		if (
			!Array.isArray(array) ||
			array.length !== length ||
			!array.every((component) => typeof component === 'number' && Number.isFinite(component))
		) return null;
	}

	for (const key of [
		'separateTint',
		'metallic',
		'uvScale',
		'normalFlatness',
		'cutoff',
		'emissiveBaseColor',
	]) {
		if (typeof config[key] !== 'number' || !Number.isFinite(config[key])) return null;
	}

	if (config.cutoff !== 0.3333 || (config.specular as number[])[2]! < 0) return null;
	if (
		config.textureSRGB !== undefined &&
		(!Array.isArray(config.textureSRGB) ||
			config.textureSRGB.length !== 5 ||
			!config.textureSRGB.every((entry) => typeof entry === 'boolean'))
	) return null;

	if (homeFamily) {
		if (!config.home || typeof config.home !== 'object') return null;

		const home = config.home as Record<string, unknown>;
		if (
			home.vertexMask !== 'source-red' ||
			home.specularUv !== 3 ||
			typeof home.specularTexture !== 'boolean'
		) return null;

		for (const key of ['hue', 'tintStrength', 'opacityMask']) {
			if (typeof home[key] !== 'number' || !Number.isFinite(home[key])) return null;
		}

		if (
			(home.opacityMask as number) < 0 ||
			((home.opacityMask as number) === 0 && home.coverage === undefined)
		) return null;

		if (home.coverage !== undefined) {
			if (!home.coverage || typeof home.coverage !== 'object') return null;

			const coverage = home.coverage as Record<string, unknown>;
			if (
				coverage.mode !== 'uco-static-noise-zero' ||
				typeof coverage.cutoff !== 'number' ||
				!Number.isFinite(coverage.cutoff) ||
				coverage.cutoff < 0 ||
				coverage.cutoff > 1
			) return null;
		}

		if (home.cycle !== undefined) {
			if (!home.cycle || typeof home.cycle !== 'object' || home.gradient !== undefined) return null;

			const cycle = home.cycle as Record<string, unknown>;
			if (
				cycle.uv !== 1 ||
				typeof cycle.width !== 'number' ||
				!Number.isSafeInteger(cycle.width) ||
				cycle.width < 1 ||
				typeof cycle.raw !== 'number' ||
				!Number.isSafeInteger(cycle.raw) ||
				cycle.raw < 0
			) return null;

			for (const key of ['nightIndex', 'useRaw']) {
				if (typeof cycle[key] !== 'number' || !Number.isFinite(cycle[key])) return null;
			}

			const atlas = cycle.atlas as Record<string, unknown> | undefined;
			if (
				!atlas ||
				atlas.width !== cycle.width ||
				typeof atlas.height !== 'number' ||
				!Number.isSafeInteger(atlas.height) ||
				atlas.height < 1 ||
				atlas.height > 1024 ||
				(cycle.width as number) > 1024 ||
				typeof atlas.resource !== 'string' ||
				!/^r-[a-f0-9]{16}$/.test(atlas.resource) ||
				typeof atlas.byteOffset !== 'number' ||
				!Number.isSafeInteger(atlas.byteOffset) ||
				atlas.byteOffset < 0 ||
				atlas.byteLength !== (atlas.width as number) * (atlas.height as number) * 8 ||
				typeof atlas.nearest !== 'boolean'
			) return null;
			if (
				![atlas.addressX, atlas.addressY].every((address) => address === 'TA_Wrap' || address === 'TA_Clamp' || address === 'TA_Mirror')
			) return null;
		}

		for (const [key, length] of Object.entries({ specularChannel: 3, specularIntensity: 2 })) {
			const array = home[key];
			if (
				!Array.isArray(array) ||
				array.length !== length ||
				!array.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
			) return null;
		}

		if (
			home.specularConstant !== undefined &&
			(home.specularTexture !== false ||
				!Array.isArray(home.specularConstant) ||
				home.specularConstant.length !== 3 ||
				!home.specularConstant.every((entry) => typeof entry === 'number' && Number.isFinite(entry)))
		) return null;

		for (const key of ['textureSRGB', 'nearest']) {
			const array = config[key];
			if (
				!Array.isArray(array) ||
				array.length !== 5 ||
				!array.every((entry) => typeof entry === 'boolean')
			) return null;
		}

		if (home.gradient !== undefined) {
			if (!home.gradient || typeof home.gradient !== 'object') return null;

			const gradient = home.gradient as Record<string, unknown>;
			for (const [key, length] of Object.entries({ grid: 2, params: 4 })) {
				const array = gradient[key];
				if (
					!Array.isArray(array) ||
					array.length !== length ||
					!array.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
				) return null;
			}

			const grid = gradient.grid as number[];
			if (
				Math.floor(grid[0]!) < 1 ||
				grid[1]! <= 0 ||
				(gradient.params as number[])[1]! < 0 ||
				typeof gradient.raw !== 'number' ||
				!Number.isSafeInteger(gradient.raw) ||
				gradient.raw < 0
			) return null;
		}

		if (home.glow !== undefined) {
			if (!home.glow || typeof home.glow !== 'object') return null;

			const glow = home.glow as Record<string, unknown>;
			if (
				glow.maskConstant !== undefined &&
				(typeof glow.maskConstant !== 'number' || !Number.isFinite(glow.maskConstant))
			) return null;

			for (const key of ['day', 'night']) {
				const colors = glow[key];
				if (
					!Array.isArray(colors) ||
					colors.length !== 3 ||
					!colors.every(
						(color) =>
							Array.isArray(color) &&
							color.length === 3 &&
							color.every((entry) => typeof entry === 'number' && Number.isFinite(entry)),
					)
				) return null;
			}

			for (const [key, length] of Object.entries({ uvSelect: 4, speeds: 4, params: 4, mask: 2 })) {
				const array = glow[key];
				if (
					!Array.isArray(array) ||
					array.length !== length ||
					!array.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
				) return null;
			}

			for (const key of ['tile', 'breathSpeed']) {
				if (typeof glow[key] !== 'number' || !Number.isFinite(glow[key])) return null;
			}

			if (
				(glow.uvSelect as number[]).some((entry, index) => entry !== (index === 0 ? 1 : 0)) ||
				(glow.mask as number[])[0]! < 0
			) return null;

			for (const key of ['textureSRGB', 'nearest']) {
				const flags = glow[key];
				if (
					!Array.isArray(flags) ||
					flags.length !== 2 ||
					!flags.every((entry) => typeof entry === 'boolean')
				) return null;
			}
		}
	} else if (config.home !== undefined) return null;

	return value as FurnitureFoliage;
}

/** One-pass static core of the captured exact permutations, not UE foliage lighting.
 * V02 requires foliageAlpha on every consuming primitive. ST9 requires native red,
 * native selected-LOD UV provenance, and its complete 2D grid/specular resources.
 * The V02 array family receives the existing direct-dye selected Albedo Tex Array
 * slice as diffuse. Num LocalVF 77ffc... / Depth 0285... use the same rounded
 * primitive layer; its normal/mask remain 2D. ST9 selects all three actual arrays
 * independently using genuine raw and their individual native physical depths.
 */
export function createFoliageMaterial(
	config: FurnitureFoliage,
	diffuse: Texture | null,
	normal: Texture | null,
	mask: Texture | null,
	tint: Texture | null = null,
	specular: Texture | null = null,
	inputs: { glow?: Texture | null; glowMask?: Texture | null; normalEncoding?: string } = {},
): MeshStandardMaterial {
	if (!diffuse || !mask) throw new Error('Foliage core requires its compiled Albedo Tex and Mask Tex bindings');
	if (!readFurnitureFoliage(config)) throw new Error('Unsupported foliage contract');

	const home = config.home;
	const nativeNormal = !!home || inputs.normalEncoding === 'native-rg';
	if (home && !normal) throw new Error('ST9 requires its compiled normal binding');
	if (home?.gradient && !tint) throw new Error('ST9 requires its complete native gradient atlas');
	if (home?.specularTexture && !specular) throw new Error('ST9 requires its compiled UV3 specular texture');
	if (home?.glow && (!inputs.glow || (!inputs.glowMask && home.glow.maskConstant === undefined))) throw new Error('ST9 requires its compiled glow resources or proved native constant');

	// Wrappers isolate family sampling/UV state from the shared registry. The map
	// transform also gives Three's normal shadow depth path the same static cutout.
	const albedoMap = diffuse.clone();
	const maskMap = mask.clone();
	const normalMap = normal?.clone() ?? null;
	let tintMap: Texture | null = home?.gradient ? tint!.clone() : null;
	if (home?.cycle) {
		tintMap = cloneFoliageCycleAtlas(home.cycle.atlas);
	}

	const specularMap = home?.specularTexture ? specular!.clone() : null;
	const glowMap = home?.glow ? inputs.glow!.clone() : null;
	const glowMaskMap = home?.glow && home.glow.maskConstant === undefined ? inputs.glowMask!.clone() : null;
	for (const texture of [albedoMap, maskMap, normalMap]) {
		if (!texture) continue;
		texture.channel = 0;
		texture.flipY = false;
		texture.wrapS = RepeatWrapping;
		texture.wrapT = RepeatWrapping;
		texture.repeat.set(config.uvScale, config.uvScale);
		texture.offset.set(0, 0);
		texture.center.set(0, 0);
		texture.rotation = 0;
		texture.matrixAutoUpdate = true;

		const index = texture === albedoMap ? 0 : texture === normalMap ? 1 : 2;
		texture.colorSpace = (config.textureSRGB?.[index] ?? texture === albedoMap) ? SRGBColorSpace : NoColorSpace;
		if (home && config.nearest![index]) {
			texture.minFilter = NearestFilter;
			texture.magFilter = NearestFilter;
			texture.generateMipmaps = false;
		}

		texture.needsUpdate = true;
	}

	for (const [texture, index] of [
		[tintMap, 3],
		[specularMap, 4],
	] as const) {
		if (!texture) continue;
		if (home?.cycle && texture === tintMap) continue; // Native linear RGBA16F; never apply PNG transfer/mips.
		texture.flipY = false;
		texture.wrapS = RepeatWrapping;
		texture.wrapT = RepeatWrapping;
		texture.colorSpace = config.textureSRGB![index] ? SRGBColorSpace : NoColorSpace;
		if (config.nearest![index]) {
			texture.minFilter = NearestFilter;
			texture.magFilter = NearestFilter;
			texture.generateMipmaps = false;
		}

		texture.needsUpdate = true;
	}

	for (const [texture, index] of [
		[glowMap, 0],
		[glowMaskMap, 1],
	] as const) {
		if (!texture) continue;
		texture.flipY = false;
		texture.wrapS = RepeatWrapping;
		texture.wrapT = RepeatWrapping;
		texture.colorSpace = home!.glow!.textureSRGB[index] ? SRGBColorSpace : NoColorSpace;
		if (home!.glow!.nearest[index]) {
			texture.minFilter = NearestFilter;
			texture.magFilter = NearestFilter;
			texture.generateMipmaps = false;
		}

		texture.needsUpdate = true;
	}

	const material = new MeshStandardMaterial({
		map: albedoMap,
		normalMap,
		// Enable the AO integration chunk only; its texture sample is replaced below.
		aoMap: maskMap,
		aoMapIntensity: 1,
		roughness: 1,
		metalness: 0,
		side: DoubleSide,
		// Three's stock shadow/depth material copies alphaTest/map, not opacity.
		// Its quotient test is equivalent to the color pass's native alpha*factor.
		alphaTest: home ? (home.opacityMask > 0 ? config.cutoff / home.opacityMask : 2) : config.cutoff,
		opacity: home?.opacityMask ?? 1,
		transparent: false,
		depthWrite: true,
		vertexColors: false,
	});
	material.userData.foliage = config;
	material.userData.foliageRequiredAttributes = home
		? [
			FOLIAGE_RED_ATTRIBUTE,
			...(home.gradient ? [FOLIAGE_GRADIENT_ATTRIBUTE] : []),
			...(home.cycle ? [FOLIAGE_CYCLE_U_ATTRIBUTE] : []),
			...(home.specularTexture ? [FOLIAGE_SPECULAR_UV_ATTRIBUTE] : []),
		]
		: [FOLIAGE_ALPHA_ATTRIBUTE];
	material.addEventListener('dispose', () => {
		albedoMap.dispose();
		maskMap.dispose();
		normalMap?.dispose();
		tintMap?.dispose();
		specularMap?.dispose();
		glowMap?.dispose();
		glowMaskMap?.dispose();
	});

	material.onBeforeCompile = (shader) => {
		shader.uniforms.foliageMaskMap = { value: maskMap };
		shader.uniforms.foliageUvScale = { value: config.uvScale };
		shader.uniforms.foliageColor = { value: new Vector3(...config.color) };
		shader.uniforms.foliageColorBack = { value: new Vector3(...config.colorBack) };
		shader.uniforms.foliageSeparateTint = { value: config.separateTint };
		shader.uniforms.foliageGradient = { value: new Vector3(...config.gradient) };
		shader.uniforms.foliageRoughnessFront = { value: new Vector2(...config.roughnessFront) };
		shader.uniforms.foliageRoughnessBack = { value: new Vector2(...config.roughnessBack) };
		shader.uniforms.foliageSpecularRange = { value: new Vector4(...config.specular) };
		shader.uniforms.foliageAoRange = { value: new Vector2(...config.ao) };
		shader.uniforms.foliageMetallic = { value: config.metallic };
		shader.uniforms.foliageNormalFlatness = { value: config.normalFlatness };
		shader.uniforms.foliageEmissive = { value: new Vector3(...config.emissive) };
		shader.uniforms.foliageEmissiveBaseColor = { value: config.emissiveBaseColor };
		if (home) {
			shader.uniforms.foliageCoverageCutoff = { value: config.cutoff };
			if (home.coverage) shader.uniforms.foliageUcoCutoff = { value: home.coverage.cutoff };
			shader.uniforms.foliageTintStrength = { value: home.tintStrength };
			shader.uniforms.foliageHue = { value: home.hue };
			shader.uniforms.foliageSpecularChannel = { value: new Vector3(...home.specularChannel) };
			if (home.specularConstant)
				shader.uniforms.foliageSpecularConstant = { value: new Vector3(...home.specularConstant) };

			shader.uniforms.foliageSpecularMap = { value: specularMap };
			if (home.gradient) {
				shader.uniforms.foliageTintMap = { value: tintMap };
				shader.uniforms.foliageGrid = { value: new Vector2(...home.gradient.grid) };
				shader.uniforms.foliageGradientParams = { value: new Vector4(...home.gradient.params) };
				shader.uniforms.foliageRaw = { value: home.gradient.raw };
			}

			if (home.cycle) {
				shader.uniforms.foliageTintMap = { value: tintMap };
				shader.uniforms.foliageCycleParams = {
					value: new Vector4(home.cycle.width, home.cycle.nightIndex, home.cycle.useRaw, home.cycle.raw),
				};
			}

			if (home.glow) {
				shader.uniforms.foliageGlowMap = { value: glowMap };
				shader.uniforms.foliageGlowMaskMap = { value: glowMaskMap };
				shader.uniforms.foliageGlowTile = { value: home.glow.tile };
				shader.uniforms.foliageGlowColors = {
					value: home.glow.night.map((color) => new Vector3(...color)),
				};
				shader.uniforms.foliageGlowParams = { value: new Vector4(...home.glow.params) };
				shader.uniforms.foliageGlowVertexMask = { value: new Vector2(...home.glow.mask) };
				if (home.glow.maskConstant !== undefined)
					shader.uniforms.foliageGlowMaskConstant = { value: home.glow.maskConstant };
			}
		}

		const varyings = `varying vec2 vFoliageUv;
varying float vFoliageAlpha;
varying vec3 vFoliageHighlight;
${home?.gradient || home?.glow ? 'varying vec2 vFoliageOriginalUv;' : ''}
${home?.gradient ? 'varying float vFoliageGradientInput;' : ''}
${home?.specularTexture ? 'varying vec2 vFoliageSpecularUv;' : ''}`;
		const cycleVarying = home?.cycle ? 'varying float vFoliageCycleU;' : '';
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute float ${home ? 'foliageRed' : 'foliageAlpha'};
${home?.gradient ? 'attribute float foliageGradientInput;' : ''}
${home?.specularTexture ? 'attribute vec2 foliageSpecularUv;' : ''}
${home?.cycle ? 'attribute float foliageCycleU;' : ''}
uniform float foliageUvScale;
${varyings}
${cycleVarying}`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vFoliageUv = uv * foliageUvScale;
vFoliageAlpha = ${home ? 'foliageRed' : 'foliageAlpha'};
${home?.gradient || home?.glow ? 'vFoliageOriginalUv = uv;' : ''}
${home?.gradient ? 'vFoliageGradientInput = foliageGradientInput;' : ''}
${home?.specularTexture ? 'vFoliageSpecularUv = foliageSpecularUv;' : ''}
${home?.cycle ? 'vFoliageCycleU = foliageCycleU;' : ''}
vFoliageHighlight = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
vFoliageHighlight = instanceColor.rgb;
#endif`,
			);

		// V02's signed face interpolation and ST9's saturated sign are independent
		// native consumers. Parameter Front/Back labels do not swap either formula.
		const mapFragment = home
			? `
vec3 foliageAxis = vec3(0.577350);
vec3 foliageTinted = foliageAlbedo * foliageColor;
vec3 foliageParallel = foliageAxis * dot(foliageAxis, foliageTinted);
vec3 foliagePerpendicular = foliageTinted - foliageParallel;
float foliageAngle = foliageHue * 6.283185;
foliageTinted = foliageParallel + cos(foliageAngle) * foliagePerpendicular +
  sin(foliageAngle) * cross(foliageAxis, foliagePerpendicular);
foliageAlbedo = mix(foliageAlbedo, foliageTinted, foliagePacked.a * foliageTintStrength);
diffuseColor.rgb = clamp(foliageAlbedo, 0.0, 1.0);
${
	home.gradient
		? `
float foliageColumns = floor(foliageGrid.x);
vec2 foliageCell = vec2(mod(foliageRaw, foliageColumns), floor(foliageRaw / foliageColumns));
vec2 foliageAtlasUv = foliageCell / foliageGrid + vFoliageOriginalUv / (foliageGrid * vec2(1.0, 2.0));
vec3 foliageEndpointA = texture2D(foliageTintMap, foliageAtlasUv).rgb;
vec3 foliageEndpointB = texture2D(foliageTintMap, foliageAtlasUv + vec2(0.0, 1.0 / (2.0 * foliageGrid.y))).rgb;
float foliageGradientWeight = vFoliageGradientInput > 0.0 ? min(pow(vFoliageGradientInput, foliageGradientParams.y), 1.0) : 0.0;
foliageGradientWeight += (1.0 - 2.0 * foliageGradientWeight) * foliageGradientParams.z;
vec3 foliagePalette = mix(foliageEndpointA, foliageEndpointB, foliageGradientWeight);
vec3 foliageStepPalette = vFoliageOriginalUv.x <= 0.5 ? foliageEndpointA : foliageEndpointB;
foliagePalette = mix(foliagePalette, foliageStepPalette, foliageGradientParams.w);
float foliageLuma = dot(foliageAlbedo, vec3(0.299, 0.587, 0.114));
vec3 foliageLow = 2.0 * foliagePalette * foliageLuma;
vec3 foliageHigh = 1.0 - 2.0 * (1.0 - foliagePalette) * (1.0 - foliageLuma);
vec3 foliageOverlay = mix(foliageLow, foliageHigh, step(vec3(0.5), foliagePalette));
diffuseColor.rgb = clamp(mix(foliageAlbedo, foliageOverlay, foliagePacked.a), 0.0, 1.0);`
		: ''
}
${
	home.cycle
		? `
float foliageCycleIndex = mix(foliageCycleParams.y + 0.5, foliageCycleParams.w + 0.5, foliageCycleParams.z);
vec3 foliageCycleColor = texture2D(foliageTintMap, vec2(vFoliageCycleU, foliageCycleIndex / foliageCycleParams.x)).rgb;
diffuseColor.rgb = clamp(mix(foliageAlbedo, foliageAlbedo * foliageCycleColor, foliagePacked.a), 0.0, 1.0);`
		: ''
}
${
	home.specularTexture || home.specularConstant
		? `
float foliageSpecularSource = dot(${home.specularConstant ? 'foliageSpecularConstant' : 'texture2D(foliageSpecularMap, vFoliageSpecularUv).rgb'}, foliageSpecularChannel);
float foliageSpecularPower = foliageSpecularSource > 0.0 ? pow(foliageSpecularSource, foliageSpecularRange.z) : 0.0;
foliageSpecular = clamp(foliageSpecularPower * foliageSpecularRange.w, 0.0, 1.0);`
		: `
float foliageSpecularMask = mix(foliageSpecularRange.x, foliageSpecularRange.y, vFoliageAlpha);
float foliageSpecularPower = foliagePacked.b > 0.0 ? pow(foliagePacked.b, foliageSpecularRange.z) : 0.0;
foliageSpecular = clamp(foliageSpecularMask * foliageSpecularPower * foliageSpecularRange.w, 0.0, 1.0);`
}`
			: `
vec3 foliageTint = foliageColor + (foliageColorBack - foliageColor) *
  (1.0 - foliageSign) * foliageSeparateTint;
diffuseColor.rgb = clamp(foliageAlbedo * foliageTint * foliageGradient, 0.0, 1.0);
float foliageSpecularMask = mix(foliageSpecularRange.x, foliageSpecularRange.y, vFoliageAlpha);
float foliageSpecularPower = foliagePacked.b > 0.0 ? pow(foliagePacked.b, foliageSpecularRange.z) : 0.0;
foliageSpecular = clamp(foliageSpecularMask * foliageSpecularPower * foliageSpecularRange.w, 0.0, 1.0);`;

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
${varyings}
${cycleVarying}
uniform sampler2D foliageMaskMap;
uniform vec3 foliageColor;
uniform vec3 foliageColorBack;
uniform float foliageSeparateTint;
uniform vec3 foliageGradient;
uniform vec2 foliageRoughnessFront;
uniform vec2 foliageRoughnessBack;
uniform vec4 foliageSpecularRange;
uniform vec2 foliageAoRange;
uniform float foliageMetallic;
uniform float foliageNormalFlatness;
uniform vec3 foliageEmissive;
uniform float foliageEmissiveBaseColor;
${
	home
		? `uniform float foliageTintStrength;
uniform float foliageCoverageCutoff;
uniform float foliageHue;
uniform vec3 foliageSpecularChannel;
uniform sampler2D foliageSpecularMap;`
		: ''
}
${home?.specularConstant ? 'uniform vec3 foliageSpecularConstant;' : ''}
${home?.coverage ? 'uniform float foliageUcoCutoff;' : ''}
${home?.cycle ? 'uniform sampler2D foliageTintMap;\nuniform vec4 foliageCycleParams;' : ''}
${
	home?.gradient
		? `uniform sampler2D foliageTintMap;
uniform vec2 foliageGrid;
uniform vec4 foliageGradientParams;
uniform float foliageRaw;`
		: ''
}
${
	home?.glow
		? `uniform sampler2D foliageGlowMap;
uniform sampler2D foliageGlowMaskMap;
uniform float foliageGlowTile;
uniform vec3 foliageGlowColors[3];
uniform vec4 foliageGlowParams;
uniform vec2 foliageGlowVertexMask;`
		: ''
}
${home?.glow?.maskConstant !== undefined ? 'uniform float foliageGlowMaskConstant;' : ''}
vec4 foliagePacked;
float foliageSpecular;
float foliageSign;
vec3 foliageAlbedo;`,
			)
			.replace(
				'#include <map_fragment>',
				`${ShaderChunk.map_fragment.split('vMapUv').join('vFoliageUv')}
foliageAlbedo = diffuseColor.rgb;
foliagePacked = texture2D(foliageMaskMap, vFoliageUv);
foliageSign = gl_FrontFacing ? 1.0 : -1.0;
${mapFragment}`,
			)
			.replace(
				'#include <alphatest_fragment>',
				home
					? home.coverage
						? 'float foliageUcoCoverage = clamp(2.0 * (2.0 * (diffuseColor.a - 0.5) + 0.0 - 0.5), 0.0, 1.0);\nif (foliageUcoCoverage < foliageUcoCutoff) discard;'
						: 'if (diffuseColor.a < foliageCoverageCutoff) discard;'
					: '#include <alphatest_fragment>',
			)
		// Source COLOR_0 does not tint albedo or alpha. Instance colors still do.
			.replace('#include <color_fragment>', 'diffuseColor.rgb *= vFoliageHighlight;')
			.replace(
				'#include <roughnessmap_fragment>',
				`float foliageFront = mix(foliageRoughnessFront.x, foliageRoughnessFront.y, foliagePacked.r);
float foliageBack = mix(foliageRoughnessBack.x, foliageRoughnessBack.y, foliagePacked.r);
float roughnessFactor = clamp(foliageFront + ${home ? 'clamp(foliageSign, 0.0, 1.0)' : 'foliageSign'} * (foliageBack - foliageFront), 0.0, 1.0);`,
			)
			.replace(
				'#include <metalnessmap_fragment>',
				home
					? 'float metalnessFactor = 0.0;'
					: 'float metalnessFactor = clamp(foliagePacked.a * foliageMetallic, 0.0, 1.0);',
			)
			.replace(
				'#include <normal_fragment_begin>',
				ShaderChunk.normal_fragment_begin.split('vNormalMapUv').join('vFoliageUv'),
			)
			.replace(
				'#include <normal_fragment_maps>',
				ShaderChunk.normal_fragment_maps.replace(
					'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
					`vec2 foliageNormalRG = texture2D(normalMap, vFoliageUv).rg * 2.0 - 1.0;
${nativeNormal ? 'foliageNormalRG.y = -foliageNormalRG.y; // Native RG -> glTF TBN after resource transfer, exactly once.' : ''}
vec3 foliageNormal = vec3(foliageNormalRG, sqrt(max(1.0 - dot(foliageNormalRG, foliageNormalRG), 0.0)));
vec3 mapN = mix(foliageNormal * faceDirection, vec3(0.0, 0.0, 1.0), foliageNormalFlatness);`,
				),
			)
			.replace(
				'#include <emissivemap_fragment>',
				home
					? `vec3 foliageEmission = foliageEmissive * foliageAlbedo;
${
	home.glow
		? `
vec3 foliageGlowChannels = texture2D(foliageGlowMap, vFoliageOriginalUv * foliageGlowTile).rgb;
vec3 foliageGlowColor = foliageGlowChannels.r * foliageGlowColors[0] + foliageGlowChannels.g * foliageGlowColors[1] + foliageGlowChannels.b * foliageGlowColors[2];
float foliageGlowMask = ${home.glow.maskConstant !== undefined ? 'foliageGlowMaskConstant' : 'texture2D(foliageGlowMaskMap, vFoliageOriginalUv).r'};
// Native time=0: abs(fract(time*speed)-.5)*2 is exactly 1, not a guessed mean.
float foliageBreathWeight = clamp(1.0 - foliageGlowParams.z, 0.0, 1.0);
float foliageBrightness = mix(foliageGlowParams.x, foliageGlowParams.x * foliageGlowParams.y, foliageBreathWeight);
foliageEmission += foliageGlowColor * foliageGlowMask * foliageBrightness;
foliageEmission *= mix(vec3(1.0), foliageAlbedo, foliageGlowParams.w);
float foliageInverseRed = 1.0 - vFoliageAlpha;
float foliageGlowRedMask = foliageInverseRed > 0.0 ? pow(foliageInverseRed, foliageGlowVertexMask.x) : 0.0;
foliageEmission *= mix(1.0, foliageGlowRedMask, foliageGlowVertexMask.y);`
		: ''
}
totalEmissiveRadiance = max(foliageEmission, vec3(0.0)) * vFoliageHighlight;`
					: `totalEmissiveRadiance = max(foliagePacked.a * foliageEmissive *
mix(vec3(1.0), foliageAlbedo, foliageEmissiveBaseColor), vec3(0.0)) * vFoliageHighlight;`,
			)
			.replace(
				'#include <lights_physical_fragment>',
				ShaderChunk.lights_physical_fragment.replace(
					'material.specularColor = vec3( 0.04 );',
					'material.specularColor = vec3( 0.08 * foliageSpecular );',
				),
			)
			.replace(
				'#include <aomap_fragment>',
				ShaderChunk.aomap_fragment.replace(
					'texture2D( aoMap, vAoMapUv ).r',
					'clamp(mix(foliageAoRange.x, foliageAoRange.y, vFoliageAlpha), 0.0, 1.0)',
				),
			);
	};
	material.customProgramCacheKey = () =>
		`furniture_${config.family}_v1_${!!normalMap}_${nativeNormal}_${!!home?.gradient}_${!!home?.cycle}_${!!home?.specularTexture}_${!!home?.specularConstant}_${!!home?.glow}_${home?.glow?.maskConstant !== undefined}_${home?.coverage?.mode ?? 'ordinary'}`;
	return material;
}
