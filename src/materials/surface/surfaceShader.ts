import {
	LinearFilter,
	LinearMipmapLinearFilter,
	NoColorSpace,
	ShaderChunk,
	SRGBColorSpace,
	Vector2,
	Vector3,
	type MeshStandardMaterial,
	type Texture,
} from 'three';
import {
	readFurnitureSurfaceLampPreview,
	surfaceLampPreviewMembership,
	SURFACE_LAMP_GLSL,
	type FurnitureSurfaceLamp,
} from './surfaceLampShader.js';

const surfaceFamilies = [
	'home-opaque-hbc',
	'home-cloth',
	'opaque-standard',
	'opaque-lightmass',
	'opaque-color',
	'home-opaque',
	'home-opaque-pattern',
	'home-opaque-pattern-single',
	'home-opaque-pattern-direct',
	'home-opaque-multiply',
	'opaque-hbc',
	'home-hbc',
	'translucent-hbc',
	'triplanar-hbc',
] as const;

export interface FurnitureSurface {
	translucent?: SurfaceTranslucent
	hbcEmission?: number
	homeUv?: { isWall: number; mirror: number; transform: [number, number, number, number] }
	detail?: {
		key: string
		uvWeights: [number, number, number, number]
		uvScale: [number, number]
		intensity: number
	}
	fuzz?: {
		color: [number, number, number, number]
		roughness: number
		smoothness: number
		useBaseColor: number
		baseOutput: number
	}
	triplanar?: {
		blend: number
		flattenZ: number
		axisTint: [number[], number[], number[]]
		heightColor: [number, number, number, number]
	}
	family: (typeof surfaceFamilies)[number]
	color: [number, number, number]
	roughness: [number, number]
	metalness: [number, number]
	ao: [number, number]
	uvScale: number
	uvOffset: [number, number]
	normalUvScale: number
	tintUvBlend: number
	tintMaskBias: number
	textureSRGB?: [boolean, boolean, boolean, boolean]
	tintMipmaps?: boolean
	coverage?: 'diffuse-alpha'
	cutoff?: number
	normalIntensity?: number
	specular?: [number, number]
	emissiveCore?: [number, number, number]
	emissiveOuter?: [number, number, number]
	emissiveParams?: [number, number, number]
	vertexEmissive?: 'source-blue'
	tintDyeMode?: 'hbc-decimal'
	tintDyeParams?: [number, number]
	lamp?: FurnitureSurfaceLamp
}

export interface SurfaceTranslucent {
	fuzzy: [number, number, number]
	opacity: [number, number, number, number]
	rotation: number
	detailUvScale: number
	detailFlatness: number
	blockMask: number
	colorAlpha: number
	emission: [number, number, number]
	secondFresnel: [number, number, number, number]
	emissionParams: [number, number]
}

export const SURFACE_EMISSION_ATTRIBUTE = 'surfaceEmissionMask';

/** Genuine source raw only. Native physical array-depth clamp follows this conversion. */
export function resolveHBCTintLayer(raw: number, params: readonly [number, number]): number | null {
	if (
		!Number.isSafeInteger(raw) ||
		raw < 0 ||
		!Number.isSafeInteger(params[0]) ||
		!Number.isFinite(params[1])
	) return null;

	const tens = (raw % 100) / 10;
	const ones = raw % 10;
	const coordinate = params[0] + tens + (ones - tens) * params[1];
	if (!Number.isFinite(coordinate)) return null;

	// D3D Texture2DArray converts the complete coordinate with nearest-even,
	// not Math.round or a rounded tens digit before the floor-index offset.
	const lower = Math.floor(coordinate);
	const fraction = coordinate - lower;
	const layer = fraction < 0.5 || (fraction === 0.5 && lower % 2 === 0) ? lower : lower + 1;
	return Number.isSafeInteger(layer) ? layer : null;
}

export function readFurnitureSurface(value: unknown): FurnitureSurface | null {
	if (!value || typeof value !== 'object') return null;

	const surface = value as Record<string, unknown>;
	if (!surfaceFamilies.some((family) => family === surface.family)) return null;

	if (surface.family === 'translucent-hbc') {
		const t = surface.translucent as Record<string, unknown> | undefined;
		if (!t) return null;

		for (const [key, count] of [
			['fuzzy', 3],
			['opacity', 4],
			['emission', 3],
			['secondFresnel', 4],
			['emissionParams', 2],
		] as const) {
			const values = t[key];
			if (
				!Array.isArray(values) ||
				values.length !== count ||
				!values.every((v) => typeof v === 'number' && Number.isFinite(v))
			) return null;
		}

		for (const key of ['rotation', 'detailUvScale', 'detailFlatness', 'blockMask', 'colorAlpha']) {
			if (typeof t[key] !== 'number' || !Number.isFinite(t[key])) return null;
		}

		if (
			(t.detailUvScale as number) <= 0 ||
			(t.fuzzy as number[])[0]! < 0 ||
			(t.opacity as number[])[2]! < 0
		) return null;
	} else if (surface.translucent !== undefined) return null;

	const staticSurfaceCore = surface.family === 'home-opaque-hbc' || surface.family === 'home-cloth';
	if (!staticSurfaceCore || surface.textureSRGB !== undefined) {
		if (
			!Array.isArray(surface.textureSRGB) ||
			surface.textureSRGB.length !== 4 ||
			!surface.textureSRGB.every((value) => typeof value === 'boolean')
		) return null;
	}

	if (surface.tintMipmaps !== undefined && typeof surface.tintMipmaps !== 'boolean') return null;
	if (surface.tintDyeMode !== undefined && surface.tintDyeMode !== 'hbc-decimal') return null;

	if (surface.tintDyeMode === 'hbc-decimal') {
		if (
			surface.family !== 'home-opaque-hbc' &&
			surface.family !== 'opaque-hbc' &&
			surface.family !== 'home-hbc' &&
			surface.family !== 'translucent-hbc' &&
			surface.family !== 'triplanar-hbc'
		) return null;
		if (
			!Array.isArray(surface.tintDyeParams) ||
			surface.tintDyeParams.length !== 2 ||
			!surface.tintDyeParams.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
			!Number.isSafeInteger(surface.tintDyeParams[0])
		) return null;
	} else if (surface.tintDyeParams !== undefined) return null;

	if (surface.coverage !== undefined && surface.coverage !== 'diffuse-alpha') return null;

	for (const key of ['cutoff', 'normalIntensity']) {
		if (
			surface[key] !== undefined &&
			(typeof surface[key] !== 'number' || !Number.isFinite(surface[key]))
		) return null;
	}

	if (
		surface.hbcEmission !== undefined &&
		(surface.family !== 'opaque-hbc' ||
			typeof surface.hbcEmission !== 'number' ||
			!Number.isFinite(surface.hbcEmission))
	) return null;

	const numeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
	const vector = (v: unknown) => Array.isArray(v) && v.length === 4 && v.every(numeric);
	const tri = surface.triplanar as FurnitureSurface['triplanar'];
	if (surface.family === 'triplanar-hbc') {
		if (
			!tri ||
			!numeric(tri.blend) ||
			!numeric(tri.flattenZ) ||
			!vector(tri.heightColor) ||
			!Array.isArray(tri.axisTint) ||
			tri.axisTint.length !== 3 ||
			!tri.axisTint.every((v) => Array.isArray(v) && v.length === 3 && v.every(numeric))
		) return null;
	} else if (tri) return null;

	for (const key of ['homeUv', 'detail', 'fuzz']) {
		if (
			surface[key] !== undefined &&
			(surface.family !== 'home-hbc' || !surface[key] || typeof surface[key] !== 'object')
		) return null;
	}

	const homeUv = surface.homeUv as FurnitureSurface['homeUv'];
	if (homeUv && (!numeric(homeUv.isWall) || !numeric(homeUv.mirror) || !vector(homeUv.transform))) return null;

	const detail = surface.detail as FurnitureSurface['detail'];
	if (
		detail &&
		(detail.key !== 'T Detail Normal' ||
			!vector(detail.uvWeights) ||
			!Array.isArray(detail.uvScale) ||
			detail.uvScale.length !== 2 ||
			!detail.uvScale.every(numeric) ||
			!numeric(detail.intensity))
	) return null;

	const fuzz = surface.fuzz as FurnitureSurface['fuzz'];
	if (
		fuzz &&
		(!vector(fuzz.color) ||
			![fuzz.roughness, fuzz.smoothness, fuzz.useBaseColor, fuzz.baseOutput].every(numeric) ||
			fuzz.roughness <= 0)
	) return null;
	if (surface.coverage && (surface.cutoff !== 0.3333 || staticSurfaceCore)) return null;

	for (const key of ['specular', 'emissiveCore', 'emissiveOuter', 'emissiveParams']) {
		const array = surface[key];
		if (
			array !== undefined &&
			(!Array.isArray(array) ||
				array.length !== (key === 'specular' ? 2 : 3) ||
				!array.every((value) => typeof value === 'number' && Number.isFinite(value)))
		) return null;
	}

	if (surface.vertexEmissive !== undefined && surface.vertexEmissive !== 'source-blue') return null;
	if (
		surface.lamp !== undefined &&
		((surface.family !== 'opaque-standard' && surface.family !== 'opaque-lightmass') ||
			!readFurnitureSurfaceLampPreview(surface.lamp) ||
			surface.vertexEmissive !== undefined ||
			surface.emissiveCore === undefined ||
			surface.emissiveOuter === undefined ||
			surface.emissiveParams === undefined)
	) return null;

	if (surface.vertexEmissive === 'source-blue') {
		if (
			staticSurfaceCore ||
			typeof surface.family !== 'string' ||
			!surface.family.startsWith('home-') ||
			surface.emissiveCore === undefined ||
			surface.emissiveParams === undefined ||
			surface.emissiveOuter !== undefined
		) return null;
	} else {
		const emissiveFields = [surface.emissiveCore, surface.emissiveOuter, surface.emissiveParams];
		if (
			emissiveFields.some((value) => value !== undefined) &&
			emissiveFields.some((value) => value === undefined)
		) return null;
	}

	for (const key of ['color', 'roughness', 'metalness', 'ao', 'uvOffset']) {
		const array = surface[key];
		if (
			!Array.isArray(array) ||
			array.length !== (key === 'color' ? 3 : 2) ||
			!array.every((component) => typeof component === 'number' && Number.isFinite(component))
		) return null;
	}

	for (const key of ['uvScale', 'normalUvScale', 'tintUvBlend', 'tintMaskBias']) {
		if (typeof surface[key] !== 'number' || !Number.isFinite(surface[key])) return null;
	}

	return value as FurnitureSurface;
}

/** Furniture surface core only; Three.js continues to own lighting/shadows and instancing. */
export function applySurfaceShader(material: MeshStandardMaterial, surface: FurnitureSurface, orm: Texture | null, tint: Texture | null): void {
	const overlay =
		surface.family === 'home-opaque-hbc' ||
		surface.family === 'home-opaque-pattern' ||
		surface.family === 'opaque-hbc' ||
		surface.family === 'home-hbc';
	const postTint = surface.family === 'home-opaque-pattern' || surface.family === 'home-opaque-multiply';
	const staticSurfaceCore = surface.family === 'home-opaque-hbc' || surface.family === 'home-cloth';
	const opaque = surface.family !== 'home-cloth';
	const coverage = surface.coverage === 'diffuse-alpha';
	const emissive = !!surface.emissiveCore && !!surface.emissiveOuter && !!surface.emissiveParams;
	const vertexEmissive = surface.vertexEmissive === 'source-blue';
	const lamp = surface.lamp;
	const lampMembership = lamp ? surfaceLampPreviewMembership(lamp) : null;
	if (
		lamp &&
		(lampMembership === null ||
			!emissive ||
			vertexEmissive ||
			(surface.family !== 'opaque-standard' && surface.family !== 'opaque-lightmass'))
	) throw new Error('Surface lamp requires proved ordinary MPC asset-default preview inputs');
	// 0107aa53/9e2bb130 apply Tint Color after the masked Overlay/Multiply.
	// Keeping it in material.color would change Overlay's 0.5 threshold.
	if (postTint) material.color.setRGB(1, 1, 1);
	if (!staticSurfaceCore) {
		// Captured scalar strength and emission are evaluated in the shader below.
		// Imported fallback factors must not reintroduce a legacy approximation;
		// retain only the loader's explicit/derivative TBN sign convention.
		material.normalScale.set(material.normalScale.x < 0 ? -1 : 1, material.normalScale.y < 0 ? -1 : 1);
		material.aoMapIntensity = 1;
		material.emissive.setRGB(0, 0, 0);
		material.emissiveMap = null;
		material.emissiveIntensity = 0;
		material.alphaMap = null;
		material.alphaHash = false;
		material.alphaToCoverage = false;
		material.alphaTest = coverage ? surface.cutoff! : 0;
		material.opacity = 1;
		material.transparent = false;
	}

	const colorSpaces = surface.textureSRGB ?? [true, false, false, true];
	// Source headers include authored linear D and sRGB ORM exceptions. Apply
	// those bindings locally rather than mutating the shared texture registry.
	if (material.map) {
		const colorSpace = colorSpaces[0] ? SRGBColorSpace : NoColorSpace;
		if (material.map.colorSpace !== colorSpace || coverage) {
			const map = material.map.clone();
			map.colorSpace = colorSpace;
			if (coverage) {
				// Default Three depth/shadow materials use map.transform. The color
				// shader uses vSurfaceUv directly, so this does not apply the UV twice.
				map.repeat.set(surface.uvScale, surface.uvScale);
				map.channel = 0;
				map.offset.set(...surface.uvOffset);
				map.rotation = 0;
				map.center.set(0, 0);
				map.matrixAutoUpdate = true;
				map.updateMatrix();
			}

			map.needsUpdate = true;
			material.map = map;
			material.addEventListener('dispose', () => map.dispose());
		}
	}

	let ormMap = orm;
	if (orm && orm.colorSpace !== (colorSpaces[2] ? SRGBColorSpace : NoColorSpace)) {
		ormMap = orm.clone();
		ormMap.colorSpace = colorSpaces[2] ? SRGBColorSpace : NoColorSpace;
		ormMap.needsUpdate = true;

		const ownedOrm = ormMap;
		material.addEventListener('dispose', () => ownedOrm.dispose());
	}
	// Old HBC/cloth arrays are one-mip, non-nearest. Some Home pattern palettes
	// have six original mips; regenerated browser mips remain an explicit approximation.
	const tintMap = tint?.clone() ?? null;
	if (tintMap) {
		tintMap.colorSpace = colorSpaces[3] ? SRGBColorSpace : NoColorSpace;
		tintMap.minFilter = surface.tintMipmaps ? LinearMipmapLinearFilter : LinearFilter;
		tintMap.magFilter = LinearFilter;
		tintMap.generateMipmaps = !!surface.tintMipmaps;
		tintMap.needsUpdate = true;
		material.addEventListener('dispose', () => tintMap.dispose());
	}

	material.onBeforeCompile = (shader) => {
		shader.uniforms.homeOrmMap = { value: ormMap };
		shader.uniforms.homeTintMap = { value: tintMap };
		shader.uniforms.homeColor = { value: new Vector3(...surface.color) };
		shader.uniforms.homeUvScale = { value: surface.uvScale };
		shader.uniforms.homeUvOffset = { value: new Vector2(...surface.uvOffset) };
		shader.uniforms.homeNormalUvScale = { value: surface.normalUvScale };
		shader.uniforms.homeTintUvBlend = { value: surface.tintUvBlend };
		shader.uniforms.homeTintMaskBias = { value: surface.tintMaskBias };
		shader.uniforms.homeRoughness = { value: new Vector2(...surface.roughness) };
		shader.uniforms.homeMetalness = { value: new Vector2(...surface.metalness) };
		shader.uniforms.homeAo = { value: new Vector2(...surface.ao) };
		shader.uniforms.homeNormalIntensity = { value: surface.normalIntensity ?? 1 };
		shader.uniforms.homeSpecular = { value: new Vector2(...(surface.specular ?? [0.5, 0])) };
		shader.uniforms.homeEmissiveCore = {
			value: new Vector3(...(surface.emissiveCore ?? [0, 0, 0])),
		};
		shader.uniforms.homeEmissiveOuter = {
			value: new Vector3(...(surface.emissiveOuter ?? [0, 0, 0])),
		};
		shader.uniforms.homeEmissiveParams = {
			value: new Vector3(...(surface.emissiveParams ?? [1, 1, 1])),
		};
		shader.uniforms.homeHbcEmission = { value: surface.hbcEmission ?? 0 };
		if (lamp) {
			shader.uniforms.homeUseDESLamp = { value: lamp.useDESLamp };
			shader.uniforms.homeLampMembership = { value: lampMembership };
		}

		const varyings = `varying vec2 vSurfaceUv;
varying vec2 vSurfaceTintUv;${vertexEmissive ? '\nvarying float vSurfaceEmissionMask;' : ''}`;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
#ifndef USE_UV2
attribute vec2 uv2;
#endif
uniform float homeUvScale;
uniform vec2 homeUvOffset;
uniform float homeTintUvBlend;
${vertexEmissive ? `attribute float ${SURFACE_EMISSION_ATTRIBUTE};` : ''}
${varyings}`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vSurfaceUv = uv * homeUvScale + homeUvOffset;
vSurfaceTintUv = mix(vSurfaceUv, uv2, homeTintUvBlend);
${vertexEmissive ? `vSurfaceEmissionMask = ${SURFACE_EMISSION_ATTRIBUTE};` : ''}`,
			);

		const tintExpression = overlay
			? `vec3 low = 2.0 * diffuseColor.rgb * tintColor;
vec3 high = 1.0 - 2.0 * (1.0 - diffuseColor.rgb) * (1.0 - tintColor);
vec3 tinted = mix(low, high, step(vec3(0.5), diffuseColor.rgb));`
			: 'vec3 tinted = diffuseColor.rgb * tintColor;';

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
${varyings}
uniform sampler2D homeOrmMap;
uniform sampler2D homeTintMap;
uniform vec3 homeColor;
uniform float homeNormalUvScale;
uniform float homeTintMaskBias;
uniform vec2 homeRoughness;
uniform vec2 homeMetalness;
uniform vec2 homeAo;
uniform float homeNormalIntensity;
uniform vec2 homeSpecular;
uniform vec3 homeEmissiveCore;
uniform vec3 homeEmissiveOuter;
uniform vec3 homeEmissiveParams;
uniform float homeHbcEmission;
${
	lamp
		? `uniform float homeUseDESLamp;
uniform float homeLampMembership;
${SURFACE_LAMP_GLSL}`
		: ''
}
vec4 furnitureOrm;
vec3 furniturePreTintBase;
vec3 furnitureSurfaceBase;`,
			)
		// Instance highlight colors multiply the finished surface, not the Overlay input.
			.replace('#include <color_fragment>', '')
			.replace(
				'#include <map_fragment>',
				`${ShaderChunk.map_fragment.split('vMapUv').join('vSurfaceUv')}
furnitureOrm = ${orm ? 'texture2D(homeOrmMap, vSurfaceUv)' : 'vec4(1.0, 1.0, 0.0, 0.0)'};
furniturePreTintBase = diffuseColor.rgb;
${
	tint
		? `vec3 tintColor = texture2D(homeTintMap, vSurfaceTintUv).rgb;
${tintExpression}
float tintMask = clamp(furnitureOrm.a + homeTintMaskBias, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, tinted, tintMask);`
		: ''
}
${postTint ? 'diffuseColor.rgb *= homeColor;' : ''}
furnitureSurfaceBase = diffuseColor.rgb;
${opaque ? 'diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 1.0);' : ''}
#include <color_fragment>
${
	staticSurfaceCore
		? ''
		: coverage
			? `#ifdef USE_MAP
diffuseColor.a = sampledDiffuseColor.a;
#else
diffuseColor.a = 1.0;
#endif`
			: 'diffuseColor.a = 1.0;'
}`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				'float roughnessFactor = clamp(mix(homeRoughness.x, homeRoughness.y, furnitureOrm.g), 0.0, 1.0);',
			)
			.replace(
				'#include <metalnessmap_fragment>',
				'float metalnessFactor = clamp(mix(homeMetalness.x, homeMetalness.y, furnitureOrm.b), 0.0, 1.0);',
			)
			.replace(
				'#include <aomap_fragment>',
				ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'clamp(mix(homeAo.x, homeAo.y, furnitureOrm.r), 0.0, 1.0)'),
			)
			.replace(
				'#include <normal_fragment_begin>',
				ShaderChunk.normal_fragment_begin
					.split('vNormalMapUv')
					.join('(vSurfaceUv * homeNormalUvScale)'),
			)
			.replace(
				'#include <normal_fragment_maps>',
				ShaderChunk.normal_fragment_maps.replace(
					'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
					`vec2 normalRG = texture2D(normalMap, vSurfaceUv * homeNormalUvScale).rg * 2.0 - 1.0;
vec3 mapN = vec3(normalRG, sqrt(max(1.0 - dot(normalRG, normalRG), 0.0)));` +
						(staticSurfaceCore
							? ''
							: '\nmapN = mix(vec3(0.0, 0.0, 1.0), mapN, homeNormalIntensity);'),
				),
			);
		if (surface.specular) {
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <lights_physical_fragment>',
				ShaderChunk.lights_physical_fragment.replace(
					'material.specularColor = vec3( 0.04 );',
					`float sourceSpecular = clamp(mix(homeSpecular.x, clamp(dot(furnitureSurfaceBase, vec3(0.5)), 0.0, 1.0), homeSpecular.y), 0.0, 1.0);
material.specularColor = vec3(0.08 * sourceSpecular);`,
				),
			);
		}

		if (vertexEmissive) {
			// Native COLOR.b is independent of Three instance highlight/vertexColors.
			// Use the finished preclamp base, including Home Overlay/Multiply ordering.
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <emissivemap_fragment>',
				`vec3 sourceEmission = homeEmissiveCore * furnitureOrm.a * vSurfaceEmissionMask;
sourceEmission *= mix(vec3(1.0), furnitureSurfaceBase, homeEmissiveParams.x);
totalEmissiveRadiance = max(sourceEmission * homeEmissiveParams.y * homeEmissiveParams.z, vec3(0.0));`,
			);
		} else if (emissive) {
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <emissivemap_fragment>',
				`vec3 sourceEmission = mix(homeEmissiveOuter, homeEmissiveCore, clamp(furnitureOrm.a + homeEmissiveParams.x, 0.0, 1.0));
${lamp ? 'sourceEmission = furnitureDESLamp(sourceEmission, homeUseDESLamp, homeLampMembership);' : ''}
sourceEmission *= furnitureOrm.a * ${surface.hbcEmission !== undefined ? 'furniturePreTintBase' : 'furnitureSurfaceBase'};
sourceEmission = (sourceEmission - 0.5) * homeEmissiveParams.y + 0.5;
${surface.hbcEmission !== undefined ? 'sourceEmission *= mix(vec3(1.0), furnitureSurfaceBase, homeHbcEmission);' : ''}
totalEmissiveRadiance = max(sourceEmission * homeEmissiveParams.z, vec3(0.0));`,
			);
		}
	};
	material.customProgramCacheKey = () =>
		`furniture_surface_v5_${surface.family}_${!!orm}_${!!tint}_${coverage}_${!!surface.specular}_${emissive}_${vertexEmissive}_${!!lamp}_${surface.hbcEmission !== undefined}`;
	material.needsUpdate = true;
}
