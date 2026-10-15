import {
	ClampToEdgeWrapping,
	DataTexture,
	DoubleSide,
	FloatType,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshPhysicalMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	RGBAFormat,
	SRGBColorSpace,
	Vector4,
	type DataArrayTexture,
	type Texture,
} from 'three';

interface UA2Texture {
	parameter: string;
	sRGB: boolean;
	mipmaps: boolean;
	nearest: boolean;
	address: [string, string];
	encoding: string;
	sampler: string;
	path: string;
	depth: number;
}

export interface FurnitureNNClothUA2Preview {
	version: 1;
	family: 'nncloth-ua2-pattern-preview';
	requiredUv: number[];
	scalars: Record<string, number>;
	colors: Record<string, [number, number, number, number]>;
	textures: Record<string, UA2Texture>;
	mpt: { sourcePath: string; sha256: string; width: 9; height: 7; rgba: number[] };
	patternRegions?: {
		position: [number, number, number, number];
		transform: [number, number, number, number];
	}[];
	patternTextureSize?: number;
}

const roles = ['D', 'N', 'O', 'D1', 'N1', 'O1', 'D2', 'B', 'C'];

const scalarKeys = [
	'DIY_OverridePatternA',
	'Pattern_Second_Mask_Sel',
	'Pattern_Normal_Intensity',
	'Pattern_M_Blend',
	'IsApplyingDIYColor',
	'DIY_DesaturateMainDColor',
	'DIY_DesaturatePatternDColor',
	'Main_Emissive',
	'Matcap_Mask',
	'Matcap_Desaturation',
	'Matcap_Affect_Pattern_Intensity',
	'Matcap_Use_Pattern_Mask',
	'Matcap_Emissive',
	'Matcap_Night_Emissive',
	'Matcap_Rain_Emissive',
	'PC_Brightness_Tint',
];

const colorKeys = [
	'Main_Attr',
	'Fabric_Attr',
	'Pattern_UV',
	'Pattern_Tiling&Offsets',
	'Pattern_Blend',
	'Pattern_M_Attr',
	'DIY_PatternColorTint',
	'Fabric_Emissive_Brightness',
	'Fabric_Emissive_Attr',
	'Main_Emissiver_Color',
	'Fabric_Tint',
	'ReflectColor_Darkness',
	'ReflectColor_Brightness',
	'Anisotropy2_Attr',
	'Anisotropy2_Color',
	'Global_Attr',
	'Fabric_Normal_Far_Attr',
];

const uniformName = (key: string) => `u${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;

export function readFurnitureNNClothUA2Preview(value: unknown): FurnitureNNClothUA2Preview | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureNNClothUA2Preview;
	if (
		p.version !== 1 ||
		p.family !== 'nncloth-ua2-pattern-preview' ||
		!Array.isArray(p.requiredUv) ||
		![0, 1].every((uv) => p.requiredUv.includes(uv)) ||
		new Set(p.requiredUv).size !== p.requiredUv.length ||
		!p.requiredUv.every((uv) => Number.isInteger(uv) && uv >= 0 && uv <= 3) ||
		!p.scalars ||
		!p.colors ||
		!p.textures
	) return null;
	if (
		scalarKeys.some((key) => !Number.isFinite(p.scalars[key])) ||
		colorKeys.some(
			(key) =>
				!Array.isArray(p.colors[key]) ||
				p.colors[key]!.length !== 4 ||
				!p.colors[key]!.every(Number.isFinite),
		)
	) return null;
	if (
		p.colors.Pattern_UV!.some((weight, channel) => weight !== 0 && !p.requiredUv.includes(channel))
	) return null;
	if (
		p.patternRegions !== undefined &&
		(!Array.isArray(p.patternRegions) ||
			p.patternRegions.length !== 3 ||
			!Number.isFinite(p.patternTextureSize) ||
			p.patternTextureSize! <= 0 ||
			p.patternRegions.some(
				(region) =>
					!region ||
					![region.position, region.transform].every((value) => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)) ||
					region.position[2] <= 0 ||
					region.position[3] <= 0,
			))
	) return null;

	const grid = p.colors.Fabric_Attr!;
	if (![grid[0], grid[1]].every((n) => Number.isInteger(n) && n >= 1) || grid[0] * grid[1] > 9) return null;

	for (const role of roles) {
		const t = p.textures[role];
		if (
			!t ||
			!t.parameter ||
			!t.path ||
			typeof t.sRGB !== 'boolean' ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			!Number.isInteger(t.depth) ||
			t.depth < 1 ||
			(!['B', 'C'].includes(role) && t.depth !== 1) ||
			!Array.isArray(t.address) ||
			t.address.length !== 2 ||
			!t.address.every((a) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(a))
		) return null;
		if (['N', 'N1', 'B'].includes(role) && (t.sRGB || t.encoding !== 'native-rg')) return null;
	}

	if (
		!p.mpt ||
		p.mpt.width !== 9 ||
		p.mpt.height !== 7 ||
		!p.mpt.sourcePath ||
		!/^[a-f0-9]{64}$/.test(p.mpt.sha256) ||
		!Array.isArray(p.mpt.rgba) ||
		p.mpt.rgba.length !== 252 ||
		!p.mpt.rgba.every(Number.isFinite)
	) return null;

	for (let column = 0; column < grid[0] * grid[1]; column++) {
		const fabric = p.mpt.rgba[column * 4]!;
		const matcap = p.mpt.rgba[(4 * 9 + column) * 4]!;
		if (
			fabric < 0 ||
			Math.round(fabric) >= p.textures.B!.depth ||
			matcap < 0 ||
			Math.round(matcap) >= p.textures.C!.depth
		) return null;
	}

	return p;
}

const declarations = /* glsl */ `
varying vec3 vUA2Position;
varying vec2 vUA2UV0,vUA2UV1,vUA2UV2,vUA2UV3;
vec4 ua2Cell(float column,float row) { return texture2D(ua2MPT,(vec2(column,row)+.5)/vec2(9,7)); }
#ifdef UA2_POSITION_PATTERN
uniform vec4 ua2PatternPositions[3],ua2PatternTransforms[3];
uniform float ua2PatternTextureSize;
vec2 ua2PositionPatternUV(vec2 originalUV) {
  vec2 result=originalUV;
  for(int i=0;i<3;i++) {
    vec2 center=ua2PatternPositions[i].xy/ua2PatternTextureSize;
    vec2 size=ua2PatternPositions[i].zw/ua2PatternTextureSize;
    vec4 tiling=ua2PatternTransforms[i];
    if(all(lessThanEqual(abs(originalUV-center),size*.5))) {
      result=fract(originalUV*tiling.xy+tiling.zw)*size+center-size*.5;
    }
  }
  return result;
}
#endif
vec3 ua2RGNormal(vec2 rg,float strength) {
  rg=rg*2.0-1.0;
  vec2 zRG=rg*clamp(strength,0.0,1.0);
  return vec3(rg*strength,sqrt(max(1.0-min(dot(zRG,zRG),1.0),0.0)));
}
vec3 ua2RNM(vec3 a,vec3 b) {
  a.z+=1.0; b.xy=-b.xy;
  return normalize(a*dot(a,b)-b*a.z);
}
mat3 ua2Frame(vec3 n) {
  vec3 dx=dFdx(vUA2Position),dy=dFdy(vUA2Position);
  vec2 ux=dFdx(vUA2UV0),uy=dFdy(vUA2UV0);
  vec3 t=cross(dy,n)*ux.x+cross(n,dx)*uy.x;
  vec3 b=cross(dy,n)*ux.y+cross(n,dx)*uy.y;
  float magnitude=max(dot(t,t),dot(b,b));
  if(magnitude<.00000001) {
    t=normalize(cross(abs(n.z)<.9?vec3(0,0,1):vec3(0,1,0),n));
    return mat3(t,cross(n,t),n);
  }
  return mat3(t*inversesqrt(magnitude),b*inversesqrt(magnitude),n);
}
`;

const surfaceCore = /* glsl */ `
vec2 ua2Grid=uFabric_Attr.xy;
vec2 ua2Index=min(floor(max(vUA2UV1.yx,vec2(0))*ua2Grid),ua2Grid-1.0);
float ua2Column=ua2Index.y+ua2Index.x*ua2Grid.y;
vec4 ua2Fabric=ua2Cell(ua2Column,0.0),ua2Core=ua2Cell(ua2Column,1.0);
vec4 ua2RimColor=ua2Cell(ua2Column,2.0),ua2Rim=ua2Cell(ua2Column,3.0);
vec4 ua2Matcap=ua2Cell(ua2Column,4.0),ua2Aniso=ua2Cell(ua2Column,5.0),ua2Tangent=ua2Cell(ua2Column,6.0);
vec4 ua2FabricSample=texture(ua2B,vec3(vUA2UV1*ua2Fabric.yz,round(ua2Fabric.x)));
vec2 ua2PatternUV=vUA2UV0*uPattern_UV.x+vUA2UV1*uPattern_UV.y+vUA2UV2*uPattern_UV.z+vUA2UV3*uPattern_UV.w;
#ifdef UA2_POSITION_PATTERN
ua2PatternUV=ua2PositionPatternUV(ua2PatternUV);
#else
ua2PatternUV=ua2PatternUV*uPattern_Tiling_Offsets.xy+uPattern_Tiling_Offsets.zw;
#endif
vec4 ua2Pattern=texture2D(ua2D1,ua2PatternUV),ua2MainM=texture2D(ua2O,vUA2UV0),ua2PatternM=texture2D(ua2O1,ua2PatternUV);
float ua2Mask=clamp(ua2Pattern.a+uDIY_OverridePatternA,0.0,1.0)*mix(ua2MainM.b,ua2MainM.a,uPattern_Second_Mask_Sel);
vec3 ua2Main=texture2D(ua2D,vUA2UV0).rgb;
float ua2Grey=dot(ua2Main,vec3(.3,.59,.11));
ua2Main=mix(ua2Main,vec3(ua2Grey),uIsApplyingDIYColor*uDIY_DesaturateMainDColor);
vec3 ua2FabricColor=texture2D(ua2D2,vUA2UV1).rgb*uFabric_Tint.rgb;
vec3 ua2Base=ua2Main*ua2FabricColor;
vec3 ua2PatternColor=mix(ua2Pattern.rgb,vec3(dot(ua2Pattern.rgb,vec3(.3,.59,.11))),uDIY_DesaturatePatternDColor)*uDIY_PatternColorTint.rgb;
float ua2ColorWeight=clamp(ua2Mask*uPattern_Blend.y,0.0,1.0);
diffuseColor.rgb*=max(mix(ua2Base,ua2PatternColor,ua2ColorWeight),vec3(0));
vec3 ua2MainNormal=ua2RGNormal(texture2D(ua2N,vUA2UV0).rg,uMain_Attr.y);
vec3 ua2FabricNormal=ua2RGNormal(ua2FabricSample.rg,ua2Fabric.w);
vec3 ua2TangentNormal=ua2RNM(ua2MainNormal,ua2FabricNormal);
vec3 ua2PatternNormal=ua2RGNormal(texture2D(ua2N1,ua2PatternUV).rg,uPattern_Normal_Intensity);
ua2TangentNormal=ua2RNM(ua2TangentNormal,mix(vec3(0,0,1),ua2PatternNormal,clamp(ua2Mask*uPattern_Blend.w,0.0,1.0)));
`;

export function createNNClothUA2PreviewMaterial(profile: FurnitureNNClothUA2Preview, textures: Partial<Record<string, Texture | null>>): MeshPhysicalMaterial {
	if (!readFurnitureNNClothUA2Preview(profile)) throw new Error('[NNClothUA2] invalid source contract');

	const sampling: Record<string, Texture> = {};

	const wrap = (value: string) =>
		value === 'TA_Clamp'
			? ClampToEdgeWrapping
			: value === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const role of roles) {
		const source = textures[role];
		const t = profile.textures[role]!;
		if (!source) throw new Error(`[NNClothUA2] missing source role ${role}`);
		if (
			['B', 'C'].includes(role) &&
			(!(source as DataArrayTexture).isDataArrayTexture ||
				(source as DataArrayTexture).image.depth !== t.depth)
		) throw new Error(`[NNClothUA2] missing native array/depth for ${role}`);

		const texture = source.clone();
		texture.colorSpace = t.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = wrap(t.address[0]);
		texture.wrapT = wrap(t.address[1]);
		texture.generateMipmaps = t.mipmaps;
		texture.magFilter = t.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = t.nearest
			? NearestFilter
			: t.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		texture.needsUpdate = true;
		sampling[role] = texture;
	}

	const mpt = new DataTexture(new Float32Array(profile.mpt.rgba), 9, 7, RGBAFormat, FloatType);
	mpt.colorSpace = NoColorSpace;
	mpt.magFilter = mpt.minFilter = NearestFilter;
	mpt.generateMipmaps = false;
	mpt.flipY = false;
	mpt.needsUpdate = true;

	const material = new MeshPhysicalMaterial({
		side: DoubleSide,
		roughness: 1,
		metalness: 0,
		anisotropy: 1,
	});
	if (profile.patternRegions) material.defines = { UA2_POSITION_PATTERN: '' };
	material.userData.nnclothUA2Preview = profile;
	material.addEventListener('dispose', () => {
		Object.values(sampling).forEach((t) => t.dispose());
		mpt.dispose();
	});
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		if (
			!profile.requiredUv.every((channel) => !!geometry.getAttribute(channel === 0 ? 'uv' : `uv${channel}`))
		) throw new Error('[NNClothUA2] missing active source UV');
	};
	material.customProgramCacheKey = () => `nncloth-ua2-pattern-native-arrays-2-${profile.patternRegions ? 'position' : 'ordinary'}`;
	material.onBeforeCompile = (shader) => {
		let uniforms = 'uniform sampler2D ua2MPT;\n';
		shader.uniforms.ua2MPT = { value: mpt };
		if (profile.patternRegions) {
			shader.uniforms.ua2PatternPositions = {
				value: profile.patternRegions.map((region) => new Vector4(...region.position)),
			};
			shader.uniforms.ua2PatternTransforms = {
				value: profile.patternRegions.map((region) => new Vector4(...region.transform)),
			};
			shader.uniforms.ua2PatternTextureSize = { value: profile.patternTextureSize };
		}

		for (const key of scalarKeys) {
			const name = uniformName(key);
			shader.uniforms[name] = { value: profile.scalars[key] };
			uniforms += `uniform float ${name};\n`;
		}

		for (const key of colorKeys) {
			const name = uniformName(key);
			shader.uniforms[name] = { value: new Vector4(...profile.colors[key]!) };
			uniforms += `uniform vec4 ${name};\n`;
		}

		for (const role of roles) {
			shader.uniforms[`ua2${role}`] = { value: sampling[role] };
			uniforms += `uniform ${['B', 'C'].includes(role) ? 'highp sampler2DArray' : 'sampler2D'} ua2${role};\n`;
		}

		shader.vertexShader =
			`varying vec3 vUA2Position; varying vec2 vUA2UV0,vUA2UV1,vUA2UV2,vUA2UV3;
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
			shader.vertexShader.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
vUA2Position=mvPosition.xyz; vUA2UV0=uv; vUA2UV1=uv1; vUA2UV2=uv2; vUA2UV3=uv3;`,
			);
		shader.fragmentShader =
			uniforms +
			declarations +
			shader.fragmentShader
				.replace('#include <map_fragment>', surfaceCore)
				.replace(
					'#include <roughnessmap_fragment>',
					`float roughnessFactor=clamp(mix(ua2MainM.g*uMain_Attr.x,ua2PatternM.g*uPattern_M_Attr.y,ua2Mask*uPattern_M_Blend),.04,1.0);
roughnessFactor=mix(roughnessFactor,clamp(ua2Aniso.a,.04,1.0),clamp(uAnisotropy2_Attr.x,0.0,1.0));`,
				)
				.replace(
					'#include <metalnessmap_fragment>',
					'float metalnessFactor=clamp(mix(ua2MainM.r*uMain_Attr.z,ua2PatternM.r*uPattern_M_Attr.x,ua2Mask*uPattern_M_Blend),0.0,1.0);',
				)
				.replace(
					'#include <normal_fragment_maps>',
					'vec3 ua2SurfaceNormal=ua2TangentNormal; ua2SurfaceNormal.y=-ua2SurfaceNormal.y; normal=normalize(ua2Frame(normal)*ua2SurfaceNormal);',
				)
				.replace(
					'#include <emissivemap_fragment>',
					/* glsl */ `
vec3 ua2View=isOrthographic?vec3(0,0,1):normalize(-vUA2Position);
vec2 ua2MatcapUV=normal.xy*.5+.5;
vec3 ua2Reflection=texture(ua2C,vec3(ua2MatcapUV,round(ua2Matcap.x))).rgb;
ua2Reflection=mix(ua2Reflection,vec3(dot(ua2Reflection,vec3(.3,.59,.11))),uMatcap_Desaturation);
float ua2Facing=clamp(dot(normal,ua2View),0.0,1.0);
vec3 ua2ReflectTint=mix(uReflectColor_Darkness.rgb,uReflectColor_Brightness.rgb,ua2Facing);
float ua2ReflectMask=mix(1.0,ua2MainM.b,uMatcap_Mask);
vec3 ua2Reflected=ua2Reflection*ua2ReflectTint*ua2ReflectMask;
diffuseColor.rgb+=ua2Reflected*uPC_Brightness_Tint*(1.0-ua2ColorWeight*uMatcap_Affect_Pattern_Intensity);
float ua2RimWeight=pow(max(1.0-ua2Facing,.0001),max(ua2Rim.y,.0001))*ua2Rim.x;
diffuseColor.rgb+=ua2Main*ua2RimColor.rgb*ua2RimWeight;
vec3 ua2Emission=ua2Main*uMain_Emissiver_Color.rgb*uMain_Emissive;
ua2Emission+=ua2PatternColor*clamp(texture2D(ua2N1,ua2PatternUV).b+uFabric_Emissive_Attr.x,0.0,1.0)*uFabric_Emissive_Brightness.x*ua2ColorWeight;
ua2Emission+=ua2Reflected*uMatcap_Emissive;
totalEmissiveRadiance+=max(ua2Emission,vec3(0));`,
				)
				.replace(
					'#include <lights_physical_fragment>',
					`vec2 ua2Axis=ua2Tangent.xy;
ua2Axis=dot(ua2Axis,ua2Axis)>.000001?normalize(ua2Axis):vec2(1,0);
vec2 ua2AnisotropyVector=ua2Axis*clamp(ua2Tangent.a,0.0,.99);
#define anisotropyVector ua2AnisotropyVector
#include <lights_physical_fragment>
#undef anisotropyVector`,
				);
	};
	return material;
}
