import { type MeshPhysicalMaterial, type Texture } from 'three';
import {
	createStaticGlassMaterial, readStaticGlass,
	type FurnitureStaticGlass, type StaticGlassRuntime,
} from './iceShader.js';

export const stainedGlassStaticRoles = ['D', 'D1', 'D2', 'C', 'N', 'N1', 'N2', 'M', 'B', 'T1', 'O', 'S'];

export function readFurnitureStainedGlassStatic(value: unknown): FurnitureStaticGlass | null {
	return readStaticGlass(value, 'stained-glass-static', 34, stainedGlassStaticRoles);
}

const core = /* glsl */ `
void sgEvaluate() {
  vec3 view=sgView(),geometric=normalize(vSGNormal);mat3 frame=sgFrame(geometric);
  vec3 pivotView=normalize(furnitureNativeWorld(cameraPosition)-vSGPivot);
  vec2 parallax=vec2(dot(frame[0],pivotView),dot(frame[1],pivotView))*sg[3].xy;
  vec2 bgUV=vSGUV.xy*sg[0].zw+sg[1].xy+parallax*sg[2].w+sgTime*sg[0].xy;
  vec2 farUV=vSGUV.xy*sg[3].zw+sg[4].xy+parallax*sg[4].z;
  vec2 nearUV=vSGUV.xy*sg[5].xy+sg[5].zw+parallax*sg[6].x;
  vec2 foreUV=vSGUV.xy*sg[6].yz+sg[7].xy+parallax*sg[7].z;
  vec3 bgN=sgDecodeNormal(texture2D(sgM,bgUV).rg);
  vec4 bg=texture2D(sgD1,bgUV),farLayer=texture2D(sgD2,farUV);
  vec4 nearLayer=texture2D(sgC,nearUV),fore=texture2D(sgD,foreUV);
  vec3 raw=mix(bgN,sgDecodeNormal(texture2D(sgN1,farUV).rg),farLayer.a);
  raw=mix(raw,sgDecodeNormal(texture2D(sgN2,nearUV).rg),nearLayer.a);
  raw=mix(raw,sgDecodeNormal(texture2D(sgN,foreUV).rg),fore.a)*sg[8].xyz;
  sgNormal=normalize(frame*normalize(raw));
  float lighting=max(dot(sgLightDirection,sgNormal),sg[8].w);
  float glintBG=1.0-sg[9].x*clamp(farLayer.a+nearLayer.a+fore.a,0.0,1.0);
  vec2 glintUV=sgSelect(vec4(sg[9].w,sg[10].xyz))*sg[10].w;
  float cameraDistance=length(furnitureNativeWorld(cameraPosition)-vSGPivot);
  float depth=mix(sg[11].z,sg[11].y,clamp(cameraDistance*sg[11].x,0.0,1.0));
  vec2 offset=(depth*.25-.125)*vec2(dot(frame[0],view),dot(frame[1],view));
  vec2 g1=texture2D(sgB,glintUV+offset+sgTime*sg[9].yz).rg;
  vec2 g2=texture2D(sgB,glintUV+offset+sgTime*vec2(sg[11].w,sg[12].x)+normalize(furnitureNativeWorld(cameraPosition)-vSGPivot).xy*sg[12].y).rg;
  float first=sgPow(g1.x*g2.y,sg[13].w),second=sgPow(g1.y*g2.x,sg[12].z);
  vec3 sparkle=mix(second*sg[13].rgb,first*sg[14].rgb,first)*sg[14].w;
  sparkle*=1.0-clamp(farLayer.a,0.0,1.0)*sg[15].x;
  vec3 emissive=(bg.rgb-.5)*sg[15].y+.5;emissive*=sg[15].z;
  emissive=mix(emissive,((farLayer.rgb-.5)*sg[15].w+.5)*sg[16].x,farLayer.a);
  emissive=mix(emissive,((nearLayer.rgb-.5)*sg[16].y+.5)*sg[16].z,nearLayer.a);
  emissive=mix(emissive,((fore.rgb-.5)*sg[16].w+.5)*sg[17].x,fore.a)+glintBG*sparkle;
  float mainMask=1.0-sg[17].y*fore.a;
  vec3 c1=sgDecodeNormal(texture2D(sgT1,vSGUV.xy*sg[17].w+sgTime*sg[18].xy).rg);
  vec3 c2=sgDecodeNormal(texture2D(sgT1,vSGUV.xy*sg[18].z+sgTime*sg[19].xy).rg);
  vec3 crystal=frame*sgRNM(c1,c2);
  // The native main crystal lobe subtracts View twice, unlike its BG lobe.
  vec3 mainRay=normalize(2.0*dot(crystal,view)*crystal-2.0*view);
  vec3 mainHDR=sgPow3(sgCube(mainRay),sg[19].z);
  mainHDR=mix(mainHDR,vec3(dot(mainHDR,vec3(.3,.59,.11))),sg[19].w);
  mainHDR=sgHue(mainHDR,sg[17].z)*sg[20].rgb;
  vec3 hdrAttributes=mix(sg[22].rgb,sg[21].rgb,farLayer.a);
  hdrAttributes=mix(hdrAttributes,sg[23].rgb,nearLayer.a);
  hdrAttributes=mix(hdrAttributes,sg[24].rgb,fore.a);
  vec2 sphereRG=(vSGUV.xy-.5)*2.0*sg[26].xy;
  vec3 sphere=vec3(sphereRG,-sqrt(max(1.0-dot(sphereRG,sphereRG),0.0)));
  vec3 bgReflection=frame*sgRNM(raw*sg[25].xyz,sphere);
  vec3 bgRay=normalize(2.0*dot(bgReflection,view)*bgReflection-view);
  vec3 bgHDR=sgPow3(sgCube(bgRay),hdrAttributes.x);
  bgHDR=mix(bgHDR,vec3(dot(bgHDR,vec3(.3,.59,.11))),clamp(1.0-hdrAttributes.y,0.0,1.0));
  bgHDR=sgHue(bgHDR,hdrAttributes.z*6.28318530718)*dot(raw.xy,raw.xy)*sg[27].rgb;
  vec3 color=mix(bg.rgb,farLayer.rgb,farLayer.a);
  color=mix(color,nearLayer.rgb,nearLayer.a);color=mix(color,fore.rgb,fore.a);
  color*=sg[28].rgb;
  sgBase=clamp(color,0.0,1.0);
  sgEmission=mix(((bgHDR+mainHDR*mainMask)*.5*color+emissive)*lighting,sg[30].yzw,sg[30].x);
  vec3 orm=texture2D(sgO,sgSelect(sg[32])).rgb;
  sgMetalness=clamp(orm.b*sg[33].x,0.0,1.0);sgRoughness=clamp(orm.g*sg[33].z,0.0,1.0);
  sgAO=clamp(orm.r*sg[33].w,0.0,1.0);sgSpecular=clamp(sg[33].y,0.0,1.0);
}
`;

export function createStainedGlassStaticMaterial(p: FurnitureStaticGlass, textures: Partial<Record<string, Texture | null>>, runtime?: StaticGlassRuntime): MeshPhysicalMaterial {
	if (!readFurnitureStainedGlassStatic(p)) throw new Error('[StainedGlassStatic] captured native profile required');
	return createStaticGlassMaterial(p, textures, core, runtime);
}
