import {
	LinearFilter,
	LinearMipmapLinearFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4,
	type MeshStandardMaterial,
	type Texture,
} from 'three';
import { applySurfaceShader, readFurnitureSurface, type FurnitureSurface } from './surfaceShader.js';

interface SurfaceExtraInput {
	key: string;
	path: string;
	sRGB: boolean;
	mipmaps: boolean;
	normalEncoding?: 'gltf' | 'native-rg';
}

export interface FurnitureSurfaceExtra {
	core: FurnitureSurface;
	textures: Record<string, SurfaceExtraInput>;
	detail?: {
		key: string;
		uvWeights: [number, number, number, number];
		uvScale: [number, number];
		intensity: number;
	};
	rainbow?: {
		key: string;
		color: [number, number, number];
		tiling: number;
		distortion: number;
		intensity: number;
		threshold: number;
		reverse: number;
	};
	auxAO?: {
		key: string;
		channel: [number, number, number, number];
		uvScale: number;
		uvOffset: [number, number];
	};
}

function finiteArray(value: unknown, count: number): value is number[] {
	return (
		Array.isArray(value) &&
		value.length === count &&
		value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
	);
}

export function readFurnitureSurfaceExtra(value: unknown): FurnitureSurfaceExtra | null {
	if (!value || typeof value !== 'object') return null;

	const input = value as Record<string, unknown>;
	const core = readFurnitureSurface(input.core);
	if (!core || !input.textures || typeof input.textures !== 'object') return null;

	const surface = value as FurnitureSurfaceExtra;
	if (!surface.textures.D || !surface.textures.N || !surface.textures.O) return null;
	if (surface.textures.N.normalEncoding !== 'gltf') return null;

	for (const descriptor of Object.values(surface.textures)) {
		if (
			!descriptor ||
			typeof descriptor.key !== 'string' ||
			!descriptor.key ||
			typeof descriptor.path !== 'string' ||
			!descriptor.path ||
			typeof descriptor.sRGB !== 'boolean' ||
			typeof descriptor.mipmaps !== 'boolean'
		) return null;
	}

	if (surface.detail) {
		const detail = surface.detail;
		if (
			!finiteArray(detail.uvWeights, 4) ||
			!finiteArray(detail.uvScale, 2) ||
			!Number.isFinite(detail.intensity) ||
			detail.key !== surface.textures.N1?.key ||
			surface.textures.N1.sRGB ||
			surface.textures.N1.normalEncoding !== 'native-rg'
		) return null;
	} else if (surface.textures.N1) return null;

	if (surface.rainbow) {
		const rainbow = surface.rainbow;
		if (
			!finiteArray(rainbow.color, 3) ||
			![
				rainbow.tiling,
				rainbow.distortion,
				rainbow.intensity,
				rainbow.threshold,
				rainbow.reverse,
			].every(Number.isFinite) ||
			rainbow.key !== surface.textures.T1?.key
		) return null;
	} else if (surface.textures.T1) return null;

	if (surface.auxAO) {
		const ao = surface.auxAO;
		if (
			!finiteArray(ao.channel, 4) ||
			!finiteArray(ao.uvOffset, 2) ||
			!Number.isFinite(ao.uvScale) ||
			ao.key !== surface.textures.O1?.key
		) return null;
	} else if (surface.textures.O1) return null;

	return surface;
}

/** Original TEXCOORD indices; never accept a synthesized UV as source proof. */
export function surfaceExtraUVChannels(surface: FurnitureSurfaceExtra): number[] {
	const channels = new Set([0]);
	surface.detail?.uvWeights.forEach((weight, index) => {
		if (weight !== 0) channels.add(index);
	});
	if (surface.auxAO || surface.core.tintUvBlend !== 0) channels.add(1);
	return [...channels].sort();
}

/** Extra inputs use N1/T1/O1, independently of the D/N/O/T dye roles. */
export function applySurfaceExtraShader(
	material: MeshStandardMaterial,
	surface: FurnitureSurfaceExtra,
	orm: Texture | null,
	tint: Texture | null,
	detail: Texture | null,
	rainbow: Texture | null,
	auxAO: Texture | null,
): void {
	if (
		!material.normalMap ||
		(surface.detail && !detail) ||
		(surface.rainbow && !rainbow) ||
		(surface.auxAO && !auxAO)
	) throw new Error('Captured extra surface is missing an active native texture consumer');

	material.color.setRGB(...surface.core.color);
	applySurfaceShader(material, surface.core, orm, tint);

	const coreCompile = material.onBeforeCompile;
	const coreCacheKey = material.customProgramCacheKey();

	const own = (texture: Texture | null, role: string): Texture | null => {
		if (!texture) return null;

		const descriptor = surface.textures[role];
		if (!descriptor) throw new Error(`Missing native extra surface ${role} texture contract`);

		const result = texture.clone();
		result.colorSpace = descriptor.sRGB ? SRGBColorSpace : NoColorSpace;
		result.minFilter = descriptor.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
		result.magFilter = LinearFilter;
		result.generateMipmaps = descriptor.mipmaps;
		result.wrapS = RepeatWrapping;
		result.wrapT = RepeatWrapping;
		result.needsUpdate = true;
		material.addEventListener('dispose', () => result.dispose());
		return result;
	};

	const detailMap = own(detail, 'N1');
	const rainbowMap = own(rainbow, 'T1');
	const aoMap = own(auxAO, 'O1');
	material.onBeforeCompile = (shader, renderer) => {
		coreCompile.call(material, shader, renderer);
		shader.uniforms.extraDetailMap = { value: detailMap };
		shader.uniforms.extraRainbowMap = { value: rainbowMap };
		shader.uniforms.extraAOMap = { value: aoMap };
		shader.uniforms.extraDetailWeights = {
			value: new Vector4(...(surface.detail?.uvWeights ?? [0, 0, 0, 0])),
		};
		shader.uniforms.extraDetailScale = {
			value: new Vector2(...(surface.detail?.uvScale ?? [1, 1])),
		};
		shader.uniforms.extraDetailIntensity = { value: surface.detail?.intensity ?? 0 };
		shader.uniforms.extraAOChannel = {
			value: new Vector4(...(surface.auxAO?.channel ?? [1, 0, 0, 0])),
		};
		shader.uniforms.extraAOScale = { value: surface.auxAO?.uvScale ?? 1 };
		shader.uniforms.extraAOOffset = { value: new Vector2(...(surface.auxAO?.uvOffset ?? [0, 0])) };
		shader.uniforms.extraRainbowColor = {
			value: new Vector3(...(surface.rainbow?.color ?? [1, 1, 1])),
		};
		shader.uniforms.extraRainbowParams = {
			value: new Vector4(
				surface.rainbow?.tiling ?? 1,
				surface.rainbow?.distortion ?? 0,
				surface.rainbow?.intensity ?? 0,
				surface.rainbow?.threshold ?? 0,
			),
		};
		shader.uniforms.extraRainbowReverse = { value: surface.rainbow?.reverse ?? 0 };
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
#ifndef USE_UV1
attribute vec2 uv1;
#endif
#ifndef USE_UV3
attribute vec2 uv3;
#endif
uniform vec4 extraDetailWeights;
uniform vec2 extraDetailScale;
uniform float extraAOScale;
uniform vec2 extraAOOffset;
varying vec2 vExtraDetailUv;
varying vec2 vExtraAOUv;`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vExtraDetailUv = (uv * extraDetailWeights.x + uv1 * extraDetailWeights.y + uv2 * extraDetailWeights.z + uv3 * extraDetailWeights.w) * extraDetailScale;
vExtraAOUv = uv1 * extraAOScale + extraAOOffset;`,
			)
			.replace(
				'vSurfaceTintUv = mix(vSurfaceUv, uv2, homeTintUvBlend);',
				'vSurfaceTintUv = mix(vSurfaceUv, uv1, homeTintUvBlend);',
			);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			`#include <common>
varying vec2 vExtraDetailUv;
varying vec2 vExtraAOUv;
uniform sampler2D extraDetailMap;
uniform sampler2D extraRainbowMap;
uniform sampler2D extraAOMap;
uniform float extraDetailIntensity;
uniform vec4 extraAOChannel;
uniform vec3 extraRainbowColor;
uniform vec4 extraRainbowParams;
uniform float extraRainbowReverse;
vec2 extraNativeNormalXY;`,
		);
		// N retains the old Go glTF-G transport; N1 is raw native RG. Undo N's
		// storage conversion before the native blend, then reflect the combined
		// normal once back to glTF. normalScale only retains the loader's TBN sign.
		const normalMarker = 'mapN.xy *= normalScale;';
		if (!shader.fragmentShader.includes(normalMarker)) throw new Error('Captured surface normal insertion point is absent');

		shader.fragmentShader = shader.fragmentShader.replace(
			normalMarker,
			`
mapN.y = -mapN.y;
${
	surface.detail
		? `vec2 extraDetailRG = texture2D(extraDetailMap, vExtraDetailUv).rg * 2.0 - 1.0;
vec3 extraDetailN = mix(vec3(0.0, 0.0, 1.0), vec3(extraDetailRG, sqrt(max(1.0 - dot(extraDetailRG, extraDetailRG), 0.0))), extraDetailIntensity);
mapN = vec3(mapN.xy + extraDetailN.xy, mapN.z * extraDetailN.z);`
		: ''
}
extraNativeNormalXY = mapN.xy;
mapN.y = -mapN.y;
${normalMarker}`,
		);
		if (surface.auxAO) {
			shader.fragmentShader = shader.fragmentShader.replace(
				'clamp(mix(homeAo.x, homeAo.y, furnitureOrm.r), 0.0, 1.0)',
				'clamp(mix(homeAo.x, homeAo.y, furnitureOrm.r) * dot(texture2D(extraAOMap, vExtraAOUv), extraAOChannel), 0.0, 1.0)',
			);
		}

		if (surface.rainbow) {
			// cb0[17] is ViewToTranslatedWorld row 1: camera-up. Work in view
			// coordinates so this basis follows roll without an extra world matrix.
			const rainbowCode = `
vec3 extraView = normalize(vViewPosition);
vec3 extraRight = normalize(cross(extraView, vec3(0.0, 1.0, 0.0)));
vec3 extraUp = normalize(cross(-extraView, extraRight));
vec3 extraReflected = reflect(-extraView, normal);
vec2 extraRainbowUv = vec2(dot(extraReflected, extraRight), -dot(extraReflected, extraUp)) * 0.5;
extraRainbowUv = extraRainbowUv * extraRainbowParams.x + 0.5 + (extraNativeNormalXY - 0.5) * extraRainbowParams.y;
vec3 extraRainbowColorSample = texture2D(extraRainbowMap, extraRainbowUv).rgb * extraRainbowColor;
float extraRangeMask = furnitureOrm.b <= extraRainbowParams.w ? 1.0 : 0.0;
extraRangeMask = mix(extraRangeMask, 1.0 - extraRangeMask, extraRainbowReverse);
diffuseColor.rgb = clamp(mix(furnitureSurfaceBase, extraRainbowColorSample, extraRainbowParams.z * extraRangeMask), 0.0, 1.0);
#include <color_fragment>
`;
			// The core expands the normal chunk, so insert before the untouched
			// clearcoat stage, after the final tangent-to-view normal is available.
			const marker = '#include <clearcoat_normal_fragment_begin>';
			if (!shader.fragmentShader.includes(marker)) throw new Error('Captured surface rainbow insertion point is absent');

			shader.fragmentShader = shader.fragmentShader.replace(marker, `${rainbowCode}\n${marker}`);
		}
	};
	material.customProgramCacheKey = () => `${coreCacheKey}_extra_v2_${!!surface.detail}_${!!surface.rainbow}_${!!surface.auxAO}`;
	material.needsUpdate = true;
}
