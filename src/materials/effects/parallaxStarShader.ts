import {
	ClampToEdgeWrapping,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshStandardMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	NormalBlending,
	RepeatWrapping,
	SRGBColorSpace,
	Vector4,
	type Texture,
} from 'three';

interface ParallaxStarTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureParallaxStar {
	requiredUv: number[];
	blend: 'grey-transmittance';
	scalars: Record<string, number>;
	colors: Record<string, [number, number, number, number]>;
	textures: Record<string, ParallaxStarTexture>;
}

const scalarKeys = [
	'Normal',
	'ViewStarOffsetBias',
	'Light',
	'TextureFrequency',
	'RangeOffset',
	'UseStencil',
	'ExponentIn',
	'BaseReflectFractionIn',
	'Metallic',
	'Roughness',
	'Offset',
	'Falloff',
	'Thickness',
	'Opacity',
	'RefractionDepthBias',
];

const colorKeys = [
	'All Control',
	'Star Color',
	'Ground Color',
	'Ground Color2',
	'TextureEmissive',
	'SelectionColor',
	'Layer1',
	'Layer2',
	'Layer3',
	'Layer4',
	'Layer5',
	'Layer6',
	'Layer7',
	'Layer8',
];

const roleParameters: Record<string, string> = {
	D: 'Star texture',
	N: 'Normal',
	O: 'Roughness',
	B: 'Mask',
};

export function readFurnitureParallaxStar(value: unknown): FurnitureParallaxStar | null {
	if (!value || typeof value !== 'object') return null;

	const star = value as FurnitureParallaxStar;
	if (
		star.blend !== 'grey-transmittance' ||
		!star.scalars ||
		!star.colors ||
		!star.textures ||
		!Array.isArray(star.requiredUv) ||
		star.requiredUv.length !== 2 ||
		star.requiredUv[0] !== 0 ||
		star.requiredUv[1] !== 2 ||
		!scalarKeys.every((key) => typeof star.scalars[key] === 'number' && Number.isFinite(star.scalars[key])) ||
		!colorKeys.every(
			(key) =>
				Array.isArray(star.colors[key]) &&
				star.colors[key]!.length === 4 &&
				star.colors[key]!.every(Number.isFinite),
		)
	) return null;
	if (
		star.scalars.UseStencil !== 0 ||
		star.colors.SelectionColor![3] !== 0 ||
		star.scalars.Falloff! <= 0 ||
		star.scalars.Thickness! < 0 ||
		star.scalars.Opacity! < 0 ||
		star.scalars.Opacity! > 1
	) return null;

	for (const [role, parameter] of Object.entries(roleParameters)) {
		const texture = star.textures[role];
		if (
			!texture ||
			texture.parameter !== parameter ||
			texture.cube !== false ||
			texture.rgbScale !== 1 ||
			typeof texture.sRGB !== 'boolean' ||
			typeof texture.mipmaps !== 'boolean' ||
			typeof texture.nearest !== 'boolean' ||
			![texture.addressX, texture.addressY].every((address) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(address))
		) return null;
	}

	return star;
}

const parameterName = (name: string) => `ps${name.replace(/[^a-zA-Z0-9_]/g, '_')}`;

const fragmentDeclarations = /* glsl */ `
varying vec3 vStarPosition;
varying vec3 vStarNormal;
varying vec2 vStarUV0;
varying vec2 vStarUV2;
uniform bool starCoordinatesReady;
uniform vec4 starLayers[8];
uniform float starPreviewDepthDeltaCm;
mat3 starFrame(vec3 n) {
  vec3 dx = dFdx(vStarPosition), dy = dFdy(vStarPosition);
  vec2 ux = dFdx(vStarUV0), uy = dFdy(vStarUV0);
  vec3 t = cross(dy,n)*ux.x + cross(n,dx)*uy.x;
  vec3 b = cross(dy,n)*ux.y + cross(n,dx)*uy.y;
  float magnitude = max(dot(t,t),dot(b,b));
  if (magnitude < 0.00000001) {
    t = normalize(cross(abs(n.z)<0.9 ? vec3(0,0,1) : vec3(0,1,0),n));
    return mat3(t,cross(n,t),n);
  }
  return mat3(t*inversesqrt(magnitude),b*inversesqrt(magnitude),n);
}
`;

// 827ae0 ASM 149-234; VS 60d226 ASM 166-183,371-374. The latter
// packs pulsed emissive RGB beside UV0, not UV1/UV3 texture coordinates.
const core = /* glsl */ `
if (!starCoordinatesReady) discard;
mat3 starBasis = starFrame(normalize(vStarNormal));
vec3 starView = normalize(-vStarPosition);
float starDenominator = dot(starBasis[2],starView);
// Only a numerical grazing-angle guard; it does not retune layer depth.
starDenominator = abs(starDenominator)<0.000001 ? (starDenominator<0.0 ? -0.000001 : 0.000001) : starDenominator;
vec2 starParallax = vec2(dot(starBasis[0],starView),dot(starBasis[1],starView))/starDenominator;
float stars = 0.0;
for (int i=0; i<8; i++) {
  vec4 layer = starLayers[i];
  vec2 coordinates = vStarUV0*(layer.r*psAll_Control.r) +
    starParallax*((layer.g*psAll_Control.g-0.5)*(layer.b*psAll_Control.b));
  float sampled = texture2D(starD,coordinates).r;
  stars += sampled*sampled*(layer.a*psAll_Control.a);
}
// View CB[18].z is ViewToTranslatedWorld[2].z: native camera forward Z,
// not sky colour or a day/night value. Editor and native world share Z-up;
// Three camera forward is -Z, so its world-Z component is -viewMatrix[2][2].
float starCameraForwardZ = -viewMatrix[2][2];
float starGate = clamp(-starCameraForwardZ-psViewStarOffsetBias,0.0,1.0)*psLight;
vec3 starEmission = stars*psStar_Color.rgb*starGate;
// Native time is frozen at zero, therefore sin(0)=0; TextureFrequency
// is a rate, not an extra static offset or a missing RGB intensity.
starEmission += texture2D(starB,vStarUV2).rgb*psTextureEmissive.rgb*(0.5+psRangeOffset);
vec2 starNormalXY = texture2D(starN,vStarUV0).rg*2.0-1.0;
starNormalXY.y = -starNormalXY.y;
vec3 starTangentNormal = vec3(starNormalXY,sqrt(max(1.0-dot(starNormalXY,starNormalXY),0.0)));
vec3 starSurfaceNormal = normalize(starBasis*mix(starTangentNormal,vec3(0,0,1),psNormal));
float starFresnel = pow(max(abs(1.0-max(dot(starSurfaceNormal,starView),0.0)),0.0001),psExponentIn);
starFresnel = starFresnel*(1.0-psBaseReflectFractionIn)+psBaseReflectFractionIn;
diffuseColor.rgb *= clamp(mix(psGround_Color2.rgb,psGround_Color.rgb,starFresnel),0.0,1.0);
// Source depth is world-Z reconstructed behind translucency, not a PNG
// alpha or camera distance. No scene-depth pass is invented in this preview.
diffuseColor.a = clamp(exp2(-1.438293*(starPreviewDepthDeltaCm+psOffset)*psThickness/psFalloff)*psOpacity,0.0,1.0);
`;

/** One ordinary PBR pass with captured emission and grey transmittance.
 * Native lighting/SSR and scene-depth attenuation remain explicit preview
 * approximations; there is no colour/white-background compensation.
 */
export function createParallaxStarMaterial(star: FurnitureParallaxStar, textures: Partial<Record<string, Texture | null>>): MeshStandardMaterial {
	if (!readFurnitureParallaxStar(star)) throw new Error('[ModelManager][ParallaxStar] invalid captured contract');
	// Check every source before cloning, so a refused missing mask owns nothing.
	for (const role of Object.keys(roleParameters)) {
		if (!textures[role]) throw new Error(`[ModelManager][ParallaxStar] missing captured source role ${role}`);
	}

	const owned: Texture[] = [];
	const sampling: Record<string, Texture> = {};

	const wrap = (value: string) =>
		value === 'TA_Clamp'
			? ClampToEdgeWrapping
			: value === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const role of Object.keys(roleParameters)) {
		const contract = star.textures[role]!;
		const texture = textures[role]!.clone();
		// Native sRGB is retained even for R-only stars and the RGB mask.
		texture.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = wrap(contract.addressX);
		texture.wrapT = wrap(contract.addressY);
		texture.generateMipmaps = contract.mipmaps;
		texture.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = contract.nearest
			? NearestFilter
			: contract.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		texture.needsUpdate = true;
		sampling[role] = texture;
		owned.push(texture);
	}

	const material = new MeshStandardMaterial({
		transparent: true,
		opacity: 1,
		depthWrite: false,
		metalness: star.scalars.Metallic!,
		roughness: 1,
		forceSinglePass: true,
		// GreyTransmittance is enum alias 2 (BLEND_Translucent). This captured
		// legacy PS writes straight RGB (ASM 3649-3655), not premultiplied RGB;
		// non-Substrate BasePassRendering.cpp uses SrcAlpha/InvSrcAlpha.
		blending: NormalBlending,
		premultipliedAlpha: false,
	});
	material.userData.parallaxStar = star;
	material.addEventListener('dispose', () => owned.forEach((texture) => texture.dispose()));

	const ready = { value: true };
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		ready.value = star.requiredUv.every((channel) => !!geometry.getAttribute(channel === 0 ? 'uv' : `uv${channel}`));
	};
	material.customProgramCacheKey = () => 'parallax-star-native-827ae0-1';
	material.onBeforeCompile = (shader) => {
		shader.uniforms.starCoordinatesReady = ready;
		shader.uniforms.starLayers = {
			value: Array.from({ length: 8 }, (_, i) => new Vector4(...star.colors[`Layer${i + 1}`]!)),
		};
		shader.uniforms.starPreviewDepthDeltaCm = { value: 0 };

		let uniforms = '';
		for (const [key, value] of Object.entries(star.scalars)) {
			const name = parameterName(key);
			shader.uniforms[name] = { value };
			uniforms += `uniform float ${name};\n`;
		}

		for (const [key, value] of Object.entries(star.colors)) {
			const name = parameterName(key);
			shader.uniforms[name] = { value: new Vector4(...value) };
			uniforms += `uniform vec4 ${name};\n`;
		}

		for (const [role, texture] of Object.entries(sampling)) {
			shader.uniforms[`star${role}`] = { value: texture };
			uniforms += `uniform sampler2D star${role};\n`;
		}

		shader.vertexShader =
		/* glsl */ `
varying vec3 vStarPosition;
varying vec3 vStarNormal;
varying vec2 vStarUV0;
varying vec2 vStarUV2;
#ifndef USE_UV2
attribute vec2 uv2;
#endif
` +
			shader.vertexShader.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
vStarPosition = mvPosition.xyz;
vStarNormal = normalize(transformedNormal);
vStarUV0 = uv; vStarUV2 = uv2;`,
			);
		shader.fragmentShader = uniforms + fragmentDeclarations + shader.fragmentShader;
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <map_fragment>', core)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
roughnessFactor = clamp(texture2D(starO,vStarUV0).g*psRoughness,0.0,1.0);`,
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
normal = starSurfaceNormal;`,
			)
			.replace(
				'#include <emissivemap_fragment>',
				`#include <emissivemap_fragment>
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
starEmission *= vColor.rgb;
#endif
totalEmissiveRadiance = max(starEmission,vec3(0));`,
			);
	};
	return material;
}
