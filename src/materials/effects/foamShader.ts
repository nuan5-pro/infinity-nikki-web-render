import {
	Color,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshStandardMaterial,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4,
	type Texture,
} from 'three';

export const FOAM_MASK_ATTRIBUTE = 'foamMask';

interface FoamLevel {
	name: 'XL' | 'L' | 'M' | 'S' | 'XS';
	scale: number;
	density: number;
	weight: number;
	row: 0 | 1;
	vertexRed: boolean;
}

export interface FurnitureFoam {
	family: 'int-foam-v01';
	version: 1;
	mode: 'surface' | 'volume-mask' | 'volume-emissive';
	curve: 'ca-bubble-r01-linearfit-v1';
	vertexMask: 'localvf-rga';
	textureSRGB: [boolean, boolean, boolean, boolean];
	textureMipmaps: [boolean, boolean, boolean, boolean];
	levels: FoamLevel[];
	cutoff: number;
	normalStrength: number;
	baseColor: [number, number, number];
	liquidColor: [number, number, number];
	outlineColor: [number, number, number];
	outline: [number, number];
	whiteOpacity: number;
	opacity: number;
	reflectionPower: number;
	fresnelPower: number;
	edgeFade: number;
	matcapNormalOffset: number;
	matcapIntensity: number;
	matcapDot: [number, number, number];
	emission: [number, number, number];
	shadowAlpha: number;
	roughness: number;
	defaultMask: boolean;
}

function finiteArray(value: unknown, length: number): boolean {
	return (
		Array.isArray(value) &&
		value.length === length &&
		value.every((component) => typeof component === 'number' && Number.isFinite(component))
	);
}

export function readFurnitureFoam(value: unknown): FurnitureFoam | null {
	if (!value || typeof value !== 'object') return null;

	const f = value as Record<string, unknown>;
	if (
		f.family !== 'int-foam-v01' ||
		f.version !== 1 ||
		f.vertexMask !== 'localvf-rga' ||
		f.curve !== 'ca-bubble-r01-linearfit-v1' ||
		!['surface', 'volume-mask', 'volume-emissive'].includes(String(f.mode)) ||
		typeof f.defaultMask !== 'boolean'
	) return null;

	for (const key of ['textureSRGB', 'textureMipmaps']) {
		if (
			!Array.isArray(f[key]) ||
			f[key].length !== 4 ||
			!f[key].every((component) => typeof component === 'boolean')
		) return null;
	}

	for (const key of ['baseColor', 'liquidColor', 'outlineColor', 'matcapDot', 'emission']) {
		if (!finiteArray(f[key], 3)) return null;
	}

	if (!finiteArray(f.outline, 2)) return null;

	for (const key of [
		'cutoff',
		'normalStrength',
		'whiteOpacity',
		'opacity',
		'reflectionPower',
		'fresnelPower',
		'edgeFade',
		'matcapNormalOffset',
		'matcapIntensity',
		'shadowAlpha',
		'roughness',
	]) {
		if (typeof f[key] !== 'number' || !Number.isFinite(f[key])) return null;
	}

	if (!Array.isArray(f.levels) || f.levels.length < 3 || f.levels.length > 5) return null;

	for (const value of f.levels) {
		if (!value || typeof value !== 'object') return null;

		const level = value as Record<string, unknown>;
		if (
			!['XL', 'L', 'M', 'S', 'XS'].includes(String(level.name)) ||
			(level.row !== 0 && level.row !== 1) ||
			typeof level.vertexRed !== 'boolean'
		) return null;

		for (const key of ['scale', 'density', 'weight']) {
			if (typeof level[key] !== 'number' || !Number.isFinite(level[key])) return null;
		}

		const l = value as FoamLevel;
		if (
			l.scale <= 0 ||
			l.weight < 0 ||
			(l.name === 'XS' ? l.density !== -1 : l.density < 0) ||
			l.row !== (l.name === 'S' || l.name === 'XS' ? 1 : 0) ||
			l.vertexRed !== (l.row === 0)
		) return null;
	}

	const profile = value as FurnitureFoam;
	const names = new Set(profile.levels.map((level) => level.name));
	const sampleCount = new Set(profile.levels.map((level) => level.scale)).size + 1 + Number(!profile.defaultMask);
	if (
		names.size !== profile.levels.length ||
		!names.has('S') ||
		!names.has('XS') ||
		!profile.levels.some((level) => level.row === 0) ||
		sampleCount > 5 ||
		profile.roughness < 0 ||
		profile.roughness > 1 ||
		profile.opacity < 0 ||
		profile.reflectionPower < 0 ||
		profile.fresnelPower < 0 ||
		profile.edgeFade < 0 ||
		profile.outline[0] < 0 ||
		profile.whiteOpacity < 0 ||
		profile.matcapIntensity < 0 ||
		profile.shadowAlpha < 0 ||
		profile.shadowAlpha > 1 ||
		(profile.mode === 'surface'
			? profile.cutoff !== 0 || profile.normalStrength < 0
			: profile.cutoff !== 0.3333 || profile.normalStrength > 0) ||
		(profile.mode === 'volume-emissive' && !profile.defaultMask) ||
		profile.textureSRGB[1] ||
		!profile.textureMipmaps[1]
	) return null;

	const activeSlots =
		profile.mode === 'surface'
			? [!profile.defaultMask, true, true, false]
			: [true, true, false, !profile.defaultMask];
	for (let i = 0; i < 4; i++) {
		if (
			profile.textureMipmaps[i] !== activeSlots[i] ||
			profile.textureSRGB[i] !== (activeSlots[i] && i !== 1)
		) return null;
	}

	for (const color of [
		profile.baseColor,
		profile.liquidColor,
		profile.outlineColor,
		profile.matcapDot,
		profile.emission,
	]) {
		if (color.some((channel) => channel < 0)) return null;
	}

	return profile;
}

// Source CA_BubbleCurves PF_FloatRGBA mip0, rows 0/1 (sample-centre UV).
// Piecewise fits retain its abrupt falloff; max absolute errors .00912/.00757.
// No invented Voronoi/noise or generated LUT replaces the native RGBA texture.
const curveKnots: [number, number][][] = [
	[
		[0.001953125, 1],
		[0.095703125, 0.94482421875],
		[0.189453125, 0.8642578125],
		[0.255859375, 0.775390625],
		[0.294921875, 0.6884765625],
		[0.318359375, 0.59423828125],
		[0.330078125, 0.4970703125],
		[0.333984375, 0.4287109375],
		[0.337890625, 0],
		[0.998046875, 0],
	],
	[
		[0.001953125, 1],
		[0.150390625, 0.93408203125],
		[0.267578125, 0.8583984375],
		[0.345703125, 0.783203125],
		[0.408203125, 0.68408203125],
		[0.427734375, 0.63330078125],
		[0.443359375, 0.5732421875],
		[0.451171875, 0.52783203125],
		[0.458984375, 0.450927734375],
		[0.462890625, 0.36474609375],
		[0.466796875, 0],
		[0.998046875, 0],
	],
];

function curveFunction(row: number): string {
	const points = curveKnots[row]!;
	const terms = points.slice(1).flatMap((point, i) => {
		const previous = points[i]!;
		const change = point[1] - previous[1];
		return change === 0
			? []
			: [
				`${change.toFixed(12)} * clamp((phase - ${previous[0].toFixed(12)}) / ${(point[0] - previous[0]).toFixed(12)}, 0.0, 1.0)`,
			];
	});
	return `float foamCurve${row}(float phase) { return clamp(1.0 + ${terms.join(' + ')}, 0.0, 1.0); }`;
}

/** Five samples maximum, one source-mode pass. Real mask.R / Voronoi.R,A /
 * albedo RGB / matcap RGB,G consumers are retained; source screen/time/WPO,
 * subsurface lighting and any budget-omitted scales are explicit approximations.
 */
export function createFoamMaterial(
	foam: FurnitureFoam,
	diffuse: Texture | null,
	voronoi: Texture | null,
	matcap: Texture | null,
	mask: Texture | null,
): MeshStandardMaterial {
	const surface = foam.mode === 'surface';
	if (
		!voronoi ||
		(surface
			? !matcap || (!foam.defaultMask && !diffuse)
			: !diffuse || (!foam.defaultMask && !mask))
	) throw new Error('Furniture foam core requires its exact captured texture bindings');

	const textures = [diffuse, voronoi, matcap, mask].map((source, i) => {
		if (!source) return null;

		const texture = source.clone();
		texture.colorSpace = foam.textureSRGB[i] ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = RepeatWrapping;
		texture.wrapT = RepeatWrapping;
		texture.magFilter = LinearFilter;
		texture.minFilter = foam.textureMipmaps[i] ? LinearMipmapLinearFilter : LinearFilter;
		texture.generateMipmaps = foam.textureMipmaps[i]!;
		texture.needsUpdate = true;
		return texture;
	});
	// bf801 L335/447 is lit base colour; L568/618-619 adds emission separately.
	// Adding the lit base to Basic/unlit emission made the entire carrier a film.
	const material = new MeshStandardMaterial({
		transparent: surface,
		depthWrite: !surface,
		alphaTest: surface ? 0 : foam.cutoff,
		roughness: foam.roughness,
		metalness: 0,
		emissive: new Color(...foam.emission),
		forceSinglePass: true,
	});
	material.userData.foam = foam;
	material.addEventListener('dispose', () => textures.forEach((texture) => texture?.dispose()));

	const scales = [...new Set(foam.levels.map((level) => level.scale))];
	const sampleIds = foam.levels.map((level) => scales.indexOf(level.scale));
	material.onBeforeCompile = (shader) => {
		const uniforms: Record<string, { value: unknown }> = {
			foamD: { value: textures[0] },
			foamVoronoi: { value: textures[1] },
			foamO: { value: textures[2] },
			foamT: { value: textures[3] },
			foamBase: { value: new Vector3(...foam.baseColor) },
			foamLiquid: { value: new Vector3(...foam.liquidColor) },
			foamOutlineColor: { value: new Vector3(...foam.outlineColor) },
			foamOutline: { value: new Vector2(...foam.outline) },
			foamMatcapDot: { value: new Vector3(...foam.matcapDot) },
			foamNormalStrength: { value: foam.normalStrength },
			foamWhiteOpacity: { value: foam.whiteOpacity },
			foamOpacity: { value: foam.opacity },
			foamReflectionPower: { value: foam.reflectionPower },
			foamFresnelPower: { value: foam.fresnelPower },
			foamEdgeFade: { value: foam.edgeFade },
			foamMatcapNormalOffset: { value: foam.matcapNormalOffset },
			foamMatcapIntensity: { value: foam.matcapIntensity },
			foamShadowAlpha: { value: foam.shadowAlpha },
		};

		const sampled = new Set<number>();
		const levels = foam.levels
			.map((level, i) => {
				uniforms[`foamLevel${i}`] = {
					value: new Vector4(level.scale, level.density, level.weight, level.row),
				};

				const sampleId = sampleIds[i]!;
				const lookup = sampled.has(sampleId)
					? ''
					: `vec4 foamCell${sampleId} = texture2D(foamVoronoi, vFoamUv * foamLevel${i}.x);`;
				sampled.add(sampleId);
				return `${lookup}
float foamH${i} = foamCurve${level.row}(foamCell${sampleId}.a) * foamLevel${i}.z ${level.density === -1 ? '' : `* step(foamCell${sampleId}.r, foamLevel${i}.y)`} ${level.vertexRed ? '* vFoamMask.r' : ''};
foamHeight = max(foamHeight, foamH${i});`;
			})
			.join('\n');
		Object.assign(shader.uniforms, uniforms);

		const varyings = `varying vec2 vFoamUv;
varying vec4 vFoamMask;
varying vec3 vFoamNormal, vFoamView;`;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
${varyings}
attribute vec4 ${FOAM_MASK_ATTRIBUTE};`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vFoamUv = uv;
vFoamMask = ${FOAM_MASK_ATTRIBUTE};
vFoamNormal = transformedNormal;`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
vFoamView = -mvPosition.xyz;`,
			);

		const declarations = `${varyings}
uniform sampler2D foamD, foamVoronoi, foamO, foamT;
uniform vec4 ${foam.levels.map((_, i) => `foamLevel${i}`).join(', ')};
uniform vec3 foamBase, foamLiquid, foamOutlineColor, foamMatcapDot;
uniform vec2 foamOutline;
uniform float foamNormalStrength, foamWhiteOpacity, foamOpacity, foamReflectionPower, foamFresnelPower;
uniform float foamEdgeFade, foamMatcapNormalOffset, foamMatcapIntensity, foamShadowAlpha;
${curveFunction(0)}
${curveFunction(1)}
float foamPositivePow(float value, float exponent) {
  return value <= 0.0 ? 0.0 : pow(value, exponent);
}
vec3 foamGradientNormal(vec3 n, vec3 position, float height) {
  vec3 dx = dFdx(position), dy = dFdy(position);
  vec3 rx = cross(dy, n), ry = cross(n, dx);
  float determinant = dot(dx, rx);
  vec3 gradient = dFdx(height) * rx + dFdy(height) * ry;
  if (abs(determinant) < 1e-12) return n;
  return normalize(abs(determinant) * n - sign(determinant) * foamNormalStrength * gradient);
}`;
		const common = `float foamHeight = 0.0;
${levels}
vec3 foamN = foamGradientNormal(normalize(vFoamNormal), -vFoamView, clamp(foamHeight, 0.0, 1.0));`;
		const body = surface
			? `${common}
vec3 foamView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vFoamView);
float foamEdge = max(abs(1.0 - max(dot(foamN, foamView), 0.0)), 0.0001);
float foamReflection = 0.04 + 0.96 * pow(foamEdge, foamReflectionPower);
vec4 foamMaskTexel = ${foam.defaultMask ? 'vec4(1.0)' : 'texture2D(foamD, vFoamUv)'};
float foamOutlineHeight = foamPositivePow(foamHeight, foamOutline.x);
float foamOutlineSlope = max(abs(dFdx(foamOutlineHeight)), abs(dFdy(foamOutlineHeight)));
float foamOutlineValue = foamPositivePow(foamOutlineSlope, foamOutline.y);
// Captured offset mixes towards world Z before camera projection, not camera Z.
// geometryPipeline restores source centimetres and uses scene Z as world up.
vec3 foamWorldUp = normalize(mat3(viewMatrix) * vec3(0.0, 0.0, 1.0));
vec3 foamOffsetNormal = mix(foamN, foamWorldUp, foamMatcapNormalOffset);
// CUE SwapYZ + geometry's final transforms map UE(x,y,z) to Three(y,-x,z).
// For the same physical camera UE view is (+right,+up,+forward), while Three
// view is (-sourceRight,+up,-forward). Restore BOTH X/Z before ASM swizzles.
vec3 foamViewUE = foamView * vec3(-1.0, 1.0, -1.0);
vec3 foamOffsetNormalUE = foamOffsetNormal * vec3(-1.0, 1.0, -1.0);
vec2 foamMatcapUv = vec2(0.5) - 0.5 * cross(foamViewUE, foamOffsetNormalUE).yx;
vec3 foamMatcap = texture2D(foamO, foamMatcapUv).rgb;
float foamLiquidPresent = 1.0 - step(foamHeight * foamReflection, 0.01) * clamp(vFoamMask.a, 0.0, 1.0);
vec3 foamCoreRgb = foamOutlineColor * foamOutlineValue + vec3(foamMaskTexel.r * foamWhiteOpacity) +
  foamLiquid * foamLiquidPresent + foamMatcap * foamMaskTexel.g * foamMatcapIntensity;
vec3 foamSourceEmission = max(foamCoreRgb * foamCoreRgb, vec3(0.0));
diffuseColor.rgb *= clamp(foamBase, 0.0, 1.0);
float foamCoverage = foamMaskTexel.r * (foamHeight * foamReflection + foamMaskTexel.r * foamWhiteOpacity +
  clamp(dot(foamMatcapDot, foamMatcap * 0.5), 0.0, 1.0)) * foamOpacity;
foamCoverage *= 0.04 + 0.96 * pow(foamEdge, foamFresnelPower);
foamCoverage *= 1.0 - (0.002 + 0.998 * pow(foamEdge, foamEdgeFade));
diffuseColor.a *= clamp(foamCoverage, 0.0, 1.0);`
			: `${common}
vec3 foamAlbedo = min(texture2D(foamD, vFoamUv).rgb, vec3(1.0));
float foamMaskRed = ${foam.defaultMask ? '1.0' : 'texture2D(foamT, vFoamUv).r'};
diffuseColor.rgb *= foamAlbedo;
diffuseColor.a *= clamp(foamMaskRed ${foam.mode === 'volume-emissive' ? '* mix(foamShadowAlpha, 1.0, vFoamMask.g) * vFoamMask.a' : ''}, 0.0, 1.0);`;
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${declarations}`)
			.replace('#include <map_fragment>', body)
			.replace('#include <alphamap_fragment>', '');
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <normal_fragment_maps>',
				'#include <normal_fragment_maps>\nnormal = foamN;',
			)
			.replace(
				'#include <emissivemap_fragment>',
				`${
					surface
						? 'totalEmissiveRadiance = foamSourceEmission * diffuse;'
						: 'totalEmissiveRadiance *= foamAlbedo * diffuse;'
				}
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
totalEmissiveRadiance *= vColor.rgb;
#endif`,
			);
		// Leave stock color_fragment untouched: instance colour/highlight remains
		// independent of the native source R/G/A mask. Never enable vertexColors.
	};
	material.customProgramCacheKey = () =>
		`furniture_foam_v1_${foam.mode}_${foam.defaultMask}_${foam.levels.map((level) => level.name).join('_')}_${sampleIds.join('_')}`;
	return material;
}
