import {
	ClampToEdgeWrapping,
	DoubleSide,
	Float32BufferAttribute,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshPhysicalMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector4,
	type BufferGeometry,
	type Texture,
} from 'three';

export const OPAL_PREVIEW_HEIGHT = '_opal_preview_height';

interface OpalTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureOpalPreview {
	version: 1;
	family: 'opal14-preview';
	requiredUv: number[];
	heightSpace: 'source-gltf-y-centimetres-before-bake';
	scalars: Record<string, number>;
	colors: Record<string, [number, number, number, number]>;
	textures: Record<string, OpalTexture>;
}

const scalarKeys = [
	'Top Layer Normal Intensity',
	'Diffuse Color Bleed Fresnel Side',
	'Diffuse Color Bleed Fresnel Offset',
	'UV Tile',
	'Depth',
	'EmissiveMapExp',
	'EmissiveMapIntensity',
	'Holo Distortion Intensity',
	'Holo Pattern Tiling',
	'Holo Mask Edge Softness',
	'MeshHeight',
	'Vertical Gradient Power',
	'Vertical Gradient Mult',
	'Eimssive Overall Intensity Day',
	'Eimssive Overall Intensity Night',
	'AO Min',
	'AO Max',
	'Emissive Mask Power',
	'HomeEmissiveToggle',
	'BaseColor Edge Alpha',
	'Metallic for Top Layer',
	'Metallic for Holo',
	'Specular',
	'Roughness Min',
	'Roughness Max',
];

const colorKeys = [
	'Base Emissive Color',
	'Gradient_Color_High',
	'Gradient_Color_Low',
	'Curvature Emissive Color',
	'Base Background Color',
	'BaseColor Edge',
];

const roles = ['D', 'N', 'O', 'T', 'B', 'C', 'D1'];
const parameter = (key: string) => `p${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;

export function readFurnitureOpalPreview(value: unknown): FurnitureOpalPreview | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureOpalPreview;
	if (
		p.version !== 1 ||
		p.family !== 'opal14-preview' ||
		p.heightSpace !== 'source-gltf-y-centimetres-before-bake' ||
		!Array.isArray(p.requiredUv) ||
		p.requiredUv.length !== 1 ||
		p.requiredUv[0] !== 0 ||
		!p.scalars ||
		!p.colors ||
		!p.textures ||
		scalarKeys.some((key) => !Number.isFinite(p.scalars[key])) ||
		p.scalars.MeshHeight! <= 0 ||
		p.scalars.Depth! < 0 ||
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
			t.cube !== false ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			t.rgbScale !== 1 ||
			![t.addressX, t.addressY].every((a) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(a))
		) return null;
	}

	return p;
}

/** Call on original source GLTF geometry before component/root/instance baking.
 * This explicit bind-pose approximation never derives height from merged bounds.
 */
export function setOpalPreviewCoordinates(geometry: BufferGeometry): void {
	if (geometry.hasAttribute(OPAL_PREVIEW_HEIGHT)) return;

	const position = geometry.getAttribute('position');
	if (!position || position.itemSize !== 3) throw new Error('[Opal14] missing original source position');

	const height = new Float32Array(position.count);
	for (let i = 0; i < position.count; i++) {
		height[i] = position.getY(i) * 100;
		if (!Number.isFinite(height[i])) throw new Error('[Opal14] nonfinite source bind-pose height');
	}

	geometry.setAttribute(OPAL_PREVIEW_HEIGHT, new Float32BufferAttribute(height, 1));
}

const declarations = /* glsl */ `
varying vec3 vOpalPosition,vOpalNormal;
varying vec2 vOpalUV;
varying float vOpalHeight;
vec3 opalBase,opalEmission,opalNormal;
float opalMetalness,opalRoughness,opalAO;
float opalPow(float value,float exponent) {return value>0.0?pow(value,exponent):0.0;}
vec3 opalPow3(vec3 value,float exponent) {
  return vec3(opalPow(value.r,exponent),opalPow(value.g,exponent),opalPow(value.b,exponent));
}
mat3 opalFrame(vec3 n) {
  vec3 dx=dFdx(vOpalPosition),dy=dFdy(vOpalPosition);
  vec2 ux=dFdx(vOpalUV),uy=dFdy(vOpalUV);
  vec3 t=cross(dy,n)*ux.x+cross(n,dx)*uy.x,b=cross(dy,n)*ux.y+cross(n,dx)*uy.y;
  float size=max(dot(t,t),dot(b,b));
  if(size<.00000001) {t=normalize(cross(abs(n.z)<.9?vec3(0,0,1):vec3(0,1,0),n));return mat3(t,cross(n,t),n);}
  return mat3(t*inversesqrt(size),b*inversesqrt(size),n);
}
vec2 opalPOM(vec2 uv,vec3 view,mat3 frame) {
  // Actual c369 56–111: fixed 8 coarse RG steps and 8 G refinements.
  vec3 tangentView=normalize(vec3(dot(frame[0],view),-dot(frame[1],view),dot(frame[2],view)));
  float z=abs(tangentView.z);
  if(!(z>0.0)) discard;
  float fade=1.0-pow(1.0-z,8.0);
  vec3 ray=vec3(-pDepth*fade*tangentView.xy/z,1.0);
  float lengthXY=length(ray.xy);
  vec2 dx=dFdx(uv),dy=dFdy(uv);
  vec3 march=vec3(uv,0.0);
  for(int i=0;i<8;i++) {
    vec2 rg=textureGrad(opalD1,march.xy,dx,dy).rg;
    float denominator=lengthXY+rg.r;
    if(!(denominator>0.0)) discard;
    march+=ray*(clamp(1.0-rg.g-march.z,0.0,1.0)*rg.r/denominator);
  }
  vec3 halfStep=ray*(march.z*.5),point=vec3(uv,0.0)+halfStep;
  for(int i=0;i<8;i++) {
    float height=1.0-textureGrad(opalD1,point.xy,dx,dy).g;
    halfStep*=.5;
    point+=point.z<height?halfStep:-halfStep;
  }
  return point.xy;
}
void evaluateOpal() {
  vec3 geometric=normalize(vOpalNormal),view=isOrthographic?vec3(0,0,1):normalize(-vOpalPosition);
  mat3 frame=opalFrame(geometric);
  float facing=dot(view,geometric),side=pDiffuse_Color_Bleed_Fresnel_Side;
  float bleed=clamp(facing*clamp(side,0.0,1.0)+(1.0-facing)*clamp(-side,0.0,1.0)+pDiffuse_Color_Bleed_Fresnel_Offset,0.0,1.0);
  vec2 xy=texture2D(opalN,vOpalUV).rg*2.0-1.0;
  xy.y=-xy.y;
  vec3 n=vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));
  n=mix(vec3(0,0,1),n,pTop_Layer_Normal_Intensity*bleed);
  opalNormal=normalize(frame*n);
  vec2 uv=opalPOM(vOpalUV*pUV_Tile,view,frame);
  vec3 e=texture2D(opalT,uv).rgb;
  float pattern=texture2D(opalB,vOpalUV).r;
  vec2 noiseUV=(vOpalUV+(vec2(geometric.x,-geometric.y)+pattern)*pHolo_Distortion_Intensity)*pHolo_Pattern_Tiling;
  float noise=textureLod(opalC,noiseUV,0.0).r;
  float breath=noise>=.5?1.0+pHolo_Mask_Edge_Softness*(noise*noise-1.0):pHolo_Mask_Edge_Softness*noise*noise;
  vec3 emission=mix(pBase_Emissive_Color.rgb,opalPow3(e,pEmissiveMapExp)*pEmissiveMapIntensity,breath);
  float heightWeight=clamp(opalPow(clamp(vOpalHeight/pMeshHeight,0.0,1.0),pVertical_Gradient_Power)*pVertical_Gradient_Mult,0.0,1.0);
  vec4 orm=texture2D(opalO,vOpalUV);
  emission=emission*mix(pGradient_Color_Low.rgb,pGradient_Color_High.rgb,heightWeight)+orm.a*pCurvature_Emissive_Color.rgb;
  emission*=opalPow(mix(pAO_Min,pAO_Max,orm.r),pEmissive_Mask_Power)*pEimssive_Overall_Intensity_Day*pHomeEmissiveToggle;
  vec4 body=texture2D(opalD,uv);
  vec3 background=mix(pBase_Background_Color.rgb,body.rgb,pBaseColor_Edge_Alpha);
  opalBase=clamp(mix(pBaseColor_Edge.rgb,mix(background,body.rgb,e.r),bleed),0.0,1.0);
  opalEmission=max(emission,vec3(0));
  opalMetalness=clamp(mix(pMetallic_for_Holo,pMetallic_for_Top_Layer,bleed),0.0,1.0);
  opalRoughness=clamp(mix(pRoughness_Min,pRoughness_Max,orm.g),0.0,1.0);
  opalAO=clamp(mix(pAO_Min,pAO_Max,orm.r),0.0,1.0);
}
`;

export function createOpalPreviewMaterial(profile: FurnitureOpalPreview, textures: Partial<Record<string, Texture | null>>): MeshPhysicalMaterial {
	if (!readFurnitureOpalPreview(profile)) throw new Error('[Opal14] invalid source contract');

	const sampling: Record<string, Texture> = {};

	const wrap = (value: string) =>
		value === 'TA_Clamp'
			? ClampToEdgeWrapping
			: value === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const role of roles) {
		const source = textures[role];
		const contract = profile.textures[role]!;
		if (!source) throw new Error(`[Opal14] missing source ${role}`);

		const texture = source.clone();
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
	}

	const material = new MeshPhysicalMaterial({
		color: 0xffffff,
		metalness: 1,
		roughness: 1,
		side: DoubleSide,
		transparent: false,
		opacity: 1,
		depthWrite: true,
		specularIntensity: profile.scalars.Specular! * 2,
	});
	material.userData.opalPreview = profile;
	material.addEventListener('dispose', () => Object.values(sampling).forEach((texture) => texture.dispose()));
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		const height = geometry.getAttribute(OPAL_PREVIEW_HEIGHT);
		if (
			!geometry.getAttribute('uv') ||
			!height ||
			height.itemSize !== 1 ||
			height.count !== geometry.getAttribute('position')?.count
		) throw new Error('[Opal14] source UV/height must be retained before geometry baking');
	};
	material.customProgramCacheKey = () => 'opal14-preview-1';
	material.onBeforeCompile = (shader) => {
		let uniforms = '';
		for (const key of scalarKeys) {
			shader.uniforms[parameter(key)] = { value: profile.scalars[key] };
			uniforms += `uniform float ${parameter(key)};\n`;
		}

		for (const key of colorKeys) {
			shader.uniforms[parameter(key)] = { value: new Vector4(...profile.colors[key]!) };
			uniforms += `uniform vec4 ${parameter(key)};\n`;
		}

		for (const role of roles) {
			shader.uniforms[`opal${role}`] = { value: sampling[role] };
			uniforms += `uniform sampler2D opal${role};\n`;
		}

		shader.vertexShader =
			`varying vec3 vOpalPosition,vOpalNormal;varying vec2 vOpalUV;varying float vOpalHeight;attribute float ${OPAL_PREVIEW_HEIGHT};\n` +
			shader.vertexShader.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
vOpalPosition=mvPosition.xyz;vOpalNormal=transformedNormal;vOpalUV=uv;vOpalHeight=${OPAL_PREVIEW_HEIGHT};`,
			);
		shader.fragmentShader =
			uniforms +
			declarations +
			shader.fragmentShader
				.replace('#include <map_fragment>', 'evaluateOpal();diffuseColor.rgb*=opalBase;')
				.replace('#include <normal_fragment_maps>', 'normal=opalNormal;')
				.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=opalRoughness;')
				.replace('#include <metalnessmap_fragment>', 'float metalnessFactor=opalMetalness;')
				.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=opalEmission;');
	};
	return material;
}
