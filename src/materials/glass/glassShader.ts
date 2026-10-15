import {
	Float32BufferAttribute,
	MeshBasicMaterial,
	NoColorSpace,
	SRGBColorSpace,
	Vector2,
	Vector3,
	type Box3,
	type BufferGeometry,
	type Texture,
} from 'three';

export const BOTTLE_POSITION_ATTRIBUTE = 'bottlePosition';

export interface FurnitureBottleLiquid {
	surfaceColor: [number, number, number]
	level: number
	softEdge: number
	wave: [number, number]
}

export interface FurnitureStainedHome {
	uvScale: [number, number]
	baseLerp: number
}

/** Original source GLTF metres → captured UE-local centimetres. Call before
 * component/root/instance baking; bounds belong to the entire source model.
 * These coordinates intentionally do not transform with the editor geometry.
 */
export function setBottleLiquidCoordinates(geometry: BufferGeometry, sourceBounds: Box3): boolean {
	const position = geometry.getAttribute('position');
	if (!position || position.itemSize !== 3 || sourceBounds.isEmpty()) return false;

	const centerZ = (sourceBounds.min.y + sourceBounds.max.y) * 50;
	if (!Number.isFinite(centerZ)) return false;

	const values = new Float32Array(position.count * 4);
	for (let index = 0; index < position.count; index++) {
		const x = position.getX(index) * 100;
		const y = position.getZ(index) * 100;
		const z = position.getY(index) * 100;
		if (![x, y, z].every(Number.isFinite)) return false;

		values.set([x, y, z, centerZ], index * 4);
	}

	geometry.setAttribute(BOTTLE_POSITION_ATTRIBUTE, new Float32BufferAttribute(values, 4));
	return true;
}

export interface FurnitureGlass {
	family:
		| 'glass-lowcost'
		| 'glass-lowcost-pattern'
		| 'glass-translucency'
		| 'glass-stained-translucent'
		| 'bottle-liquid-closed'
		| 'glass-stained-home-opaque'
	colorMode:
		| 'scene'
		| 'albedo'
		| 'lit-preview'
		| 'lit-reflection-preview'
		| 'stained-preview'
		| 'closed-liquid'
		| 'stained-home-opaque'
		| 'stained-window-preview'
	color: [number, number, number]
	opacity: number
	roughnessScale: number
	roughnessOpacity: number
	reflectionOpacity: number
	fresnelPower: number
	baseBlend: number
	aoIntensity: number
	emissive: [number, number, number]
	roughnessFresnelIntensity: number
	roughnessDarken: number
	brightness: number
	opacityRange: [number, number]
	opacityFresnel: [number, number]
	roughnessRange: [number, number]
	dirtColor: [number, number, number]
	dirtIntensity: number
	textureSRGB?: [boolean, boolean, boolean, boolean]
	diffuseBC5?: boolean
	bottleLiquid?: FurnitureBottleLiquid
	stainedHome?: FurnitureStainedHome
}

export function readFurnitureGlass(value: unknown): FurnitureGlass | null {
	if (!value || typeof value !== 'object') return null;

	const glass = value as Record<string, unknown>;
	switch (glass.family) {
	case 'glass-lowcost':
	case 'glass-lowcost-pattern':
		if (
			glass.colorMode !== 'scene' &&
				glass.colorMode !== 'albedo' &&
				!(glass.family === 'glass-lowcost' && glass.colorMode === 'stained-window-preview')
		) return null;
		if (
			glass.colorMode === 'stained-window-preview' &&
				(typeof glass.baseBlend !== 'number' ||
					!Number.isFinite(glass.baseBlend) ||
					glass.baseBlend <= 0 ||
					glass.baseBlend > 1)
		) return null;

		break;
	case 'glass-translucency':
		if (glass.colorMode !== 'lit-preview' && glass.colorMode !== 'lit-reflection-preview') return null;

		break;
	case 'glass-stained-translucent':
		if (glass.colorMode !== 'stained-preview') return null;

		break;
	case 'glass-stained-home-opaque': {
		if (
			glass.colorMode !== 'stained-home-opaque' ||
				!glass.stainedHome ||
				typeof glass.stainedHome !== 'object'
		) return null;

		const home = glass.stainedHome as Record<string, unknown>;
		if (
			!Array.isArray(home.uvScale) ||
				home.uvScale.length !== 2 ||
				!home.uvScale.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
				typeof home.baseLerp !== 'number' ||
				!Number.isFinite(home.baseLerp) ||
				!Array.isArray(glass.textureSRGB) ||
				glass.opacity !== 1
		) return null;

		break;
	}
	case 'bottle-liquid-closed': {
		if (
			glass.colorMode !== 'closed-liquid' ||
				!glass.bottleLiquid ||
				typeof glass.bottleLiquid !== 'object'
		) return null;

		const liquid = glass.bottleLiquid as Record<string, unknown>;
		for (const [key, length] of [
			['surfaceColor', 3],
			['wave', 2],
		] as const) {
			const values = liquid[key];
			if (
				!Array.isArray(values) ||
					values.length !== length ||
					!values.every((component) => typeof component === 'number' && Number.isFinite(component))
			) return null;
		}

		if (
			typeof liquid.level !== 'number' ||
				!Number.isFinite(liquid.level) ||
				typeof liquid.softEdge !== 'number' ||
				!Number.isFinite(liquid.softEdge) ||
				liquid.softEdge <= 0
		) return null;
		if (!Array.isArray(glass.textureSRGB)) return null;

		break;
	}
	default:
		return null;
	}

	for (const [key, length] of [
		['color', 3],
		['emissive', 3],
		['dirtColor', 3],
		['opacityRange', 2],
		['opacityFresnel', 2],
		['roughnessRange', 2],
	] as const) {
		const components = glass[key];
		if (
			!Array.isArray(components) ||
			components.length !== length ||
			!components.every((component) => typeof component === 'number' && Number.isFinite(component))
		) return null;
	}

	for (const key of [
		'opacity',
		'roughnessScale',
		'roughnessOpacity',
		'reflectionOpacity',
		'fresnelPower',
		'baseBlend',
		'aoIntensity',
		'roughnessFresnelIntensity',
		'roughnessDarken',
		'brightness',
		'dirtIntensity',
	]) {
		if (typeof glass[key] !== 'number' || !Number.isFinite(glass[key])) return null;
	}

	if (
		glass.textureSRGB !== undefined &&
		(!Array.isArray(glass.textureSRGB) ||
			glass.textureSRGB.length !== 4 ||
			!glass.textureSRGB.every((value) => typeof value === 'boolean'))
	) return null;
	if (glass.diffuseBC5 !== undefined && typeof glass.diffuseBC5 !== 'boolean') return null;
	if (
		glass.diffuseBC5 &&
		(glass.family !== 'glass-translucency' ||
			!Array.isArray(glass.textureSRGB) ||
			glass.textureSRGB[0] !== false)
	) return null;

	return value as FurnitureGlass;
}

/** One-pass colour cores: no screen refraction, cube-reflection sample or OIT.
 * Lowcost alpha uses ORM.G; GlassTranslucency uses ORM.R/F0/F90;
 * stained translucent uses its captured OpacityRange Fresnel power.
 * None uses albedo alpha, Tint.A, ORM.A or a scalar guessed from its name.
 * Fresnel uses the authored surface normal here, omitting its normal-map perturbation.
 * Opaque Home keeps its separate projected/UV0 RGB and HDR emission, never PNG coverage.
 */
export function createGlassMaterial(glass: FurnitureGlass, diffuse: Texture | null, orm: Texture | null): MeshBasicMaterial {
	const opaqueHome = glass.colorMode === 'stained-home-opaque';
	if (opaqueHome && (!diffuse || !orm || !glass.stainedHome)) throw new Error(
		'[ModelManager][Glass] opaque stained Home requires its two captured colour textures and UV core',
	);

	const ownedTextures: Texture[] = [];

	const retainTexture = (texture: Texture | null, slot: number): Texture | null => {
		if (!texture || !glass.textureSRGB) return texture;

		const colorSpace = glass.textureSRGB[slot] ? SRGBColorSpace : NoColorSpace;
		if (texture.colorSpace === colorSpace) return texture;

		const owned = texture.clone();
		owned.colorSpace = colorSpace;
		owned.needsUpdate = true;
		ownedTextures.push(owned);
		return owned;
	};

	const diffuseMap = retainTexture(diffuse, 0);
	const packedMap = retainTexture(orm, 2);
	const material = new MeshBasicMaterial({
		map: diffuseMap,
		transparent: !opaqueHome,
		opacity:
			glass.colorMode === 'stained-window-preview'
				? glass.baseBlend
				: Math.max(0, Math.min(1, glass.opacity)),
		depthWrite: opaqueHome,
		forceSinglePass: true,
	});
	material.color.setRGB(...glass.color);
	material.userData.glass = glass;
	material.addEventListener('dispose', () => ownedTextures.forEach((texture) => texture.dispose()));

	const bottleCoordinatesReady = { value: false };
	if (glass.colorMode === 'closed-liquid') {
		let reportedMissingCoordinates = false;
		material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
			const coordinates = geometry.getAttribute(BOTTLE_POSITION_ATTRIBUTE);
			bottleCoordinatesReady.value =
				coordinates?.itemSize === 4 &&
				coordinates.count === geometry.getAttribute('position')?.count;
			if (!bottleCoordinatesReady.value && !reportedMissingCoordinates) {
				console.warn('[ModelManager][Glass] closed liquid requires original source-model bottlePosition coordinates');
				reportedMissingCoordinates = true;
			}
		};
	}

	material.onBeforeCompile = (shader) => {
		shader.uniforms.glassOrmMap = { value: packedMap };
		shader.uniforms.glassOpacity = { value: glass.opacity };
		shader.uniforms.glassRoughnessScale = { value: glass.roughnessScale };
		shader.uniforms.glassRoughnessOpacity = { value: glass.roughnessOpacity };
		shader.uniforms.glassReflectionOpacity = { value: glass.reflectionOpacity };
		shader.uniforms.glassFresnelPower = { value: glass.fresnelPower };
		shader.uniforms.glassBaseBlend = { value: glass.baseBlend };
		shader.uniforms.glassAoIntensity = { value: glass.aoIntensity };
		shader.uniforms.glassEmissive = { value: new Vector3(...glass.emissive) };
		shader.uniforms.glassRoughnessFresnelIntensity = { value: glass.roughnessFresnelIntensity };
		shader.uniforms.glassRoughnessDarken = { value: glass.roughnessDarken };
		shader.uniforms.glassBrightness = { value: glass.brightness };
		shader.uniforms.glassOpacityRange = { value: new Vector2(...glass.opacityRange) };
		shader.uniforms.glassOpacityFresnel = { value: new Vector2(...glass.opacityFresnel) };
		shader.uniforms.glassRoughnessRange = { value: new Vector2(...glass.roughnessRange) };
		shader.uniforms.glassDirtColor = { value: new Vector3(...glass.dirtColor) };
		shader.uniforms.glassDirtIntensity = { value: glass.dirtIntensity };

		let fresnel = 'min(1.0, 0.04 + 0.96 * pow(max(abs(1.0 - glassFacing), 0.0001), glassFresnelPower))';
		let alpha = 'glassOpacity + glassRoughness * glassRoughnessOpacity + glassFresnel * glassReflectionOpacity';
		let color = `vec3 glassQ = glassBaseBlend * diffuseColor.rgb;
${
	glass.colorMode === 'albedo'
		? `glassQ = mix(glassBrightness * (diffuseColor.rgb - clamp(
  diffuseColor.rgb * glassRoughness * glassRoughnessDarken, 0.0, 1.0)), diffuseColor.rgb, glassBaseBlend);`
		: ''
}
// Captured P*Q structure, with scene colour and reflection cube terms set to zero.
vec3 glassColor = diffuseColor.rgb * glassQ;
glassColor *= 1.0 - (1.0 - glassPacked.r) * glassAoIntensity;
#ifdef USE_MAP
float glassAlbedoAlpha = sampledDiffuseColor.a;
#else
float glassAlbedoAlpha = 1.0;
#endif
glassColor = clamp(glassColor + glassAlbedoAlpha * glassEmissive, 0.0, 1.0);
glassColor += glassRoughness * glassRoughnessFresnelIntensity * (glassColor + vec3(glassFresnel));`;
		switch (glass.colorMode) {
		case 'stained-window-preview':
			// Static stained-glass filter density comes from the source's authored
			// Opacity Offset/BaseBlend, not its signed screen-composition Opacity
			// or Albedo alpha. Treat both sides consistently without refraction.
			fresnel = 'pow(max(1.0 - abs(glassDot), 0.0), glassFresnelPower)';
			alpha = 'glassBaseBlend + (1.0 - glassBaseBlend) * glassFresnel';
			color = `vec3 glassColor = diffuseColor.rgb;
#ifdef USE_MAP
glassColor += sampledDiffuseColor.a * glassEmissive;
#else
glassColor += glassEmissive;
#endif`;
			break;
		case 'lit-preview':
		case 'lit-reflection-preview':
			fresnel = '0.04232 + 0.95768 * pow(max(1.0 - abs(glassDot), 0.0), 5.0)';
			alpha = 'mix(mix(glassOpacityRange.x, glassOpacityRange.y, glassPacked.r) * glassOpacityFresnel.x, glassOpacityFresnel.y, glassFresnel)';
			// The source's lighting, reflection and Lightmap-driven emission are omitted,
			// not replaced by a guessed grey light or multiplied into material alpha.
			color = `vec3 glassColor = clamp(mix(diffuseColor.rgb, glassDirtColor,
  clamp(glassPacked.r + glassDirtIntensity - 1.0, 0.0, 1.0)), 0.0, 1.0);
${
	glass.colorMode === 'lit-reflection-preview'
		? `glassColor = clamp(glassColor * mix(
  glassRoughnessRange.x, glassRoughnessRange.y, glassPacked.g), 0.0, 1.0);`
		: ''
}`;
			break;
		case 'stained-preview':
			fresnel = 'pow(max(abs(1.0 - glassFacing), 0.0001), glassFresnelPower)';
			alpha = 'mix(glassOpacityRange.x, glassOpacityRange.y, glassFresnel)';
			// View-projected colour, glint and contact-depth effects are unavailable.
			color = 'vec3 glassColor = diffuseColor.rgb;';
			break;
		case 'stained-home-opaque': {
			const home = glass.stainedHome!;
			shader.uniforms.stainedHomeUVScale = { value: new Vector2(...home.uvScale) };
			shader.uniforms.stainedHomeBaseLerp = { value: home.baseLerp };
			fresnel = '0.0';
			alpha = '1.0';
			// 4a1ef808 L96-121: reflected-view projection in the camera-up frame.
			// Native Albedo's RGB is both colour and the channel-wise blend weight.
			// Retain HDR emission until the existing output/tone-mapping chunks.
			color = `vec3 stainedRight = cross(glassView, vec3(0.0, 1.0, 0.0));
float stainedRightLength = length(stainedRight);
stainedRight = stainedRightLength > 0.000001 ? stainedRight / stainedRightLength : vec3(1.0, 0.0, 0.0);
vec3 stainedUp = normalize(cross(stainedRight, glassView));
vec3 stainedReflection = reflect(-glassView, normalize(vGlassNormal));
vec2 stainedUV = vec2(dot(stainedReflection, stainedRight), -dot(stainedReflection, stainedUp));
stainedUV = stainedUV * (0.5 * stainedHomeUVScale.x) + vec2(0.5);
vec3 stainedAlbedo = texture2D(map, stainedUV).rgb;
vec3 stainedBase = texture2D(glassOrmMap, vGlassUv * stainedHomeUVScale.y).rgb;
vec3 stainedBody = stainedAlbedo * diffuseColor.rgb * (stainedBase +
  (vec3(1.0) - stainedBase) * stainedAlbedo * stainedHomeBaseLerp);
vec3 glassColor = clamp(stainedBody, 0.0, 1.0) + max(stainedAlbedo * glassEmissive, vec3(0.0));`;
			break;
		}
		case 'closed-liquid': {
			const liquid = glass.bottleLiquid!;
			shader.uniforms.bottleSurfaceColor = { value: new Vector3(...liquid.surfaceColor) };
			shader.uniforms.bottleLevel = { value: liquid.level };
			shader.uniforms.bottleSoftEdge = { value: liquid.softEdge };
			shader.uniforms.bottleWave = { value: new Vector2(...liquid.wave) };
			shader.uniforms.bottleCoordinatesReady = bottleCoordinatesReady;
			fresnel = '0.0';
			alpha = 'clamp(bottleDepth * 11.0 - 5.0, 0.0, 1.0) * glassOpacity';
			// Actual native body mask and front/surface tint split. The source
			// wave is frozen at time zero, not a guessed opacity or liquid level.
			// Planar ray-intersection UV and source depth are explicitly omitted.
			color = `if (!bottleCoordinatesReady) discard;
float bottleWaveOffset = (sin(vBottlePosition.x * bottleWave.y * 6.283185) +
  sin(vBottlePosition.y * bottleWave.y * 6.283185)) * bottleWave.x;
float bottleDepth = vBottlePosition.w + bottleLevel - vBottlePosition.z - bottleWaveOffset;
float bottleFacing = gl_FrontFacing ? 1.0 : 0.0;
float bottleOuter = bottleFacing * clamp((bottleDepth - bottleSoftEdge * 0.5) / bottleSoftEdge, 0.0, 1.0);
#ifdef USE_MAP
vec3 bottleSurface = sampledDiffuseColor.rgb * bottleSurfaceColor;
#else
vec3 bottleSurface = bottleSurfaceColor;
#endif
vec3 glassColor = clamp(mix(bottleSurface, diffuseColor.rgb, bottleOuter), 0.0, 1.0);`;
			break;
		}
		}

		const varyings = `varying vec3 vGlassNormal;
varying vec3 vGlassView;
varying vec2 vGlassUv;
${glass.colorMode === 'closed-liquid' ? 'varying vec4 vBottlePosition;' : ''}`;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
${varyings}`,
			)
			.replace(
				'void main() {',
				`${glass.colorMode === 'closed-liquid' ? 'attribute vec4 bottlePosition;' : ''}
void main() {`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
#if !defined(USE_ENVMAP) && !defined(USE_SKINNING)
#include <beginnormal_vertex>
#include <defaultnormal_vertex>
#endif
vGlassNormal = transformedNormal;
vGlassUv = uv;
${glass.colorMode === 'closed-liquid' ? 'vBottlePosition = bottlePosition;' : ''}`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
vGlassView = -mvPosition.xyz;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
${varyings}
uniform sampler2D glassOrmMap;
uniform float glassOpacity;
uniform float glassRoughnessScale;
uniform float glassRoughnessOpacity;
uniform float glassReflectionOpacity;
uniform float glassFresnelPower;
uniform float glassBaseBlend;
uniform float glassAoIntensity;
uniform vec3 glassEmissive;
uniform float glassRoughnessFresnelIntensity;
uniform float glassRoughnessDarken;
uniform float glassBrightness;
uniform vec2 glassOpacityRange;
uniform vec2 glassOpacityFresnel;
uniform vec2 glassRoughnessRange;
uniform vec3 glassDirtColor;
uniform float glassDirtIntensity;
${
	opaqueHome
		? `uniform vec2 stainedHomeUVScale;
uniform float stainedHomeBaseLerp;`
		: ''
}
${
	glass.colorMode === 'closed-liquid'
		? `uniform vec3 bottleSurfaceColor;
uniform float bottleLevel;
uniform float bottleSoftEdge;
uniform vec2 bottleWave;
uniform bool bottleCoordinatesReady;`
		: ''
}`,
			)
			.replace('#include <color_fragment>', '')
			.replace(
				'#include <alphamap_fragment>',
				`
vec3 glassView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vGlassView);
float glassDot = dot(normalize(vGlassNormal), glassView);
float glassFacing = max(glassDot, 0.0);
float glassFresnel = ${fresnel};
vec4 glassPacked = ${packedMap && !opaqueHome ? 'texture2D(glassOrmMap, vGlassUv)' : 'vec4(1.0, 0.0, 0.0, 0.0)'};
float glassRoughness = clamp(glassPacked.g * glassRoughnessScale, 0.0, 1.0);
${glass.diffuseBC5 ? 'diffuseColor.b = 0.0; // Native BC5 contains R/G, not the PNG decoder\'s reconstructed normal Z.' : ''}
${color}
diffuseColor.rgb = glassColor;
#include <color_fragment>
diffuseColor.a = clamp(${alpha}, 0.0, 1.0);`,
			);
		if (opaqueHome) {
			// The captured D is a reflected-view colour sample, not an extra UV0 map.
			// Removing the built-in sample keeps the entire core at two texture reads.
			shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '');
		}
	};
	material.customProgramCacheKey = () => `furniture_glass_v5_${glass.colorMode}_${!!packedMap}_${!!glass.diffuseBC5}`;
	return material;
}
