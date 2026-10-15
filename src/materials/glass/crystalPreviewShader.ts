import {
	ClampToEdgeWrapping,
	FrontSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshBasicMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector2,
	Vector4,
	type Texture,
} from 'three';

interface CrystalTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	mipmaps: boolean;
	nearest: boolean;
	addressX: string;
	addressY: string;
}

export interface FurnitureCrystalPreview {
	version: 1;
	family: 'crystal-preview';
	parameters: [number, number, number, number][];
	requiredUv: number[];
	dayPhase: 1;
	textures: Record<string, CrystalTexture>;
}

const roles = {
	D: 'Base_Tex',
	N: 'NormalMap',
	O: 'Global_Mask',
	T: 'Emissive_Tex_Add',
	C: 'Glint_Texture',
	B: 'Fresnel_RangeSetting',
	S: 'Base_Attribute_Tex',
	D1: 'Flow_Texture_1',
	O1: 'Flow_Texture_2',
	M: 'Fresnel_Noise',
};

export function readFurnitureCrystalPreview(value: unknown): FurnitureCrystalPreview | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureCrystalPreview;
	if (
		p.version !== 1 ||
		p.family !== 'crystal-preview' ||
		!Array.isArray(p.parameters) ||
		p.parameters.length !== 105 ||
		!p.parameters.every((v) => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)) ||
		!Array.isArray(p.requiredUv) ||
		!p.requiredUv.includes(0) ||
		new Set(p.requiredUv).size !== p.requiredUv.length ||
		!p.requiredUv.every((uv) => Number.isInteger(uv) && uv >= 0 && uv <= 3) ||
		p.dayPhase !== 1 ||
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
			t.rgbScale !== 1 ||
			![t.addressX, t.addressY].every((a) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(a))
		) return null;
	}

	if (
		[6, 37, 38, 43, 44, 46, 47, 50, 62, 74, 90, 91, 103].some((i) => p.parameters[i]![0] !== 0) ||
		p.parameters[16]![3] !== 0 ||
		p.parameters[92]!.some((v) => v !== 0) ||
		p.parameters[99]!.some((v) => v !== 0) ||
		[98, 100].some((i) => p.parameters[i]!.some((v) => v !== 1)) ||
		p.parameters[20]![0] < 1 ||
		p.parameters[26]![0] <= 0 ||
		p.parameters[54]![0] <= 0
	) return null;

	for (const index of [17, 22, 32, 49, 60, 67, 73, 89]) {
		if (p.parameters[index]!.some((weight, uv) => weight !== 0 && !p.requiredUv.includes(uv))) return null;
	}

	return p;
}

const declarations = /* glsl */ `
uniform vec4 crystalP[105];
uniform float crystalDayPhase;
uniform sampler2D crystalD,crystalN,crystalO,crystalT,crystalC,crystalB,crystalS,crystalD1,crystalO1,crystalM;
varying vec3 vCrystalPosition,vCrystalNormal;
varying vec2 vCrystalUV0,vCrystalUV1,vCrystalUV2,vCrystalUV3;
varying float vCrystalHeight;
vec2 crystalUV(vec4 weights) {
  return weights.x*vCrystalUV0+weights.y*vCrystalUV1+weights.z*vCrystalUV2+weights.w*vCrystalUV3;
}
float crystalSmooth(float value,vec2 range) {
  float t=range.y==0.0?(value>range.x?1.0:0.0):clamp((value-range.x)/range.y,0.0,1.0);
  return t*t*(3.0-2.0*t);
}
mat3 crystalFrame(vec3 n) {
  vec3 dx=dFdx(vCrystalPosition),dy=dFdy(vCrystalPosition);
  vec2 ux=dFdx(vCrystalUV0),uy=dFdy(vCrystalUV0);
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
vec3 view=isOrthographic?vec3(0,0,1):normalize(-vCrystalPosition);
vec3 geometric=normalize(vCrystalNormal);
mat3 frame=crystalFrame(geometric);
vec2 viewTangent=vec2(dot(frame[0],view),-dot(frame[1],view));
vec2 normalRG=texture2D(crystalN,crystalUV(crystalP[17])*crystalP[18].xy).rg*2.0-1.0;
normalRG.y=-normalRG.y;
vec3 mapped=frame*vec3(normalRG,sqrt(max(1.0-dot(normalRG,normalRG),0.0)));
vec3 normal=normalize(mix(geometric,mapped,crystalP[19].x));
vec4 mask=texture2D(crystalO,crystalUV(crystalP[32]));
float distanceRatio=clamp(length(vCrystalPosition)*100.0/crystalP[26].x,0.0,1.0);
float parallax=mix(crystalP[24].x,crystalP[24].x*crystalP[25].x,distanceRatio)*.25-.125;
vec2 glintUV=crystalUV(crystalP[22])*crystalP[23].x+viewTangent*parallax;
vec2 glintA=texture2D(crystalC,glintUV).rg;
vec2 glintB=texture2D(crystalC,glintUV+view.xy*crystalP[27].x).gr;
vec2 spark=pow(max(glintA*glintB,vec2(0)),vec2(crystalP[28].x,crystalP[31].x));
vec3 glint=mix(spark.x*crystalP[29].rgb*crystalP[29].a,spark.y*crystalP[30].rgb*crystalP[30].a,spark.y);
glint*=mask.b*crystalP[33].x;
vec2 emissiveUV=crystalUV(crystalP[49]);
float gradient=crystalSmooth(mix(emissiveUV.x,emissiveUV.y,crystalP[55].x),vec2(crystalP[53].x,crystalP[54].x));
vec3 emission=texture2D(crystalT,emissiveUV*crystalP[48].xy).rgb*mask.r;
emission*=mix(crystalP[51].rgb,crystalP[52].rgb,gradient)*(1.0+crystalP[56].x)*.5;
vec2 baseUV=crystalUV(crystalP[67]);
vec2 baseAttribute=texture2D(crystalS,(baseUV+crystalP[66].zw)*crystalP[68].xy).rg;
float baseDepth=baseAttribute.r*.05*(baseAttribute.r*crystalP[69].x-.5);
vec4 body=texture2D(crystalD,(baseUV+crystalP[66].xy+baseDepth*viewTangent)*crystalP[65].xy);
vec3 baseTint=mix(crystalP[63].rgb,crystalP[64].rgb,vCrystalHeight);
vec3 base=body.rgb*baseTint*baseAttribute.g*crystalP[70].x;
vec2 flowUV=crystalUV(crystalP[73]);
vec3 flow1=texture2D(crystalD1,(flowUV+crystalP[75].xy+(crystalP[76].x*.05-.025)*viewTangent)*crystalP[72].xy).rgb;
vec3 flow2=texture2D(crystalO1,(flowUV+crystalP[75].zw+(crystalP[78].x*.05-.025)*viewTangent)*crystalP[77].xy).rgb;
vec3 flow=flow1*flow2*mask.a*crystalP[71].rgb;
vec3 materialColor=(base+emission+flow+glint)*mix(crystalP[79].x,1.0,crystalDayPhase)*crystalP[20].x;
vec4 fresnelMask=texture2D(crystalB,crystalUV(crystalP[60]));
float edge=max(abs(1.0-max(dot(normal,view),0.0)),.0001);
float f=pow(edge,crystalP[82].x)*(1.0-crystalP[82].y)+crystalP[82].y;
f=crystalSmooth(f,crystalP[82].zw);
vec3 inner=crystalP[80].rgb,middle=crystalP[81].rgb,outer=crystalP[83].rgb;
vec3 ramp=mix(inner+materialColor*min(2.0*f,1.0),mix(middle,outer,clamp((f-.5)*2.0,0.0,1.0)),f);
ramp=mix(middle,ramp,clamp((fresnelMask.r-.5)*2.0,0.0,1.0));
ramp=mix(mix(inner,middle,clamp(fresnelMask.r*2.0,0.0,1.0)),ramp,fresnelMask.r);
float f2=pow(edge,crystalP[86].x)*(1.0-crystalP[86].y)+crystalP[86].y;
float left=crystalSmooth(f2,crystalP[86].zw);
float right=crystalSmooth(f2,vec2(crystalP[86].z+crystalP[86].w,-crystalP[86].w));
float shapeWidth=crystalP[85].y-crystalP[85].x;
float strength=clamp((min(left,right)-crystalP[85].x)/max(abs(shapeWidth),.000001),0.0,1.0)*crystalP[87].x;
ramp+=strength*crystalP[84].rgb;
float noise=texture2D(crystalM,crystalUV(crystalP[89])*crystalP[88].xy).r;
float fresnelCoverage=(f+strength)*(1.0+(noise-1.0)*fresnelMask.g)*mask.b;
materialColor+=fresnelCoverage*ramp;
materialColor*=crystalP[94].rgb;
float coverage=max(max(spark.x,spark.y),max(body.a*crystalP[70].x,flow1.r*flow2.r*mask.a));
coverage=max(coverage,fresnelCoverage);
diffuseColor.rgb*=max(materialColor,vec3(0));
diffuseColor.a=clamp((coverage+crystalP[101].x)*crystalP[102].x*mask.g,0.0,1.0);
}
`;

export function createCrystalPreviewMaterial(config: FurnitureCrystalPreview, textures: Partial<Record<string, Texture | null>>): MeshBasicMaterial {
	if (!readFurnitureCrystalPreview(config)) throw new Error('CrystalPreview invalid source contract');

	const bound: Record<string, Texture> = {};

	const wrap = (value: string) =>
		value === 'TA_Clamp'
			? ClampToEdgeWrapping
			: value === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const role of Object.keys(roles)) {
		if (!textures[role]) throw new Error(`CrystalPreview missing ${role}`);

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

	const height = new Vector2(0, 1);
	const material = new MeshBasicMaterial({
		transparent: true,
		depthWrite: false,
		side: FrontSide,
		forceSinglePass: true,
	});
	material.userData.crystalPreview = config;
	material.addEventListener('dispose', () => Object.values(bound).forEach((texture) => texture.dispose()));
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		for (const uv of config.requiredUv) {
			if (!geometry.getAttribute(uv === 0 ? 'uv' : `uv${uv}`)) throw new Error(`CrystalPreview missing source UV${uv}`);
		}

		if (!geometry.boundingBox) geometry.computeBoundingBox();
		const box = geometry.boundingBox;
		if (box) height.set(box.min.y, 1 / Math.max(box.max.y - box.min.y, 0.000001));
	};
	material.onBeforeCompile = (shader) => {
		shader.uniforms.crystalP = { value: config.parameters.map((v) => new Vector4(...v)) };
		shader.uniforms.crystalHeight = { value: height };
		shader.uniforms.crystalDayPhase = { value: config.dayPhase };
		for (const role of Object.keys(roles))
			shader.uniforms[`crystal${role}`] = { value: bound[role] };

		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
uniform vec2 crystalHeight;
varying vec3 vCrystalPosition,vCrystalNormal;
varying vec2 vCrystalUV0,vCrystalUV1,vCrystalUV2,vCrystalUV3;
varying float vCrystalHeight;
${config.requiredUv.includes(1) ? '#ifndef USE_UV1\nattribute vec2 uv1;\n#endif' : ''}
${config.requiredUv.includes(2) ? '#ifndef USE_UV2\nattribute vec2 uv2;\n#endif' : ''}
${config.requiredUv.includes(3) ? '#ifndef USE_UV3\nattribute vec2 uv3;\n#endif' : ''}`,
			)
			.replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
vCrystalPosition=mvPosition.xyz;
vCrystalNormal=transformedNormal;
vCrystalHeight=clamp((transformed.y-crystalHeight.x)*crystalHeight.y,0.0,1.0);
vCrystalUV0=uv;
vCrystalUV1=${config.requiredUv.includes(1) ? 'uv1' : 'vec2(0)'};
vCrystalUV2=${config.requiredUv.includes(2) ? 'uv2' : 'vec2(0)'};
vCrystalUV3=${config.requiredUv.includes(3) ? 'uv3' : 'vec2(0)'};`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${declarations}`)
			.replace('#include <color_fragment>', `#include <color_fragment>\n${core}`);
	};
	material.customProgramCacheKey = () => `crystal-preview-ordinal-static-v1_${config.requiredUv.join('_')}`;
	return material;
}
