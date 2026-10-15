import {
	ClampToEdgeWrapping,
	DoubleSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshPhysicalMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NearestMipmapNearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector3,
	Vector4,
	type Texture,
} from 'three';
import { characterJewelNativeMath } from '../jewel/characterJewelSource.js';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

interface DiamondTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureDiamondBillboardCurrent {
	version: 1;
	family: 'diamond-billboard-current';
	uniforms: number[][];
	textures: Record<string, DiamondTexture>;
	collection: {
		ready: number;
		aaMethod: number;
		globalFactor: number;
		fillIntensity: number;
		fillSkyColor: number[];
		fillGroundColor: number[];
		resolvedSunColor: number[];
		dirLightVectorLimited: number[];
	};
	requiredUV: number[];
	twoSided: true;
	vertexFactory: 'TGPUSkinVertexFactoryDefault';
}

export interface DiamondBillboardCurrentRuntime {
	primaryDirection: number[];
	primaryColor: number[];
	sunDirection: number[];
	swapLightFactor: number;
	timeOfDayHours: number;
	viewport: number[];
	inverseProjectionX: number;
}

export function readFurnitureDiamondBillboardCurrent(value: unknown): FurnitureDiamondBillboardCurrent | null {
	const p = value as FurnitureDiamondBillboardCurrent;
	if (
		!p ||
		p.version !== 1 ||
		p.family !== 'diamond-billboard-current' ||
		p.vertexFactory !== 'TGPUSkinVertexFactoryDefault' ||
		p.twoSided !== true ||
		p.uniforms?.length !== 29 ||
		!p.uniforms.every((r) => r.length === 4 && r.every(Number.isFinite)) ||
		!['N', 'N1', 'D', 'D1', 'O', 'O1', 'S'].every((role) => p.textures?.[role]) ||
		!p.collection
	) return null;

	return p;
}

const fragment = /* glsl */ `
${nativeWorldFrameGLSL}
${characterJewelNativeMath}
uniform vec4 dbMaterial[29];
uniform sampler2D dbN,dbN1,dbD,dbD1,dbO,dbO1,dbS;
uniform float dbCubeScale,dbReady,dbGlobal,dbFillIntensity,dbSwap,dbTOD,dbInverseProjectionX;
uniform int dbAA;
uniform vec2 dbViewport;
uniform vec3 dbPrimaryDirection,dbPrimaryColor,dbSunDirection,dbSunColor,dbSky,dbGround;
varying vec4 vDBUV01,vDBUV23;
varying vec3 vDBWorld,vDBLocalCM;
vec3 dbBase,dbNormal,dbEmission,dbSSS;float dbSpecular;
vec3 dbDecode(vec2 rg){vec2 xy=rg*2.0-1.0;return vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));}
vec3 dbPanorama(vec3 direction){
  vec3 d=normalize(direction);
  return texture2D(dbS,vec2(fract(atan(-d.x,-d.z)/6.28318530718),1.0-acos(clamp(d.y,-1.0,1.0))/3.14159265359)).rgb*dbCubeScale;
}
vec3 dbGlint(vec3 base,float ndotv,float distanceBlend){
  vec4 a=mix(dbMaterial[5],dbMaterial[4],distanceBlend);
  uvec3 cell=uvec3(ivec3(floor(vDBLocalCM*a.x)));
  cell=cell*1664525u+1013904223u;
  cell.x+=cell.y*cell.z;cell.y+=cell.z*cell.x;cell.z+=cell.x*cell.y;
  cell.x+=cell.y*cell.z;cell.y+=cell.z*cell.x;cell.z+=cell.x*cell.y;
  vec3 random=vec3(cell>>16u)*(1.0/65536.0);
  vec3 gate=step(random.zxy,vec3(a.y));
  // Static preview freezes the source clock at zero, preserving the authored spatial glint function.
  vec3 triangle=abs(fract(random*ndotv*6.0)-.5)*2.0;
  vec3 denominator=max(triangle*(triangle*a.z-triangle)+1.0,vec3(.005));
  vec3 w=a.z/(denominator*denominator*3.14159265359)*gate;
  float intensity=dot(w,w)*mix(1.0,dbMaterial[6].x,distanceBlend);
  if(dbAA==9)intensity=min(intensity,50.0);
  float scale=intensity/max(intensity,.001);
  float direction=intensity*inversesqrt(max(intensity*intensity,.001));
  float result=intensity;
  float day=max(1.0-abs(dbTOD/12.0-1.0),0.0);
  float vertexFactor=min(4.0*characterJewelPositivePower(day,dbMaterial[0].x),1.0);
  if(dbAA==5)result*=mix(dbMaterial[7].z,mix(dbMaterial[7].y,dbMaterial[7].x,vertexFactor),dbGlobal);
  if(dbAA==1)result=min(direction*((dbSwap+1.0)*.5*50.0+50.0),intensity*dbMaterial[7].w);
  if(dbAA==9)result=min(intensity,direction*dbMaterial[8].x);
  if(dbAA==11)result=min(max(intensity,.001),99999.0)*scale;
  if(dbAA==10)result=min(max(intensity,.001),15.0)*scale;
  return result*base*dbMaterial[6].yzw;
}
void dbEvaluate(){
  vec3 editorView=isOrthographic?-vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]):normalize(cameraPosition-vDBWorld);
  vec3 view=furnitureNativeWorld(editorView);
  vec3 right=furnitureNativeWorld(vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]));
  vec3 up=normalize(cross(view,right));right=normalize(cross(up,view));
  mat3 frame=mat3(right,up,view);
  vec3 front=normalize(frame*dbDecode(texture2D(dbN,vDBUV01.xy).rg));
  vec3 back=normalize(frame*dbDecode(texture2D(dbN1,vDBUV01.xy*dbMaterial[0].z).rg));
  dbNormal=front;
  vec3 hdr=dbPanorama(2.0*dot(back,view)*back-view);
  hdr=vec3(characterJewelPositivePower(hdr.x,dbMaterial[0].w),characterJewelPositivePower(hdr.y,dbMaterial[0].w),characterJewelPositivePower(hdr.z,dbMaterial[0].w));
  hdr=mix(hdr,vec3(dot(hdr,vec3(.3,.59,.11))),dbMaterial[1].x);
  hdr=characterJewelSourceHDR(hdr,dbMaterial[0].y,0.0);
  vec2 uv=vDBUV01.xy*dbMaterial[1].y+vDBUV01.zw*dbMaterial[1].z+vDBUV23.xy*dbMaterial[1].w+vDBUV23.zw*dbMaterial[2].x;
  vec3 twoU=texture2D(dbD1,vDBUV01.zw).rgb;
  vec4 body=texture2D(dbD,uv);
  vec3 base=body.rgb*clamp(twoU+dbMaterial[2].y,0.0,1.0);
  float projection=(dbViewport.x/dbViewport.y)/dbInverseProjectionX*.6;
  float distanceBlend=clamp((distance(cameraPosition,vDBWorld)-projection*(75.0-25.0*(1.0-dbGlobal)))/(300.0+200.0*(1.0-dbGlobal)),0.0,1.0);
  vec3 tint=base*mix(1.0,.7,distanceBlend)*dbMaterial[3].rgb;
  vec3 c=hdr*tint;
  float ndotv=dot(front,view),edge=max(abs(1.0-max(ndotv,0.0)),.0001);
  vec3 light=characterJewelSourceLight(dbPrimaryDirection,dbSunDirection,dbReady);
  vec3 lightColor=characterJewelSourceLight(dbPrimaryColor,dbSunColor,dbReady);
  vec3 lightSoft=clamp(mix(lightColor,vec3(dot(lightColor,vec3(.3,.59,.11))),.8),.2,1.0);
  vec3 customSpec=characterJewelPositivePower(clamp(dot(normalize(light+view),front),0.0,1.0),dbMaterial[9].w)*dbMaterial[10].rgb;
  vec3 highlights=dbGlint(base,ndotv,distanceBlend)*lightSoft+characterJewelPositivePower(edge,dbMaterial[8].y)*dbMaterial[9].rgb+customSpec;
  c+=highlights*mix(base,vec3(dot(base,vec3(.3,.59,.11))),.5);
  vec3 diy=(twoU*dbMaterial[11].rgb+dbMaterial[11].a)*dbMaterial[12].x*mix(c,vec3(dot(c,vec3(.3,.59,.11))),.9);
  c=mix(c,diy,dbMaterial[2].y);
  vec4 tod=mix(vec4(1.0,1.0,1.0,.5),dbMaterial[13],dbGlobal);
  c=mix(vec3(dot(c,vec3(.3,.59,.11))),c,tod.x)*tod.y;
  c=vec3(characterJewelPositivePower(c.x,tod.z),characterJewelPositivePower(c.y,tod.z),characterJewelPositivePower(c.z,tod.z));
  // Source shadow PS applies diffuse alpha and a sharp radius-.45 UV0 disk.
  // Cloth visibility is source-proven zero; temporal dither/primitive fade is omitted.
  float noise=texture2D(dbO,vDBUV01.xy*dbMaterial[17].x).r;
  float progress=noise-(dbMaterial[19].x*dbMaterial[19].y+dbMaterial[19].z);
  float radial=clamp((1.0-length(vDBUV01.xy-.5)*2.22222222222222)*100000.0,0.0,1.0);
  float opacity=body.a*radial*smoothstep(0.0,-dbMaterial[20].x,progress);
  if(opacity<.3333)discard;
  float dissolve=smoothstep(dbMaterial[20].x,dbMaterial[19].w,progress);
  vec3 force=mix(dbMaterial[16].rgb,dbMaterial[15].rgb,edge*edge*edge);
  vec3 emission=mix(c*mix(dbMaterial[14].y,dbMaterial[14].x,1.0-abs(dbTOD/12.0-1.0))*lightSoft,force*2.0,dbMaterial[16].a);
  emission=mix(dbMaterial[20].yzw,emission,dissolve);
  emission+=characterJewelPositivePower(edge,dbMaterial[21].x)*dbMaterial[21].yzw*dbMaterial[22].x*dbMaterial[22].y*texture2D(dbO1,vDBUV01.xy).r;
  c=mix(dbMaterial[20].yzw,mix(c,force,dbMaterial[16].a),dissolve);
  dbBase=clamp(c*(1.0+(dbMaterial[23].rgb-1.0)*dbMaterial[23].a*dbMaterial[22].y),0.0,1.0);
  vec3 energy=max(vec3(1.0),2.0404*dbBase-.3324-4.7951*dbBase+2.7552*dbBase+1.332);
  emission+=energy*.2*characterJewelSourceFill(front.z,dbSky,dbGround,dbFillIntensity,lightColor)*dbBase;
  dbEmission=max(mix(emission,dbMaterial[24].yzw,dbMaterial[24].x),vec3(0.0));
  dbSSS=clamp(tint*dbMaterial[28].yzw,0.0,1.0);dbSpecular=clamp(tod.w,0.0,1.0);
}
`;

export function createDiamondBillboardCurrentMaterial(
	p: FurnitureDiamondBillboardCurrent,
	sources: Partial<Record<string, Texture | null>>,
	runtime: DiamondBillboardCurrentRuntime,
	update: MeshPhysicalMaterial['onBeforeRender'],
): MeshPhysicalMaterial {
	if (!readFurnitureDiamondBillboardCurrent(p)) throw new Error('[DiamondBillboard] current source profile required');

	const c = p.collection;

	const uniforms: Record<string, { value: unknown }> = {
		dbMaterial: { value: p.uniforms.map((r) => new Vector4().fromArray(r)) },
		dbCubeScale: { value: p.textures.S!.rgbScale },
		dbReady: { value: c.ready },
		dbGlobal: { value: c.globalFactor },
		dbFillIntensity: { value: c.fillIntensity },
		dbAA: { value: c.aaMethod },
		dbSunColor: { value: new Vector3().fromArray(c.resolvedSunColor) },
		dbSky: { value: new Vector3().fromArray(c.fillSkyColor) },
		dbGround: { value: new Vector3().fromArray(c.fillGroundColor) },
	};

	const clones: Texture[] = [];

	const wrap = (v: string) => {
		switch (v) {
		case 'TA_Wrap':
			return RepeatWrapping;
		case 'TA_Clamp':
			return ClampToEdgeWrapping;
		case 'TA_Mirror':
			return MirroredRepeatWrapping;
		default:
			throw new Error('[DiamondBillboard] source sampler address required');
		}
	};

	for (const [role, t] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source?.isTexture) throw new Error(`[DiamondBillboard] actual ${role} source required`);

		const texture = source.clone();
		texture.colorSpace = t.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = wrap(t.addressX);
		texture.wrapT = wrap(t.addressY);
		texture.generateMipmaps = t.mipmaps;
		texture.magFilter = t.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = t.mipmaps
			? t.nearest
				? NearestMipmapNearestFilter
				: LinearMipmapLinearFilter
			: texture.magFilter;
		texture.needsUpdate = true;
		clones.push(texture);
		uniforms[`db${role}`] = { value: texture };
	}

	const refresh = () => {
		if (
			![
				...runtime.primaryDirection,
				...runtime.primaryColor,
				...runtime.sunDirection,
				...runtime.viewport,
				runtime.swapLightFactor,
				runtime.timeOfDayHours,
				runtime.inverseProjectionX,
			].every(Number.isFinite)
		) throw new Error('[DiamondBillboard] actual Home view/lighting required');

		const values: Record<string, unknown> = {
			dbPrimaryDirection: new Vector3().fromArray(runtime.primaryDirection),
			dbPrimaryColor: new Vector3().fromArray(runtime.primaryColor),
			dbSunDirection: new Vector3().fromArray(runtime.sunDirection),
			dbSwap: runtime.swapLightFactor,
			dbTOD: runtime.timeOfDayHours,
			dbViewport: runtime.viewport,
			dbInverseProjectionX: runtime.inverseProjectionX,
		};

		for (const [key, value] of Object.entries(values)) {
			if (uniforms[key]) uniforms[key]!.value = value;
			else uniforms[key] = { value };
		}
	};

	const material = new MeshPhysicalMaterial({
		side: DoubleSide,
		transparent: false,
		alphaTest: 0.3333,
		roughness: 0.1,
		metalness: 0.8,
	});
	material.forceSinglePass = true;
	material.userData.diamondBillboardCurrent = p;
	material.userData.diamondBillboardCurrentUniforms = uniforms;
	material.userData.diamondBillboardCurrentRefresh = refresh;
	material.onBeforeRender = update;
	refresh();
	material.onBeforeCompile = (shader) => {
		refresh();
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec2 diamondUV1;attribute vec4 diamondUV23;attribute float diamondBillboardSize;attribute vec3 diamondLocalCM;
uniform vec4 dbMaterial[29];varying vec4 vDBUV01,vDBUV23;varying vec3 vDBWorld,vDBLocalCM;`,
			)
			.replace(
				'#include <project_vertex>',
				`
mat4 dbWorld=modelMatrix;
#ifdef USE_INSTANCING
dbWorld=dbWorld*instanceMatrix;
#endif
vec4 dbCenter=dbWorld*vec4(transformed,1.0);vec4 mvPosition=viewMatrix*dbCenter;
float dbScale=length(dbWorld[0].xyz);
mvPosition.xy+=(uv-.5)*diamondBillboardSize*dbScale;
mvPosition.z+=dbMaterial[28].x*.01*dbScale;
gl_Position=projectionMatrix*mvPosition;
vDBWorld=dbCenter.xyz;vDBUV01=vec4(uv,diamondUV1);vDBUV23=diamondUV23;vDBLocalCM=diamondLocalCM;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${fragment}`)
			.replace('#include <map_fragment>', 'dbEvaluate();diffuseColor=vec4(dbBase,1.0);')
			.replace(
				'#include <normal_fragment_maps>',
				'normal=mat3(viewMatrix)*vec3(dbNormal.x,-dbNormal.y,dbNormal.z);',
			)
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=dbEmission;')
			.replace(
				'#include <lights_physical_fragment>',
				`#include <lights_physical_fragment>
material.specularColor=vec3(.08*dbSpecular);
material.specularColorBlended=mix(material.specularColor,diffuseColor.rgb,metalnessFactor);`,
			);
	};
	material.customProgramCacheKey = () => 'diamond-billboard-current:static-source-v1';
	material.addEventListener('dispose', () => clones.forEach((t) => t.dispose()));
	return material;
}
