import {
	ClampToEdgeWrapping,
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
import { getEditorMaterialPreviewContext } from '../jewel/characterJewelPreview.js';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

interface BubbleTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureBubbleNative {
	uniforms: [number, number, number, number][];
	textures: Record<string, BubbleTexture>;
}

const roles: Record<string, string> = {
	D: 'T_Bubble_D', O: 'T_BubbleSpec', T: 'T_BubbleWarp',
	O1: 'T_Parallax_LineRM', D1: 'T_Parallax_Line', D2: 'Glint_Texture', O2: 'Glint_Mask', S: 'T_Bubble_HDR',
};

export function readBubbleNative(value: unknown): FurnitureBubbleNative | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureBubbleNative;
	if (
		!Array.isArray(p.uniforms) || p.uniforms.length !== 26 ||
		!p.uniforms.every((row) => Array.isArray(row) && row.length === 4 && row.every((v) => typeof v === 'number' && Number.isFinite(v))) ||
		!p.textures || typeof p.textures !== 'object'
	) return null;

	for (const [role, key] of Object.entries(roles)) {
		const t = p.textures[role];
		if (
			!t || t.parameter !== key || t.cube !== (role === 'S') ||
			typeof t.sRGB !== 'boolean' || typeof t.mipmaps !== 'boolean' || typeof t.nearest !== 'boolean' ||
			!Number.isFinite(t.rgbScale) || t.rgbScale < 1 ||
			![t.addressX, t.addressY].every((v) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(v)) ||
			(role === 'S' && t.sRGB)
		) return null;
	}

	const u = p.uniforms;
	if (
		u[1]![0] < 1 || u[1]![1] < u[1]![0] || u[1]![1] > 64 ||
		u[2]![3] === u[3]![0] || u[8]![0] >= 1 || u[10]![3] <= 0 ||
		u[12]![1] === u[12]![2] ||
		u[14]!.some((v, i) => v !== (i === 0 ? 1 : 0)) || u[15]![2] !== 0 ||
		u[7]!.some((v) => v < 0) ||
		[u[3]![1], u[9]![0], u[12]![0], u[17]![1], u[18]![3], u[21]![0], u[21]![2]].some((v) => v < 0)
	) return null;
	return p;
}

const varyings = 'varying vec2 vBubbleUv; varying vec3 vBubblePosition, vBubbleNormal, vBubbleOrigin;';

const declarations = /* glsl */ `
${varyings}
${nativeWorldFrameGLSL}
uniform vec4 bubbleMaterial[26];
uniform sampler2D bubbleD, bubbleO, bubbleT, bubbleO1, bubbleD1, bubbleD2, bubbleO2, bubbleS;
uniform float bubbleCubeScale, bubbleTimeOfDay, bubbleTime;
uniform vec3 bubbleLightDirection, bubbleLightColor;
float bubblePow(float value, float exponent) { return value > 0.0 ? pow(value, exponent) : 0.0; }
vec3 bubblePow3(vec3 value, float exponent) {
  return vec3(bubblePow(value.x,exponent),bubblePow(value.y,exponent),bubblePow(value.z,exponent));
}
float bubbleSmooth(float low, float high, float value) {
  float t=clamp((value-low)/(high-low),0.0,1.0);
  return t*t*(3.0-2.0*t);
}
mat3 bubbleFrame(vec3 n) {
  vec3 dx=dFdx(vBubblePosition),dy=dFdy(vBubblePosition);
  vec2 ux=dFdx(vBubbleUv),uy=dFdy(vBubbleUv);
  vec3 t=cross(dy,n)*ux.x+cross(n,dx)*uy.x;
  vec3 b=cross(dy,n)*ux.y+cross(n,dx)*uy.y;
  float magnitude=max(dot(t,t),dot(b,b));
  if(magnitude<1e-8) {
    t=normalize(cross(abs(n.z)<.9?vec3(0,0,1):vec3(0,1,0),n));
    return mat3(t,cross(n,t),n);
  }
  return mat3(normalize(t),normalize(b),n);
}
vec3 bubbleNativeDirection(vec3 viewDirection) {
  return normalize(furnitureNativeWorld(transpose(mat3(viewMatrix))*viewDirection));
}
vec3 bubbleCube(vec3 viewDirection) {
  vec3 direction=bubbleNativeDirection(viewDirection);
  vec2 uv=vec2(fract(atan(-direction.x,-direction.z)/6.28318530718),
    1.0-acos(clamp(direction.y,-1.0,1.0))/3.14159265359);
  return texture2D(bubbleS,uv).rgb*bubbleCubeScale;
}
`;

// PS 50a2f77: source sample channels and operation order. The host material clock
// owns demand-mode freezing; light/TOD come from the actual editor scene.
const colorCore = /* glsl */ `
{
vec3 view=isOrthographic?vec3(0,0,1):normalize(-vBubblePosition);
vec3 normal=normalize(vBubbleNormal);
vec3 tangentView=transpose(bubbleFrame(normal))*view;
float facing=clamp(dot(normal,view),0.0,1.0);
float edge=1.0-facing;

// Native ray march starts at height one and includes the two terminal steps.
vec2 lineUv=vBubbleUv*bubbleMaterial[0].z+bubbleTime*bubbleMaterial[0].xy;
float steps=mix(bubbleMaterial[1].y,bubbleMaterial[1].x,min(abs(tangentView.z),1.0));
vec2 ray=-tangentView.xy/tangentView.z*bubbleMaterial[0].w;
vec2 delta=ray/steps;
vec2 offset=vec2(0.0);
float depth=1.0,previousDepth=1.0,previousHeight=1.0;
vec2 lineDx=dFdx(lineUv),lineDy=dFdy(lineUv);
for(int i=0;i<66;i++) {
  if(float(i)>=floor(steps)+2.0) break;
  float height=textureGrad(bubbleO1,lineUv+offset,lineDx,lineDy).r;
  if(depth<height) {
    float crossing=(height-depth)/(previousDepth-previousHeight+height-depth);
    offset-=crossing*delta;
    break;
  }
  previousDepth=depth; previousHeight=height;
  depth-=1.0/steps; offset+=delta;
}
float line=texture2D(bubbleD1,lineUv+offset).r;
vec3 parallax=line*bubbleMaterial[2].xyz*(1.0-bubbleSmooth(bubbleMaterial[3].x,bubbleMaterial[2].w,facing));

vec3 hdr=bubblePow3(bubbleCube(reflect(-view,normal)),bubbleMaterial[3].y)*bubbleMaterial[4].xyz;
float warp=texture2D(bubbleT,vBubbleUv+bubbleTime*bubbleMaterial[5].yz).r*bubbleMaterial[5].w;
vec2 diffuseUv=vBubbleUv+vec2(warp)+vec2(-normal.x,normal.y)*bubbleMaterial[6].x*bubblePow(edge,bubbleMaterial[7].z)+
  bubbleTime*vec2(bubbleMaterial[4].w,bubbleMaterial[5].x);
vec4 base=texture2D(bubbleD,diffuseUv);
float smoke=bubbleSmooth(bubbleMaterial[8].x,1.0,facing);
vec3 color=mix(bubbleMaterial[10].xyz,bubbleMaterial[9].yzw,bubblePow(edge,bubbleMaterial[7].x));
vec2 specUv=vec2(0.5)-normal.xy*bubbleMaterial[10].w;
vec3 spec=texture2D(bubbleO,specUv).rgb;
vec3 rgb=base.rgb*bubblePow(base.a,bubbleMaterial[9].x)*color+spec*bubbleMaterial[11].yzw;
rgb+=smoke*(1.0-base.a)*bubbleMaterial[8].yzw+hdr;
float edgeLight=0.04+0.96*pow(max(abs(edge),0.0001),bubbleMaterial[12].x);
rgb+=bubbleSmooth(bubbleMaterial[12].z,bubbleMaterial[12].y,edgeLight)*bubbleMaterial[13].xyz+parallax;
float day=bubbleSmooth(3.5,5.0,bubbleTimeOfDay)-bubbleSmooth(20.0,22.0,bubbleTimeOfDay);
rgb*=mix(bubbleMaterial[13].w,1.0,day);

vec2 glintUv=vBubbleUv*bubbleMaterial[15].w;
vec2 heightOffset=(bubbleMaterial[16].y-0.5)*bubbleMaterial[16].x*tangentView.xy;
vec3 nativeCamera=furnitureNativeWorld(cameraPosition);
vec3 cameraFromOrigin=normalize(nativeCamera-vBubbleOrigin);
vec2 first=texture2D(bubbleD2,glintUv+heightOffset).rg;
vec2 second=texture2D(bubbleD2,glintUv+heightOffset+cameraFromOrigin.xy*bubbleMaterial[17].x+
  bubbleTime*bubbleMaterial[16].zw*bubbleMaterial[15].w).rg;
vec2 glint=first*second;
vec3 glintRgb=bubblePow(glint.x,bubbleMaterial[17].y)*bubbleMaterial[18].xyz+
  bubblePow(glint.y,bubbleMaterial[18].w)*bubbleMaterial[19].xyz;
vec2 maskPanner=mix(bubbleMaterial[16].zw,vec2(bubbleMaterial[19].w,bubbleMaterial[20].x),bubbleMaterial[20].y);
float glintMask=texture2D(bubbleO2,vBubbleUv+bubbleTime*maskPanner).r;
if(abs(bubbleMaterial[20].z-0.5)<=0.00001 || bubbleMaterial[20].z>=0.5) glintMask=1.0;
vec3 nativeNormal=bubbleNativeDirection(normal),nativeView=bubbleNativeDirection(view);
vec3 halfView=normalize(nativeView+bubbleLightDirection);
float halfFacing=clamp(dot(nativeNormal,halfView),0.0,1.0);
float specLobe=bubblePow(mix(halfFacing,1.0-halfFacing,bubbleMaterial[20].w),bubbleMaterial[21].x);
float viewLobe=bubblePow(clamp(tangentView.z,0.0,1.0),bubbleMaterial[21].z);
float glintWeight=mix(viewLobe,1.0-viewLobe,bubbleMaterial[21].w)*specLobe*max(1.0,bubbleMaterial[21].y);
// Unavailable native shadow maps use the unshadowed static-preview branch.
rgb+=glintRgb*glintMask*glintWeight*max(bubbleLightColor,vec3(0.12))*bubbleMaterial[22].y;
rgb=mix(rgb,bubbleMaterial[23].xyz,bubbleMaterial[22].z);

float alpha=mix(bubbleMaterial[24].z,bubbleMaterial[24].y,bubblePow(edge,bubbleMaterial[7].y));
alpha=clamp(alpha+smoke*bubbleMaterial[24].x+spec.r*bubbleMaterial[24].w+base.a*bubbleMaterial[23].w,0.0,1.0);
alpha*=bubbleSmooth(bubbleMaterial[25].y,bubbleMaterial[25].x,length(vBubblePosition));
diffuseColor.rgb*=max(rgb,vec3(0.0));
diffuseColor.a*=min(alpha,1.0);
}
`;

export function createBubbleNativeMaterial(profile: FurnitureBubbleNative, sources: Partial<Record<string, Texture | null>>): MeshBasicMaterial {
	const sampling: Record<string, Texture> = {};
	const wrapping = (value: string) => value === 'TA_Clamp' ? ClampToEdgeWrapping : value === 'TA_Mirror' ? MirroredRepeatWrapping : RepeatWrapping;
	for (const role of Object.keys(roles)) {
		const source = sources[role];
		if (!source) throw new Error(`[Bubbles] missing native source role ${role}`);

		const contract = profile.textures[role]!;
		const texture = source.clone();
		texture.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = contract.cube ? RepeatWrapping : wrapping(contract.addressX);
		texture.wrapT = contract.cube ? ClampToEdgeWrapping : wrapping(contract.addressY);
		texture.generateMipmaps = contract.mipmaps;
		texture.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = contract.nearest ? NearestFilter : contract.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
		if (contract.cube) texture.flipY = false;
		texture.needsUpdate = true;
		sampling[role] = texture;
	}

	const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, forceSinglePass: true });
	const lightDirection = { value: new Vector3() };
	const lightColor = { value: new Vector3() };
	const timeOfDay = { value: 12 };
	const time = { value: 0 };
	material.onBeforeRender = (renderer, scene, _camera, geometry) => {
		if (!geometry.getAttribute('uv') || !geometry.getAttribute('normal')) throw new Error('[Bubbles] source UV0/normal required');

		const context = getEditorMaterialPreviewContext(renderer, scene);
		const lighting = context.lighting();
		const [x, y, z] = lighting.primaryDirection;
		lightDirection.value.set(x, -y, z);
		lightColor.value.fromArray(lighting.primaryColor);
		timeOfDay.value = lighting.tod.minute / 60;
		time.value = Math.fround(context.clock());
	};
	material.addEventListener('dispose', () => Object.values(sampling).forEach((texture) => texture.dispose()));
	material.customProgramCacheKey = () => 'furniture-bubbles-native-parallax-glint-cube-static-v1';
	material.onBeforeCompile = (shader) => {
		shader.uniforms.bubbleMaterial = { value: profile.uniforms.map((row) => new Vector4(...row)) };
		shader.uniforms.bubbleCubeScale = { value: profile.textures.S!.rgbScale };
		shader.uniforms.bubbleLightDirection = lightDirection;
		shader.uniforms.bubbleLightColor = lightColor;
		shader.uniforms.bubbleTimeOfDay = timeOfDay;
		shader.uniforms.bubbleTime = time;
		for (const [role, texture] of Object.entries(sampling)) shader.uniforms[`bubble${role}`] = { value: texture };

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${varyings}\n${nativeWorldFrameGLSL}`)
			.replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
			.replace('#include <project_vertex>', `#include <project_vertex>
vBubbleUv=uv; vBubblePosition=mvPosition.xyz; vBubbleNormal=transformedNormal;
vec4 bubbleOrigin=vec4(0.0,0.0,0.0,1.0);
#ifdef USE_BATCHING
bubbleOrigin=batchingMatrix*bubbleOrigin;
#endif
#ifdef USE_INSTANCING
bubbleOrigin=instanceMatrix*bubbleOrigin;
#endif
vBubbleOrigin=furnitureNativeWorld((modelMatrix*bubbleOrigin).xyz);`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${declarations}`)
			.replace('#include <map_fragment>', colorCore)
			.replace('#include <alphamap_fragment>', '');
	};
	return material;
}
