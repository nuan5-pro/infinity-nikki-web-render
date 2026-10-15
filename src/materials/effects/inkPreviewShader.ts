import {
	ClampToEdgeWrapping,
	DoubleSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshBasicMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector4,
	type Texture,
} from 'three';

interface InkTexture {
	parameter: string
	sRGB: boolean
	rgbScale: number
	mipmaps: boolean
	nearest: boolean
	addressX: string
	addressY: string
}

export interface FurnitureInkPreview {
	version: 1
	family: 'ink-preview'
	parameters: [number, number, number, number][]
	requiredUv: number[]
	textures: Record<string, InkTexture>
	approximation?: string
}

const roles = {
	D: 'BaseColor_Tex',
	N: 'NormalMap',
	O: 'Global_Mask',
	T: 'Pattern_Tex',
	C: 'NoiseTex_Layer_Wave',
	B: 'Rim_RangeSetting',
	D1: 'Rim_Noise_1',
	O1: 'Rim_Noise_2',
};

export function readFurnitureInkPreview(value: unknown): FurnitureInkPreview | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureInkPreview;
	if (
		p.version !== 1 ||
		p.family !== 'ink-preview' ||
		!Array.isArray(p.parameters) ||
		p.parameters.length !== 55 ||
		!p.parameters.every((v) => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)) ||
		!Array.isArray(p.requiredUv) ||
		!p.requiredUv.includes(0) ||
		new Set(p.requiredUv).size !== p.requiredUv.length ||
		!p.requiredUv.every((uv) => Number.isInteger(uv) && uv >= 0 && uv <= 3) ||
		!p.textures
	) return null;

	for (const [role, key] of Object.entries(roles)) {
		const t = p.textures[role];
		if (
			!t ||
			t.parameter !== key ||
			typeof t.sRGB !== 'boolean' ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			!Number.isFinite(t.rgbScale) ||
			t.rgbScale < 1 ||
			![t.addressX, t.addressY].every((a) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(a))
		) return null;
	}

	if (
		p.parameters[19]!.some((v) => v !== 0) ||
		p.parameters[45]![0] !== 0 ||
		p.parameters[54]![0] !== 0 ||
		p.parameters[2]![3] !== 0
	) return null;

	for (const index of [8, 12, 20, 32, 33]) {
		if (p.parameters[index]!.some((weight, uv) => weight !== 0 && !p.requiredUv.includes(uv))) return null;
	}

	return p;
}

const declarations = /* glsl */ `
uniform vec4 inkP[55];
uniform sampler2D inkD,inkN,inkO,inkT,inkC,inkB,inkD1,inkO1;
varying vec3 vInkPosition,vInkNormal;
varying vec2 vInkUV0,vInkUV1,vInkUV2,vInkUV3;
vec2 inkUV(vec4 weights) {
  return weights.x*vInkUV0+weights.y*vInkUV1+weights.z*vInkUV2+weights.w*vInkUV3;
}
float inkSmooth(float value,vec2 range) {
  // Native Range.G is the feather width. Its actual zero-width defaults are
  // threshold steps, not GLSL smoothstep's undefined equal-edge case.
  float t=range.y==0.0?(value>range.x?1.0:0.0):clamp((value-range.x)/range.y,0.0,1.0);
  return t*t*(3.0-2.0*t);
}
mat3 inkFrame(vec3 n) {
  vec3 dx=dFdx(vInkPosition),dy=dFdy(vInkPosition);
  vec2 ux=dFdx(vInkUV0),uy=dFdy(vInkUV0);
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

const core = /* glsl */ `
{
vec3 masks=texture2D(inkO,inkUV(inkP[8])).rgb;
vec3 pattern=texture2D(inkT,vInkUV0*inkP[10].xy).rgb*inkP[9].rgb;
vec3 base=texture2D(inkD,inkUV(inkP[12])).rgb*inkP[11].rgb;
vec2 layerUV=inkUV(inkP[20]);
float coordinate=(mix(layerUV.x,layerUV.y,inkP[21].x)-.5)*2.0+inkP[22].x;
coordinate+=(texture2D(inkC,vInkUV0*inkP[23].xy).r-.5)*2.0*inkP[24].x;
float band=clamp(abs(coordinate),0.0,1.0);
float layer1=inkSmooth(band,inkP[15].xy),layer2=inkSmooth(band,inkP[26].xy),layer3=inkSmooth(band,inkP[28].xy);
vec3 layer=mix(inkP[13].rgb,inkP[14].rgb,layer1);
layer=mix(layer,inkP[25].rgb,layer2);
layer=mix(layer,inkP[27].rgb,layer3);
base=mix(base,layer,max(max(layer1,layer2),layer3)*masks.g);
vec3 view=isOrthographic?vec3(0,0,1):normalize(-vInkPosition);
vec2 normalRG=texture2D(inkN,vInkUV0).rg*2.0-1.0;
normalRG.y=-normalRG.y;
vec3 tangentN=vec3(normalRG,sqrt(max(1.0-dot(normalRG,normalRG),0.0)));
vec3 normal=normalize(inkFrame(normalize(vInkNormal))*tangentN);
float edge=max(abs(1.0-max(dot(normal,view),0.0)),.0001);
vec2 rimMask=texture2D(inkB,inkUV(inkP[32])).rg;
vec2 noiseUV=inkUV(inkP[33]);
float noise2=texture2D(inkO1,noiseUV*inkP[34].xy).r;
float noise1=texture2D(inkD1,noiseUV*inkP[38].xy).r;
float rim2=pow(edge,inkP[31].x)*(1.0-inkP[31].y)+inkP[31].y;
float rim1=pow(edge,inkP[37].x)*(1.0-inkP[37].y)+inkP[37].y;
rim2=inkSmooth(rim2*rimMask.r*(1.0+(noise2-1.0)*rimMask.g),inkP[31].zw)*inkP[35].a;
rim1=inkSmooth(rim1*rimMask.r*(1.0+(noise1-1.0)*rimMask.g),inkP[37].zw)*inkP[36].a;
vec3 rim=mix(inkP[35].rgb*rim2,inkP[36].rgb*rim1,rim1);
base=mix(base,rim,rim2+rim1*(1.0-rim2));
vec3 color=mix(base+pattern,base*pattern,inkP[41].x);
color+=inkP[7].rgb*inkP[7].a*masks.b;
color=mix(color,vec3(dot(color,vec3(.3,.59,.11))),inkP[42].x);
color=(color*inkP[6].rgb+inkP[5].rgb)*masks.r;
diffuseColor.rgb*=max(color,vec3(0));
}
`;

export function createInkPreviewMaterial(config: FurnitureInkPreview, textures: Partial<Record<string, Texture | null>>): MeshBasicMaterial {
	if (!readFurnitureInkPreview(config)) throw new Error('InkPreview invalid source contract');

	const bound: Record<string, Texture> = {};

	const wrap = (value: string) =>
		value === 'TA_Clamp'
			? ClampToEdgeWrapping
			: value === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const role of Object.keys(roles)) {
		if (!textures[role]) throw new Error(`InkPreview missing ${role}`);

		const source = config.textures[role]!;
		const texture = textures[role]!.clone();
		texture.colorSpace = source.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = wrap(source.addressX);
		texture.wrapT = wrap(source.addressY);
		texture.flipY = false;
		texture.generateMipmaps = source.mipmaps;
		texture.magFilter = source.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = source.nearest
			? NearestFilter
			: source.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		texture.needsUpdate = true;
		bound[role] = texture;
	}

	const material = new MeshBasicMaterial({ side: DoubleSide });
	material.userData.inkPreview = config;
	material.addEventListener('dispose', () => Object.values(bound).forEach((texture) => texture.dispose()));
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		for (const uv of config.requiredUv) {
			if (!geometry.getAttribute(uv === 0 ? 'uv' : `uv${uv}`)) throw new Error(`InkPreview missing source UV${uv}`);
		}
	};
	material.onBeforeCompile = (shader) => {
		shader.uniforms.inkP = { value: config.parameters.map((v) => new Vector4(...v)) };
		for (const role of Object.keys(roles)) shader.uniforms[`ink${role}`] = { value: bound[role] };

		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec3 vInkPosition,vInkNormal;
varying vec2 vInkUV0,vInkUV1,vInkUV2,vInkUV3;
${config.requiredUv.includes(1) ? '#ifndef USE_UV1\nattribute vec2 uv1;\n#endif' : ''}
${config.requiredUv.includes(2) ? '#ifndef USE_UV2\nattribute vec2 uv2;\n#endif' : ''}
${config.requiredUv.includes(3) ? '#ifndef USE_UV3\nattribute vec2 uv3;\n#endif' : ''}`,
			)
			.replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
vInkPosition=mvPosition.xyz;
vInkNormal=transformedNormal;
vInkUV0=uv;
vInkUV1=${config.requiredUv.includes(1) ? 'uv1' : 'vec2(0)'};
vInkUV2=${config.requiredUv.includes(2) ? 'uv2' : 'vec2(0)'};
vInkUV3=${config.requiredUv.includes(3) ? 'uv3' : 'vec2(0)'};`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${declarations}`)
			.replace('#include <color_fragment>', `#include <color_fragment>\n${core}`);
	};
	material.customProgramCacheKey = () => `ink-preview-ordinal-static-v1_${config.requiredUv.join('_')}`;
	return material;
}
