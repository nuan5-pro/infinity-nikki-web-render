import {
	ClampToEdgeWrapping,
	DoubleSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector3,
	Vector4,
	type Material,
	type Texture,
} from 'three';
import { createClothMaterial, readFurnitureCloth, type FurnitureCloth } from './clothShader.js';

interface ClothColourTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureClothStaticCore {
	version: 1;
	family: 'cloth-static-colour-core';
	cloth: FurnitureCloth;
	scalars: Record<string, number>;
	colors: Record<string, [number, number, number, number]>;
	textures: Record<string, ClothColourTexture>;
}

const scalarKeys = [
	'Rainbow_Warp_Tiling',
	'Rainbow_Warp',
	'Rainbow_Tiling',
	'Rainbow_D_BlendWeight',
	'Glint_TotalEmissiveControl',
	'Glint_TotalBaseColorControl',
	'Glint_TextureTiling',
	'Glint_HeightRatio',
	'Glint_TextureDepth',
	'Glint_ShiningSpeed',
	'Glint_Size1',
	'Glint_Size2',
	'Glint_NormalFlatten',
	'Glint_FlipSpecRange',
	'Glint_SpecRange',
	'GlintIntensityInShadow',
	'Glint_ViewRange',
	'Glint_InverseViewRange',
	'Glint_NormalWeight',
];

const colorKeys = [
	'Rainbow_Color(A:EmissiveIntensity)',
	'Glint_Color1',
	'Glint_Color2',
	'Cloth_MaskTintColor',
];

const roles = ['D', 'N', 'O', 'N1', 'B', 'C', 'D1', 'O1', 'M', 'T'];
const extraRoles = ['B', 'C', 'D1', 'O1', 'M', 'T'];
const parameter = (key: string) => `cs${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;

export function readFurnitureClothStaticCore(value: unknown): FurnitureClothStaticCore | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureClothStaticCore;
	if (
		p.version !== 1 ||
		p.family !== 'cloth-static-colour-core' ||
		!readFurnitureCloth(p.cloth) ||
		p.cloth.mainUvChannel !== 0 ||
		p.cloth.maskUvChannel !== 0 ||
		p.cloth.fourthRole !== 'detail-normal' ||
		p.cloth.mode !== 'masked' ||
		!p.scalars ||
		!p.colors ||
		!p.textures ||
		scalarKeys.some((key) => !Number.isFinite(p.scalars[key])) ||
		colorKeys.some(
			(key) =>
				!Array.isArray(p.colors[key]) ||
				p.colors[key]!.length !== 4 ||
				!p.colors[key]!.every(Number.isFinite),
		)
	) return null;

	for (const role of roles) {
		const t = p.textures[role];
		if (
			!t ||
			typeof t.parameter !== 'string' ||
			!t.parameter ||
			typeof t.sRGB !== 'boolean' ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			t.cube !== false ||
			t.rgbScale !== 1 ||
			![t.addressX, t.addressY].every((a) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(a))
		) return null;
	}

	return p;
}

const colourCore = /* glsl */ `
vec3 csReflected=reflect(-clothView,normal);
vec3 csRight=cross(-clothView,vec3(0,1,0));
csRight=dot(csRight,csRight)>.00000001?normalize(csRight):vec3(1,0,0);
vec3 csUp=normalize(cross(-clothView,csRight));
vec2 csRainbowUV=(vec2(dot(csReflected,csRight),-dot(csReflected,csUp))*.5+.5)*csRainbow_Tiling;
csRainbowUV+=texture2D(csB,vClothMainUV*(2.0*csRainbow_Warp_Tiling)/clothMainScale).rg*csRainbow_Warp;
vec3 csRainbow=texture2D(csC,csRainbowUV).rgb*csRainbow_Color_A_EmissiveIntensity_.rgb;
float csRainbowMask=texture2D(csM,vClothMainUV/clothMainScale).r;
vec2 csUV=vClothMainUV/clothMainScale;
vec2 csParallax=vec2(dot(tbn[0],clothView),dot(tbn[1],clothView))*csGlint_HeightRatio*(csGlint_TextureDepth-.5);
vec2 csGlintUV=csUV*csGlint_TextureTiling+csParallax;
vec2 csGlintFirstRG=texture2D(csD1,csGlintUV).rg;
vec2 csGlintRG=texture2D(csD1,csGlintUV+csCameraNativeDirection.xy*csGlint_ShiningSpeed).rg;
vec2 csChannels=max(csGlintFirstRG*csGlintRG,vec2(0));
vec3 csGlint=pow(csChannels.x,csGlint_Size1)*csGlint_Color1.rgb*csGlint_Color1.a
  +pow(csChannels.y,csGlint_Size2)*csGlint_Color2.rgb*csGlint_Color2.a;
// Exact admitted source UseFixedGlintMask=0 samples its mask at zero UV.
csGlint*=texture2D(csO1,vec2(0)).r;
vec3 csGlintMap=mix(mapN,vec3(0,0,1),csGlint_NormalFlatten);
vec3 csGlintNormal=(tbn*csGlintMap)*faceDirection;
vec3 csLight=vec3(0,0,1),csLightColor=vec3(.12);
#if NUM_DIR_LIGHTS > 0
csLight=directionalLights[0].direction;
csLightColor=max(directionalLights[0].color,vec3(.12));
#endif
vec3 csHalf=normalize(clothView+csLight);
float csNH=clamp(dot(csGlintNormal,csHalf),0.0,1.0);
csNH=mix(csNH,1.0-csNH,csGlint_FlipSpecRange);
float csSpec=pow(max(csNH,0.0),csGlint_SpecRange)*max(csGlintIntensityInShadow,1.0);
float csView=pow(clamp(dot(csGlintNormal,clothView),0.0,1.0),csGlint_ViewRange);
csView=mix(csView,1.0-csView,csGlint_InverseViewRange);
float csNormalWeight=1.0-pow(max(dot(mapN.xy,mapN.xy),0.0),csGlint_NormalWeight);
csGlint*=csLightColor*csSpec*csView*csNormalWeight;
vec3 csAlbedo=mix(diffuseColor.rgb,csCloth_MaskTintColor.rgb,texture2D(csT,vClothMaskUV).r);
vec3 csSurface=mix(clothAniso+clothEdge,csRainbow,csRainbowMask*csRainbow_D_BlendWeight);
diffuseColor.rgb=clamp(csAlbedo+csSurface+csGlint*csGlint_TotalBaseColorControl,0.0,1.0);
`;

export function createClothStaticCoreMaterial(
	profile: FurnitureClothStaticCore,
	textures: Record<string, Texture | null | undefined>,
	source: Material,
) {
	if (!readFurnitureClothStaticCore(profile)) throw new Error('[ClothStaticCore] invalid source profile');

	for (const role of roles)
		if (!textures[role]) throw new Error(`[ClothStaticCore] missing active texture ${role}`);

	const material = createClothMaterial(
		profile.cloth,
		textures.D ?? null,
		textures.N ?? null,
		textures.O ?? null,
		textures.N1 ?? null,
		source,
	);
	material.side = DoubleSide;
	material.userData.clothStaticCore = profile;

	const sampling: Record<string, Texture> = {};

	const wrap = (v: string) =>
		v === 'TA_Clamp'
			? ClampToEdgeWrapping
			: v === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const role of extraRoles) {
		const texture = textures[role];
		const contract = profile.textures[role]!;
		if (!texture) throw new Error(`[ClothStaticCore] missing active texture ${role}`);

		const owned = texture.clone();
		owned.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		owned.wrapS = wrap(contract.addressX);
		owned.wrapT = wrap(contract.addressY);
		owned.repeat.set(1, 1);
		owned.offset.set(0, 0);
		owned.generateMipmaps = contract.mipmaps;
		owned.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		owned.minFilter = contract.nearest
			? NearestFilter
			: contract.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		owned.needsUpdate = true;
		sampling[role] = owned;
	}

	const cameraDirection = { value: new Vector3() };
	const objectPosition = new Vector3();
	material.onBeforeRender = (_renderer, _scene, camera, geometry, object) => {
		if (!geometry.getAttribute('uv')) throw new Error('[ClothStaticCore] missing source UV0');

		camera.getWorldPosition(cameraDirection.value);
		object.getWorldPosition(objectPosition);
		cameraDirection.value.sub(objectPosition).normalize();
		// Final editor world is already Z-up; reverse its native-Y reflection.
		const direction = cameraDirection.value;
		direction.y = -direction.y;
	};
	material.addEventListener('dispose', () => Object.values(sampling).forEach((texture) => texture.dispose()));

	const compile = material.onBeforeCompile;
	const cache = material.customProgramCacheKey();
	material.customProgramCacheKey = () => `${cache}_static-active-glint-rainbow-1`;
	material.onBeforeCompile = (shader, renderer) => {
		compile.call(material, shader, renderer);

		let uniforms = 'uniform float clothMainScale;\nuniform vec3 csCameraNativeDirection;\n';
		shader.uniforms.csCameraNativeDirection = cameraDirection;
		for (const key of scalarKeys) {
			uniforms += `uniform float ${parameter(key)};\n`;
			shader.uniforms[parameter(key)] = { value: profile.scalars[key] };
		}

		for (const key of colorKeys) {
			uniforms += `uniform vec4 ${parameter(key)};\n`;
			shader.uniforms[parameter(key)] = { value: new Vector4(...profile.colors[key]!) };
		}

		for (const role of extraRoles) {
			uniforms += `uniform sampler2D cs${role};\n`;
			shader.uniforms[`cs${role}`] = { value: sampling[role] };
		}

		shader.fragmentShader =
			uniforms +
			shader.fragmentShader
				.replace('diffuseColor.rgb = clamp(clothShadowBase + clothEdge, 0.0, 1.0);', colourCore)
				.replace(
					'// Native edge/aniso emission alpha can be negative.',
					`totalEmissiveRadiance += csRainbow*csRainbowMask*csRainbow_Color_A_EmissiveIntensity_.a+csGlint*csGlint_TotalEmissiveControl;
// Native edge/aniso emission alpha can be negative.`,
				);
	};
	return material;
}
