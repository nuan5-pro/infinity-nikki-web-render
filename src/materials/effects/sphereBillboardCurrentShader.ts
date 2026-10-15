import {
	ClampToEdgeWrapping,
	DataArrayTexture,
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
	Vector4,
	type Texture,
} from 'three';

interface SphereTexture {
	parameter: string
	sRGB: boolean
	rgbScale: number
	addressX: string
	addressY: string
	mipmaps: boolean
	nearest: boolean
	cube: boolean
}

export interface FurnitureSphereBillboardCurrent {
	version: 1
	family: 'sphere-billboard-current'
	uniforms: number[][]
	textures: Record<string, SphereTexture>
	arrayLayers: 9
	requiredUV: number[]
	twoSided: boolean
	approximation: string
}

export interface SphereBillboardCurrentRuntime {
	sizeMultiplier?: number
}

export function readFurnitureSphereBillboardCurrent(value: unknown): FurnitureSphereBillboardCurrent | null {
	const p = value as FurnitureSphereBillboardCurrent;
	if (
		!p ||
		p.version !== 1 ||
		p.family !== 'sphere-billboard-current' ||
		p.uniforms?.length !== 36 ||
		p.arrayLayers !== 9 ||
		!['N', 'D', 'D1', 'O', 'O1', 'O2', 'M', 'S', 'B'].every((role) => p.textures?.[role])
	) return null;

	return p;
}

const declarations = /* glsl */ `
uniform vec4 sbMaterial[36];uniform sampler2D sbN,sbD,sbD1,sbO,sbO1,sbO2,sbM,sbS;
uniform highp sampler2DArray sbB;uniform float sbCubeScale;
varying vec4 vSBUV;varying vec3 vSBWorld;varying float vSBShapeSelector;
vec3 sbNormal,sbBase,sbEmission;float sbMetal,sbRough;
void sphereBillboardPreview(){
  vec2 xy=vSBUV.xy*2.0-1.0;
  if(dot(xy,xy)>1.0)discard;
  vec2 rg=texture2D(sbN,vSBUV.xy).rg*2.0-1.0;
  vec3 sphereNormal=normalize(vec3(mix(xy,rg,.35),sqrt(max(1.0-dot(xy,xy),.001))));
  float layer=clamp(mix(sbMaterial[10].w,sbMaterial[10].z,vSBShapeSelector*2.0-1.0),0.0,8.0);
  vec2 shapeUV=vec2(atan(sphereNormal.x,sphereNormal.z)/6.28318530718+.5,acos(clamp(sphereNormal.y,-1.0,1.0))/3.14159265359);
  float shape=texture(sbB,vec3(shapeUV,layer)).r;
  sphereNormal=normalize(vec3(sphereNormal.xy,sphereNormal.z*(.5+shape)));
  sbNormal=sphereNormal;
  vec3 detail=texture2D(sbD,vSBUV.zw*sbMaterial[12].xy+sbMaterial[12].zw).rgb;
  vec3 base=clamp(detail+sbMaterial[13].x,0.0,1.0)*texture2D(sbD1,vSBUV.xy).rgb*sbMaterial[13].yzw;
  vec3 grey=vec3(dot(base,vec3(.3,.59,.11))),soft=mix(base,grey,.5);
  float rim=pow(max(1.0-sphereNormal.z,.0001),max(sbMaterial[11].z,.001));
  vec3 cap=texture2D(sbO,sphereNormal.xy*vec2(.5,-.5)+.5).rgb*sbMaterial[17].rgb;
  vec3 view=normalize(cameraPosition-vSBWorld);
  vec3 worldNormal=normalize(vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0])*sphereNormal.x+
    vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1])*sphereNormal.y+view*sphereNormal.z);
  vec3 reflection=reflect(-view,worldNormal);
  vec2 cubeUV=vec2(fract(atan(-reflection.x,-reflection.z)/6.28318530718),1.0-acos(clamp(reflection.y,-1.0,1.0))/3.14159265359);
  vec3 hdr=texture2D(sbS,cubeUV).rgb*sbCubeScale*sbMaterial[16].rgb;
  vec3 color=base+soft*(rim*sbMaterial[14].rgb+cap+hdr);
  float noise=texture2D(sbO1,vSBUV.xy*sbMaterial[25].x).r;
  float dissolve=sbMaterial[27].x*sbMaterial[27].y+sbMaterial[27].z;
  float visibility=smoothstep(sbMaterial[28].x,sbMaterial[27].w,noise-dissolve);
  color=mix(sbMaterial[28].yzw,color,visibility);
  vec3 mask=texture2D(sbM,vSBUV.xy).rgb;
  sbMetal=clamp(mask.r*sbMaterial[33].x,0.0,1.0);sbRough=clamp(mask.g*sbMaterial[33].y,.1,1.0);
  sbBase=clamp(color,0.0,1.0);
  float glow=texture2D(sbO2,vSBUV.xy).r*rim*sbMaterial[30].x;
  sbEmission=max(color*.15+glow*sbMaterial[29].yzw,vec3(0.0));
}
`;

export function createSphereBillboardCurrentMaterial(
	p: FurnitureSphereBillboardCurrent,
	sources: Partial<Record<string, Texture | null>>,
	runtime: SphereBillboardCurrentRuntime = {},
	update?: MeshPhysicalMaterial['onBeforeRender'],
): MeshPhysicalMaterial {
	if (!readFurnitureSphereBillboardCurrent(p)) throw new Error('[SphereBillboard] source profile required');

	const uniforms: Record<string, { value: unknown }> = {
		sbMaterial: { value: p.uniforms.map((r) => new Vector4().fromArray(r)) },
		sbCubeScale: { value: p.textures.S!.rgbScale },
		sbSizeMultiplier: { value: runtime.sizeMultiplier ?? 1 },
	};

	const clones: Texture[] = [];

	const wrap = (v: string) => {
		switch (v) {
		case 'TA_Clamp':
			return ClampToEdgeWrapping;
		case 'TA_Mirror':
			return MirroredRepeatWrapping;
		default:
			return RepeatWrapping;
		}
	};

	for (const [role, c] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source?.isTexture) throw new Error(`[SphereBillboard] ${role} source required`);
		if (role === 'B' && (!(source instanceof DataArrayTexture) || source.image.depth !== 9)) throw new Error('[SphereBillboard] all9 source shape layers required');

		const tex = source.clone();
		tex.colorSpace = c.sRGB ? SRGBColorSpace : NoColorSpace;
		tex.wrapS = wrap(c.addressX);
		tex.wrapT = wrap(c.addressY);
		tex.generateMipmaps = c.mipmaps;
		tex.magFilter = c.nearest ? NearestFilter : LinearFilter;
		tex.minFilter = c.mipmaps
			? c.nearest
				? NearestMipmapNearestFilter
				: LinearMipmapLinearFilter
			: tex.magFilter;
		tex.needsUpdate = true;
		clones.push(tex);
		uniforms[`sb${role}`] = { value: tex };
	}

	const material = new MeshPhysicalMaterial({ side: DoubleSide, roughness: 0.3 });
	material.userData.sphereBillboardCurrent = p;
	material.userData.sphereBillboardCurrentUniforms = uniforms;
	if (update) material.onBeforeRender = update;
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec2 sphereUV1;attribute vec4 sphereNativeColor;attribute float sphereBillboardSize;
uniform float sbSizeMultiplier;varying vec4 vSBUV;varying vec3 vSBWorld;varying float vSBShapeSelector;`,
			)
			.replace(
				'#include <project_vertex>',
				`
mat4 sbWorld=modelMatrix;
#ifdef USE_INSTANCING
sbWorld=sbWorld*instanceMatrix;
#endif
vec4 sbCenter=sbWorld*vec4(transformed,1.0);vec4 sbView=viewMatrix*sbCenter;
float sbScale=max(length(sbWorld[0].xyz),max(length(sbWorld[1].xyz),length(sbWorld[2].xyz)));
sbView.xy+=(uv-.5)*sphereBillboardSize*sbScale*sbSizeMultiplier;
vec4 mvPosition=sbView;gl_Position=projectionMatrix*mvPosition;vSBWorld=sbCenter.xyz;vSBUV=vec4(uv,sphereUV1);vSBShapeSelector=sphereNativeColor.b;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${declarations}`)
			.replace('#include <map_fragment>', 'sphereBillboardPreview();diffuseColor=vec4(sbBase,1.0);')
			.replace('#include <normal_fragment_maps>', 'normal=sbNormal;')
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=sbRough;')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor=sbMetal;')
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=sbEmission;');
	};
	material.customProgramCacheKey = () => 'sphere-billboard-current-preview';
	material.addEventListener('dispose', () => clones.forEach((t) => t.dispose()));
	return material;
}
