import {
	ClampToEdgeWrapping,
	DoubleSide,
	FrontSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshBasicMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector3,
	Vector4,
	type Texture,
} from 'three';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';
import { getEditorMaterialPreviewContext } from '../jewel/characterJewelPreview.js';

interface AnimalTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureAnimalSimpleTrans {
	version: 1;
	family: 'animal-simple-trans';
	variant: 'glow' | 'pattern' | 'pattern-single-sided';
	requiredUv: number[];
	scalars: Record<string, number>;
	colors: Record<string, [number, number, number, number]>;
	textures: Record<string, AnimalTexture>;
}

const scalarKeys = [
	'Main_Tiling',
	'Main_NTiling',
	'Main_NormalIntensity',
	'Emissive_FresnelMask_Range',
	'Emissive_FresnelMask_Power',
	'FresnelMask_Add_ExtraMask',
	'EdgeLight_Range',
	'EdgeLight_UseCoatingMask',
	'Glow_speed_X',
	'Glow_speed_Y',
	'Glow_Tile',
	'Glow_Brightness',
	'Glow_BreathSpeed',
	'Glow_BreathInterval',
	'Glow_BreathEnhance',
	'Rainbow_Warp_Tiling',
	'Rainbow_Warp',
	'Rainbow_Tiling',
	'Rainbow_D_BlendWeight',
	'RainbowEmissiveInShadow',
	'CoatingPower',
	'CoatingBaseReflect',
	'CoatingModeSelect',
	'CoatingEmissiveInShadow',
	'AnimalEmissiveBackSide',
	'AnimalEmissivewithLighting',
	'Opacity_Min',
	'Opacity_Max',
	'Opacity_EdgeRange',
	'Opacity_BlendMode',
];

const colorKeys = [
	'Main_D_ColorTint',
	'Main_EmissiveColorTint',
	'EdgeLight_Color(A:EmissiveIntensity)',
	'Extra_UVSelect',
	'Glow_Color',
	'Rainbow_Warp_Panner',
	'Rainbow_Color(A:EmissiveIntensity)',
	'CoatingColorTint(A:EmissiveIntensity)',
];

const roles = ['D', 'N', 'T', 'O', 'C', 'B', 'S', 'D1', 'O1'];

const glowGlintScalars = [
	'GlintsEmissiveInShadow',
	'GlintSizeMax',
	'GlintSizeMin',
	'GlintDensity',
	'GlintSpeedbyTime',
	'GlintRoughness',
	'GlintColorRandom',
	'GlintColorbyDiffuse',
	'GlintwithLighting',
];

const parameter = (key: string) => `a${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;

function activeKeys(variant: FurnitureAnimalSimpleTrans['variant']) {
	if (variant === 'glow') return {
		scalars: [...scalarKeys, ...glowGlintScalars],
		colors: [...colorKeys, 'GlintColor'],
		roles,
	};

	return {
		scalars: [
			...scalarKeys.filter((key) => !key.startsWith('Glow_')),
			'PatternHeightRatio',
			'Pattern_HueShift',
			'Pattern Emissive',
		],
		colors: [
			...colorKeys.filter((key) => key !== 'Glow_Color'),
			'Pattern UVSelect',
			'Pattern TilingOffset',
			'Ani_2U_BlendAttr',
			'Pattern_ColorTint',
		],
		roles: [...roles.filter((role) => role !== 'O1'), 'N1'],
	};
}

export function readFurnitureAnimalSimpleTrans(value: unknown): FurnitureAnimalSimpleTrans | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureAnimalSimpleTrans;
	if (
		p.version !== 1 ||
		p.family !== 'animal-simple-trans' ||
		!['glow', 'pattern', 'pattern-single-sided'].includes(p.variant) ||
		!Array.isArray(p.requiredUv) ||
		!p.requiredUv.includes(0) ||
		new Set(p.requiredUv).size !== p.requiredUv.length ||
		!p.requiredUv.every((uv) => Number.isInteger(uv) && uv >= 0 && uv <= 3) ||
		!p.scalars ||
		!p.colors ||
		!p.textures
	) return null;

	const active = activeKeys(p.variant);
	if (
		active.scalars.some((key) => !Number.isFinite(p.scalars[key])) ||
		active.colors.some(
			(key) =>
				!Array.isArray(p.colors[key]) ||
				p.colors[key]!.length !== 4 ||
				!p.colors[key]!.every(Number.isFinite),
		)
	) return null;
	if (p.variant === 'glow' && p.scalars.GlintRoughness! <= 0) return null;
	if (
		['Extra_UVSelect', ...(p.variant !== 'glow' ? ['Pattern UVSelect'] : [])].some((key) =>
			p.colors[key]!.some((weight, channel) => weight !== 0 && !p.requiredUv.includes(channel)),
		)
	) return null;

	for (const role of active.roles) {
		const t = p.textures[role];
		if (
			!t ||
			typeof t.parameter !== 'string' ||
			!t.parameter ||
			typeof t.sRGB !== 'boolean' ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			t.cube !== (role === 'S') ||
			!Number.isFinite(t.rgbScale) ||
			t.rgbScale < 1 ||
			![t.addressX, t.addressY].every((a) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(a))
		) return null;
	}

	return p;
}

const declarations = /* glsl */ `
${nativeWorldFrameGLSL}
varying vec3 vAnimalPosition, vAnimalNormal, vAnimalLocalPosition;
varying vec2 vAnimalUV0, vAnimalUV1, vAnimalUV2, vAnimalUV3;
vec2 animalUV(vec4 weights) {
  return weights.x*vAnimalUV0+weights.y*vAnimalUV1+weights.z*vAnimalUV2+weights.w*vAnimalUV3;
}
float animalPow(float value,float exponent) {
  return value>0.0 ? pow(value,exponent) : 0.0;
}
mat3 animalFrame(vec3 n) {
  vec3 dx=dFdx(vAnimalPosition),dy=dFdy(vAnimalPosition);
  vec2 ux=dFdx(vAnimalUV0),uy=dFdy(vAnimalUV0);
  vec3 t=cross(dy,n)*ux.x+cross(n,dx)*uy.x;
  vec3 b=cross(dy,n)*ux.y+cross(n,dx)*uy.y;
  float magnitude=max(dot(t,t),dot(b,b));
  if(magnitude<0.00000001) {
    t=normalize(cross(abs(n.z)<.9?vec3(0,0,1):vec3(0,1,0),n));
    return mat3(t,cross(n,t),n);
  }
  return mat3(t*inversesqrt(magnitude),b*inversesqrt(magnitude),n);
}
vec3 animalCube(vec3 direction) {
  vec3 nativeDirection=normalize(furnitureNativeWorld(transpose(mat3(viewMatrix))*direction));
  vec2 uv=vec2(fract(atan(-nativeDirection.x,-nativeDirection.z)/6.28318530718),
    1.0-acos(clamp(nativeDirection.y,-1.0,1.0))/3.14159265359);
  return texture2D(animalS,uv).rgb*animalScaleS;
}
#ifndef ANIMAL_PATTERN
uniform vec3 animalGlintLightDirection;
vec3 animalPCG16(ivec3 cell) {
  uvec3 p=uvec3(cell)*1664525u+1013904223u;
  p.x+=p.y*p.z; p.y+=p.z*p.x; p.z+=p.x*p.y;
  p.x+=p.y*p.z; p.y+=p.z*p.x; p.z+=p.x*p.y;
  return vec3(p>>16u)*(1.0/65535.0);
}
#endif
`;

// The colour branch is the actual Animal core, not PM_Diffuse or a tint applied
// to PBR. Its HDR emission reaches the normal renderer output/tone-map chunks.
const colorCore = /* glsl */ `
{
vec3 view=isOrthographic?vec3(0,0,1):normalize(-vAnimalPosition);
vec3 geometric=normalize(vAnimalNormal);
vec2 mainUV=vAnimalUV0*aMain_Tiling;
vec4 extra=texture2D(animalO,animalUV(aExtra_UVSelect));
float fresnelMask=1.0-animalPow(abs(dot(geometric,view))+aEmissive_FresnelMask_Range-1.0,aEmissive_FresnelMask_Power);
fresnelMask=clamp(fresnelMask+extra.g*aFresnelMask_Add_ExtraMask,0.0,1.0);
vec2 rg=texture2D(animalN,mainUV*aMain_NTiling).rg*2.0-1.0;
rg.y=-rg.y;
vec2 zRG=rg*clamp(aMain_NormalIntensity,0.0,1.0);
vec3 tangentNormal=vec3(rg*aMain_NormalIntensity,sqrt(1.0-min(dot(zRG,zRG),1.0)));
tangentNormal=normalize(mix(vec3(0,0,1),tangentNormal,fresnelMask));
#ifdef ANIMAL_PATTERN
vec2 patternUV=animalUV(aPattern_UVSelect)*aPattern_TilingOffset.xy+aPattern_TilingOffset.zw;
mat3 patternFrame=animalFrame(geometric);
patternUV-=.6*aPatternHeightRatio*vec2(dot(patternFrame[0],view),dot(patternFrame[1],view));
vec4 patternBody=texture2D(animalD1,patternUV);
vec4 patternWeights=clamp(patternBody.a*aAni_2U_BlendAttr,0.0,1.0);
vec2 patternRG=texture2D(animalN1,patternUV).rg*2.0-1.0;
patternRG.y=-patternRG.y;
vec3 patternNormal=vec3(patternRG,sqrt(max(1.0-dot(patternRG,patternRG),0.0)));
tangentNormal=normalize(mix(tangentNormal,patternNormal,patternWeights.z));
#endif
vec3 normal=normalize(animalFrame(geometric)*tangentNormal);
#ifdef ANIMAL_TWO_SIDED
// Native colour PS applies SV_IsFrontFace to the completed material normal.
normal*=gl_FrontFacing?1.0:-1.0;
#endif
float front=max(dot(normal,view),0.0),edge=1.0-front;
vec3 rim=animalPow(edge,aEdgeLight_Range)*(1.0+(extra.r-1.0)*aEdgeLight_UseCoatingMask)*aEdgeLight_Color_A_EmissiveIntensity_.rgb;
vec3 emission=texture2D(animalT,mainUV).rgb*aMain_EmissiveColorTint.rgb*fresnelMask+rim*aEdgeLight_Color_A_EmissiveIntensity_.a;
#ifdef ANIMAL_PATTERN
// Native PS rotates Pattern Text around the grey axis, then alpha-blends E.
vec3 axis=vec3(.57735026919);
float hue=aPattern_HueShift*6.28318530718;
vec3 patternColor=patternBody.rgb*cos(hue)+cross(axis,patternBody.rgb)*sin(hue)+axis*dot(axis,patternBody.rgb)*(1.0-cos(hue));
patternColor*=aPattern_ColorTint.rgb;
emission=mix(emission,patternColor*aPattern_Emissive,patternWeights.w);
#else
// Source time is explicitly frozen at zero: panner offsets are not UV biases.
float glowPhase=clamp(1.0-aGlow_BreathInterval,0.0,1.0);
float glowStrength=mix(aGlow_Brightness,aGlow_Brightness*aGlow_BreathEnhance,glowPhase);
emission+=texture2D(animalD1,vAnimalUV0*aGlow_Tile).rgb*aGlow_Color.rgb*texture2D(animalO1,vAnimalUV0).r*glowStrength;
#endif
vec3 reflected=reflect(-view,normal);
vec3 cameraUp=vec3(0,1,0);
vec3 right=cross(-view,cameraUp);
right=dot(right,right)>.00000001?normalize(right):vec3(1,0,0);
vec3 up=normalize(cross(-view,right));
vec2 rainbowUV=vec2(dot(reflected,right),-dot(reflected,up))*.5*aRainbow_Tiling+vec2(.5);
rainbowUV+=texture2D(animalB,vAnimalUV0*(2.0*aRainbow_Warp_Tiling)).rg*aRainbow_Warp;
vec3 rainbow=texture2D(animalC,rainbowUV).rgb*aRainbow_Color_A_EmissiveIntensity_.rgb;
float extraMask=clamp(extra.g,.01,1.0);
emission+=rainbow*extraMask*aRainbow_Color_A_EmissiveIntensity_.a*max(1.0,aRainbowEmissiveInShadow);
float coat=animalPow(max(abs(edge),.0001),aCoatingPower)*(1.0-aCoatingBaseReflect)+aCoatingBaseReflect;
coat+=(1.0-2.0*coat)*aCoatingModeSelect;
vec3 coating=animalCube(reflected)*coat*aCoatingColorTint_A_EmissiveIntensity_.rgb*extra.r;
emission+=coating*aCoatingColorTint_A_EmissiveIntensity_.a*max(1.0,aCoatingEmissiveInShadow);
vec4 body=texture2D(animalD,mainUV);
vec3 base=body.rgb*aMain_D_ColorTint.rgb+rim+coating;
base=mix(base,rainbow,extraMask*aRainbow_D_BlendWeight);
#ifndef ANIMAL_PATTERN
// Actual Glow PS335-403: quantized Extra.A cell size, Extra.B density and
// unsigned PCG16. Bind-pose local coordinates freeze placement/time phase.
float cellSize=mix(aGlintSizeMin,aGlintSizeMax,roundEven(extra.a*16.0)/16.0);
vec3 random=animalPCG16(ivec3(floor(vAnimalLocalPosition*cellSize)));
vec3 enabled=step(random.zxy,vec3(extra.b*aGlintDensity));
vec3 phase=abs(fract(random*dot(geometric,view)*6.0)-.5)*2.0;
vec3 denominator=phase*phase*(aGlintRoughness-1.0)+1.0;
vec3 sparkle=enabled*aGlintRoughness/(3.14159265359*denominator*denominator);
vec3 glints=mix(vec3(dot(sparkle,sparkle)),sparkle,aGlintColorRandom);
glints*=mix(aGlintColor.rgb,aGlintColor.rgb*base,aGlintColorbyDiffuse);
vec3 halfDirection=normalize(animalGlintLightDirection+view);
float glintLight=pow(max(dot(normal,halfDirection),0.0),6.0)*pow(front,3.0);
emission+=glints*mix(1.0,glintLight,aGlintwithLighting)*max(1.0,aGlintsEmissiveInShadow);
#endif
float coverage=mix(aOpacity_Min,aOpacity_Max,body.a);
float edgeBase=aOpacity_EdgeRange>=-.001?1.0-min(front,1.0):min(front,1.0);
#ifdef ANIMAL_PATTERN
// Actual colour draw 14337 uses cb6[34].z=+1.5, not its reciprocal.
float edgeCoverage=pow(edgeBase+.01,aOpacity_EdgeRange);
#else
float edgeCoverage=pow(edgeBase+.01,-aOpacity_EdgeRange);
#endif
coverage=mix(min(coverage,edgeCoverage),max(coverage,edgeCoverage),aOpacity_BlendMode);
// The native source adds base only through scene probe/ambient lighting.
// That unavailable term is explicitly zero, not an unlit white base or a
// different editor environment. The source HDR emission remains untouched.
diffuseColor.rgb*=max(emission,vec3(0));
diffuseColor.a=clamp(coverage,0.0,1.0);
}
`;

export function createAnimalSimpleTransMaterial(profile: FurnitureAnimalSimpleTrans, textures: Partial<Record<string, Texture | null>>): MeshBasicMaterial {
	if (!readFurnitureAnimalSimpleTrans(profile)) throw new Error('[AnimalSimpleTrans] invalid source colour contract');

	const active = activeKeys(profile.variant);
	const sampling: Record<string, Texture> = {};

	const wrap = (address: string) =>
		address === 'TA_Clamp'
			? ClampToEdgeWrapping
			: address === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const role of active.roles) {
		const source = textures[role];
		const contract = profile.textures[role]!;
		if (!source) throw new Error(`[AnimalSimpleTrans] missing source role ${role}`);

		const texture = source.clone();
		texture.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = contract.cube ? RepeatWrapping : wrap(contract.addressX);
		texture.wrapT = contract.cube ? ClampToEdgeWrapping : wrap(contract.addressY);
		texture.generateMipmaps = contract.mipmaps;
		texture.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = contract.nearest
			? NearestFilter
			: contract.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		if (contract.cube) texture.flipY = false;
		texture.needsUpdate = true;
		sampling[role] = texture;
	}

	const material = new MeshBasicMaterial({
		transparent: true,
		opacity: 1,
		depthWrite: false,
		side: profile.variant === 'pattern' ? DoubleSide : FrontSide,
		forceSinglePass: true,
	});
	if (profile.variant !== 'glow') material.defines = { ANIMAL_PATTERN: '' };
	if (profile.variant === 'pattern') material.defines = { ANIMAL_PATTERN: '', ANIMAL_TWO_SIDED: '' };
	material.userData.animalSimpleTrans = profile;
	material.addEventListener('dispose', () => Object.values(sampling).forEach((texture) => texture.dispose()));

	const glintDirection = { value: new Vector3() };
	material.onBeforeRender = (renderer, scene, camera, geometry) => {
		if (
			!profile.requiredUv.every((channel) => !!geometry.getAttribute(channel === 0 ? 'uv' : `uv${channel}`))
		) throw new Error('[AnimalSimpleTrans] missing active source UV channel');

		if (profile.variant === 'glow') {
			const lighting = getEditorMaterialPreviewContext(renderer, scene).lighting();
			glintDirection.value
				.fromArray(lighting.primaryDirection)
				.transformDirection(camera.matrixWorldInverse);
		}
	};
	material.customProgramCacheKey = () => `animal-simple-trans-${profile.variant}-emissive-core-5`;
	material.onBeforeCompile = (shader) => {
		if (profile.variant === 'glow') shader.uniforms.animalGlintLightDirection = glintDirection;
		let uniforms = '';
		for (const key of active.scalars) {
			const name = parameter(key);
			shader.uniforms[name] = { value: profile.scalars[key] };
			uniforms += `uniform float ${name};\n`;
		}

		for (const key of active.colors) {
			const name = parameter(key);
			shader.uniforms[name] = { value: new Vector4(...profile.colors[key]!) };
			uniforms += `uniform vec4 ${name};\n`;
		}

		for (const role of active.roles) {
			shader.uniforms[`animal${role}`] = { value: sampling[role] };
			shader.uniforms[`animalScale${role}`] = { value: profile.textures[role]!.rgbScale };
			uniforms += `uniform sampler2D animal${role};\nuniform float animalScale${role};\n`;
		}

		const varyings = 'varying vec3 vAnimalPosition,vAnimalNormal,vAnimalLocalPosition; varying vec2 vAnimalUV0,vAnimalUV1,vAnimalUV2,vAnimalUV3;';
		shader.vertexShader =
			`${varyings}
#ifndef USE_UV1
attribute vec2 uv1;
#endif
#ifndef USE_UV2
attribute vec2 uv2;
#endif
#ifndef USE_UV3
attribute vec2 uv3;
#endif
` +
			shader.vertexShader
				.replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
				.replace(
					'#include <project_vertex>',
					`#include <project_vertex>
vAnimalPosition=mvPosition.xyz; vAnimalNormal=transformedNormal; vAnimalLocalPosition=position.xzy*100.0;
vAnimalUV0=uv; vAnimalUV1=uv1; vAnimalUV2=uv2; vAnimalUV3=uv3;`,
				);
		shader.fragmentShader = uniforms + declarations + shader.fragmentShader.replace('#include <map_fragment>', colorCore);
	};
	return material;
}
