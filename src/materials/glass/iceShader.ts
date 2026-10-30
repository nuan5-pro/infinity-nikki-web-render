import {
	ClampToEdgeWrapping, Float32BufferAttribute, FrontSide, LinearFilter,
	LinearMipmapLinearFilter, MeshPhysicalMaterial, MirroredRepeatWrapping,
	NearestFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, Vector3, Vector4,
	type BufferGeometry, type Matrix4, type Texture,
} from 'three';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';
import { getEditorMaterialPreviewContext } from '../jewel/characterJewelPreview.js';

export const STATIC_GLASS_PIVOT_ATTRIBUTE = 'staticGlassPivot';
export const STATIC_GLASS_VERTEX_R_ATTRIBUTE = 'staticGlassVertexR';

export interface StaticGlassTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureStaticGlass {
	version: 1;
	family: 'ice-static' | 'stained-glass-static';
	uniforms: [number, number, number, number][];
	textures: Record<string, StaticGlassTexture>;
	requiredUV: number[];
}

export interface StaticGlassRuntime {
	/** Native XYZ direction towards the editor's primary light, before view transform. */
	lightDirection?: Vector3;
	lightColor?: Vector3;
	clock?: () => number;
}

export const iceStaticRoles = ['N', 'N1', 'D1', 'D2', 'B', 'O', 'S'];

export function readStaticGlass(value: unknown, family: FurnitureStaticGlass['family'], count: number, roles: string[]): FurnitureStaticGlass | null {
	const p = value as FurnitureStaticGlass;
	if (!p || p.version !== 1 || p.family !== family || !Array.isArray(p.uniforms) || p.uniforms.length !== count ||
		!p.uniforms.every((row) => Array.isArray(row) && row.length === 4 && row.every(Number.isFinite)) ||
		!Array.isArray(p.requiredUV) || !p.requiredUV.includes(0) ||
		!p.requiredUV.every((uv) => Number.isInteger(uv) && uv >= 0 && uv < 4) || !p.textures) return null;
	for (const role of roles) {
		const t = p.textures[role];
		if (!t || typeof t.parameter !== 'string' || !t.parameter || typeof t.sRGB !== 'boolean' ||
			typeof t.mipmaps !== 'boolean' || typeof t.nearest !== 'boolean' || t.cube !== (role === 'S') ||
			!Number.isFinite(t.rgbScale) || t.rgbScale < 1 ||
			![t.addressX, t.addressY].every((a) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(a))) return null;
	}
	return p;
}

export function readFurnitureIceStatic(value: unknown): FurnitureStaticGlass | null {
	return readStaticGlass(value, 'ice-static', 37, iceStaticRoles);
}

/** Source CUE GLTF metres, before component/node transforms. Preserve this point
 * through each geometry bake; merged geometry's origin is not the source pivot. */
export function setStaticGlassCoordinates(geometry: BufferGeometry, p: FurnitureStaticGlass): void {
	const position = geometry.getAttribute('position');
	const color = geometry.getAttribute('color');
	const offset = p.family === 'ice-static' ? p.uniforms[0]! : p.uniforms[2]!;
	const pivot = new Float32Array(position.count * 3);
	const red = new Float32Array(position.count);
	for (let i = 0; i < position.count; i++) {
		pivot.set([offset[0] / 100, offset[2] / 100, offset[1] / 100], i * 3);
		red[i] = color ? color.getX(i) : 1;
	}
	geometry.setAttribute(STATIC_GLASS_PIVOT_ATTRIBUTE, new Float32BufferAttribute(pivot, 3));
	geometry.setAttribute(STATIC_GLASS_VERTEX_R_ATTRIBUTE, new Float32BufferAttribute(red, 1));
}

export function transformStaticGlassCoordinates(geometry: BufferGeometry, matrix: Matrix4): void {
	const pivot = geometry.getAttribute(STATIC_GLASS_PIVOT_ATTRIBUTE);
	if (pivot) pivot.applyMatrix4(matrix);
}

const declarations = /* glsl */ `
${nativeWorldFrameGLSL}
varying vec3 vSGWorld,vSGNormal,vSGPivot;
varying vec4 vSGUV,vSGUV23;
varying float vSGRed;
uniform vec3 sgLightDirection,sgLightColor;
uniform float sgCubeScale;
uniform float sgTime;
vec3 sgBase,sgEmission,sgNormal;
float sgRoughness,sgMetalness,sgAO,sgSpecular;
float sgPow(float x,float p) { return x<=0.0?0.0:exp2(log2(x)*p); }
vec3 sgPow3(vec3 x,float p) { return vec3(sgPow(x.r,p),sgPow(x.g,p),sgPow(x.b,p)); }
vec3 sgDecodeNormal(vec2 rg) { rg=rg*2.0-1.0;return vec3(rg,sqrt(max(1.0-dot(rg,rg),0.0))); }
vec3 sgRNM(vec3 a,vec3 b) { vec3 t=a+vec3(0,0,1),u=b*vec3(-1,-1,1);return t*dot(t,u)-u*t.z; }
mat3 sgFrame(vec3 n) {
  vec3 dx=dFdx(vSGWorld),dy=dFdy(vSGWorld);vec2 ux=dFdx(vSGUV.xy),uy=dFdy(vSGUV.xy);
  vec3 t=cross(dy,n)*ux.x+cross(n,dx)*uy.x,b=cross(dy,n)*ux.y+cross(n,dx)*uy.y;
  float scale=max(dot(t,t),dot(b,b));
  if(scale<1.e-12) { t=normalize(cross(abs(n.z)<.9?vec3(0,0,1):vec3(0,1,0),n));return mat3(t,cross(n,t),n); }
  return mat3(t*inversesqrt(scale),b*inversesqrt(scale),n);
}
vec3 sgCube(vec3 direction) {
  vec3 d=normalize(direction);vec2 uv=vec2(fract(atan(-d.x,-d.z)/6.28318530718),1.0-acos(clamp(d.y,-1.0,1.0))/3.14159265359);
  return texture2D(sgS,uv).rgb*sgCubeScale;
}
vec3 sgView() {return isOrthographic?furnitureNativeWorld(-vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])):normalize(furnitureNativeWorld(cameraPosition)-vSGWorld);}
vec2 sgSelect(vec4 weights) {return vSGUV.xy*weights.x+vSGUV.zw*weights.y+vSGUV23.xy*weights.z+vSGUV23.zw*weights.w;}
vec3 sgHue(vec3 color,float radians) {
  vec3 axis=vec3(.57735026919);float along=dot(axis,color);vec3 perpendicular=color-along*axis;
  return along*axis+perpendicular*cos(radians)+cross(axis,perpendicular)*sin(radians);
}
`;

const iceCore = /* glsl */ `
void sgEvaluate() {
  vec3 view=sgView(),geometric=normalize(vSGNormal);mat3 frame=sgFrame(geometric);
  vec2 baseUV=vSGUV.xy*sg[6].xy+sg[6].zw,detailUV=vSGUV.xy*sg[7].yz+sg[8].xy;
  vec3 a=mix(vec3(0,0,1),sgDecodeNormal(texture2D(sgN,baseUV).rg),sg[7].x);
  vec3 b=mix(vec3(0,0,1),sgDecodeNormal(texture2D(sgN1,detailUV).rg),sg[8].z);
  vec3 raw=sgRNM(a,b);sgNormal=normalize(frame*normalize(raw));
  float edge=max(abs(1.0-max(dot(sgNormal,view),0.0)),.0001);
  vec3 capture=mix(vSGPivot,sg[9].xyz,sg[8].w),relative=vSGWorld-capture;
  vec3 refNormal=normalize(frame*mix(raw,vec3(0,0,1),sg[9].w));
  vec3 ray=-normalize(view+refNormal*sg[10].x);
  ray=mix(ray,-sgNormal,(sgPow(edge,sg[10].y)*sg[10].z+sg[10].w)*sg[11].x);
  vec3 farIntersection=max((sg[11].yzw-relative)/ray,(sg[12].xyz-relative)/ray);
  float distance=min(farIntersection.x,min(farIntersection.y,farIntersection.z));
  vec3 transmitted=clamp(sgCube(relative+ray*distance)-min(sgPow(edge,sg[13].y),1.0)*sg[13].x,0.0,1.0)*sg[14].rgb;
  vec3 dirt=texture2D(sgD1,vSGUV.xy*sg[14].w).rgb*sg[15].rgb;
  float thickness=min(sgPow(edge,sg[16].x),1.0);
  float opacity=clamp(mix(mix(sg[13].x,sg[15].w,vSGRed),sg[13].x,thickness)+sg[16].y,0.0,1.0);
  transmitted=mix(transmitted,dirt,opacity);
  vec3 solid=clamp(mix(mix(sg[17].rgb,dirt,vSGRed),sg[17].rgb,thickness),0.0,1.0);
  transmitted=mix(transmitted,solid,sg[17].w);
  float edgeGeo=max(abs(1.0-max(dot(geometric,view),0.0)),.0001);
  float rim=clamp((sgPow(edgeGeo,sg[18].y)*sg[18].z+sg[18].w-sg[19].y)/(sg[19].x-sg[19].y),0.0,1.0);
  rim=rim*rim*(3.0-2.0*rim);
  vec3 first=mix(sg[21].rgb,sg[20].rgb,min(rim*2.0,1.0));
  vec3 second=mix(sg[20].rgb,sg[22].rgb,clamp((rim-.5)*2.0,0.0,1.0));
  vec3 fresnel=mix(first,second,rim)*rim;
  vec2 uv=sgSelect(vec4(sg[22].w,sg[23].xyz));
  vec2 transition=clamp((sg[23].w-sg[24].x)*abs(geometric.xz)+sg[24].x,0.0,1.0);
  vec2 worldUV=mix(mix(vSGWorld.xz,vSGWorld.yz,transition.x),vSGWorld.xy,transition.y);
  vec2 glintUV=mix(uv,worldUV,sg[24].y)*sg[24].z;
  vec2 tangentView=vec2(dot(frame[0],view),dot(frame[1],view));
  vec2 offset=sg[24].w*(sg[25].x-.5)*tangentView;
  vec2 scintillation=normalize(furnitureNativeWorld(cameraPosition)-vSGPivot).xy*sg[25].w;
  vec2 glintFlow=sgTime*sg[25].yz*(1.0-sg[24].y)*sg[24].z;
  vec2 glint=texture2D(sgD2,glintUV+offset).rg*texture2D(sgD2,glintUV+glintFlow+offset+scintillation).rg;
  vec3 sparkle=sgPow(glint.x,sg[26].x)*sg[26].yzw+sgPow(glint.y,sg[27].x)*sg[27].yzw;
  vec2 maskUV=mix(tangentView,uv+sgTime*sg[28].xy,sg[28].z);
  float mask=texture2D(sgB,maskUV).r;
  if(abs(sg[28].w-.5)<=.00001||sg[28].w>=.5)mask=1.0;
  vec3 specNormal=frame*mix(raw,vec3(0,0,1),sg[29].x);
  float spec=clamp(dot(specNormal,normalize(view+sgLightDirection)),0.0,1.0);
  spec=sgPow(mix(spec,1.0-spec,sg[29].y),sg[29].z)*max(sg[29].w,1.0);
  float facing=sgPow(clamp(dot(specNormal,view),0.0,1.0),sg[30].x);
  facing=mix(facing,1.0-facing,sg[30].y);
  sparkle*=mask*spec*facing*(1.0-sgPow(dot(raw.xy,raw.xy),sg[30].z))*max(sgLightColor,vec3(.12));
  sgBase=clamp(transmitted*sg[18].x+sparkle*sg[33].x,0.0,1.0);
  sgEmission=mix(transmitted*(1.0-sg[18].x)+fresnel+sparkle*sg[30].w,sg[32].yzw,sg[32].x);
  sgRoughness=clamp(mix(sg[33].y,sg[33].w,texture2D(sgO,detailUV).g),0.0,1.0);
  sgMetalness=0.0;sgAO=1.0;sgSpecular=.5;
}
`;

export function createStaticGlassMaterial(
	p: FurnitureStaticGlass, sources: Partial<Record<string, Texture | null>>, core: string,
	runtime: StaticGlassRuntime = {},
): MeshPhysicalMaterial {
	const textures: Texture[] = [];
	const uniforms: Record<string, { value: unknown }> = {
		sg: { value: p.uniforms.map((r) => new Vector4(...r)) },
		sgCubeScale: { value: p.textures.S!.rgbScale },
		sgLightDirection: { value: runtime.lightDirection ?? new Vector3(0, 0, 1) },
		sgLightColor: { value: runtime.lightColor ?? new Vector3(1, 1, 1) }, sgTime: { value: runtime.clock?.() ?? 0 },
	};
	const wrap = (v: string) => v === 'TA_Wrap' ? RepeatWrapping : v === 'TA_Clamp' ? ClampToEdgeWrapping : MirroredRepeatWrapping;
	let samplers = '';
	for (const [role, t] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source?.isTexture) throw new Error(`[StaticGlass] missing ${role}: ${t.parameter}`);
		const texture = source.clone();
		texture.colorSpace = t.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = t.cube ? RepeatWrapping : wrap(t.addressX);
		texture.wrapT = t.cube ? ClampToEdgeWrapping : wrap(t.addressY);
		texture.generateMipmaps = t.mipmaps;
		texture.magFilter = t.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = t.nearest ? NearestFilter : t.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
		texture.flipY = false; texture.needsUpdate = true;
		textures.push(texture); uniforms[`sg${role}`] = { value: texture };
		samplers += `uniform sampler2D sg${role};\n`;
	}
	const material = new MeshPhysicalMaterial({ side: FrontSide, roughness: 1, metalness: 1 });
	material.userData[p.family === 'ice-static' ? 'iceStatic' : 'stainedGlassStatic'] = p;
	material.onBeforeRender = (renderer, scene, _camera, geometry) => {
		const context = getEditorMaterialPreviewContext(renderer, scene);
		const lighting = context.lighting();
		uniforms.sgTime!.value = Math.fround((runtime.clock ?? context.clock)());
		const direction = uniforms.sgLightDirection!.value as Vector3;
		const color = uniforms.sgLightColor!.value as Vector3;
		if (runtime.lightDirection) direction.copy(runtime.lightDirection);
		else direction.set(lighting.primaryDirection[0], -lighting.primaryDirection[1], lighting.primaryDirection[2]);
		if (runtime.lightColor) color.copy(runtime.lightColor);
		else color.fromArray(lighting.primaryColor);
		if (!geometry.hasAttribute(STATIC_GLASS_PIVOT_ATTRIBUTE) || !geometry.hasAttribute(STATIC_GLASS_VERTEX_R_ATTRIBUTE) ||
			!p.requiredUV.every((uv) => geometry.hasAttribute(uv ? `uv${uv}` : 'uv'))) throw new Error('[StaticGlass] missing source pivot/vertex colour/UV');
	};
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 staticGlassPivot;attribute float staticGlassVertexR;
#ifndef USE_UV1
attribute vec2 uv1;
#endif
#ifndef USE_UV2
attribute vec2 uv2;
#endif
#ifndef USE_UV3
attribute vec2 uv3;
#endif
varying vec3 vSGWorld,vSGNormal,vSGPivot;varying vec4 vSGUV,vSGUV23;varying float vSGRed;
${nativeWorldFrameGLSL}`).replace('#include <project_vertex>', `#include <project_vertex>
mat4 sgWorld=modelMatrix;
#ifdef USE_INSTANCING
sgWorld=sgWorld*instanceMatrix;
#endif
#ifdef USE_BATCHING
sgWorld=sgWorld*batchingMatrix;
#endif
vSGWorld=furnitureNativeWorld((sgWorld*vec4(transformed,1.0)).xyz);
vSGNormal=furnitureNativeWorld(normalize(mat3(sgWorld)*objectNormal));
vSGPivot=furnitureNativeWorld((sgWorld*vec4(staticGlassPivot,1.0)).xyz);
vSGUV=vec4(uv,uv1);vSGUV23=vec4(uv2,uv3);vSGRed=staticGlassVertexR;`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\nuniform vec4 sg[${p.uniforms.length}];\n${samplers}${declarations}${core}`)
			.replace('#include <map_fragment>', 'sgEvaluate();diffuseColor=vec4(sgBase,1.0);')
			.replace('#include <normal_fragment_maps>', 'normal=mat3(viewMatrix)*vec3(sgNormal.x,-sgNormal.y,sgNormal.z);')
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=sgRoughness;')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor=sgMetalness;')
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=max(sgEmission,vec3(0.0));')
			.replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse*=sgAO;')
			.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor=mix(vec3(.08*sgSpecular),diffuseColor.rgb,metalnessFactor);');
	};
	material.customProgramCacheKey = () => `${p.family}:native-static-core-1`;
	material.addEventListener('dispose', () => textures.forEach((texture) => texture.dispose()));
	return material;
}

export function createIceStaticMaterial(p: FurnitureStaticGlass, textures: Partial<Record<string, Texture | null>>, runtime?: StaticGlassRuntime): MeshPhysicalMaterial {
	if (!readFurnitureIceStatic(p)) throw new Error('[IceStatic] captured native profile required');
	return createStaticGlassMaterial(p, textures, iceCore, runtime);
}
