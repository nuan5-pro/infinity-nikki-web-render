import {
	AddEquation,
	ClampToEdgeWrapping,
	CustomBlending,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshBasicMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NoColorSpace,
	OneMinusSrcAlphaFactor,
	RepeatWrapping,
	SrcAlphaFactor,
	SRGBColorSpace,
	Vector3,
	Vector4,
	ZeroFactor,
	type Camera,
	type Object3D,
	type Scene,
	type Texture,
	type WebGLRenderer,
} from 'three';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

interface CrystalTexture {
	parameter: string
	sRGB: boolean
	rgbScale: number
	addressX: string
	addressY: string
	mipmaps: boolean
	nearest: boolean
	cube: boolean
	bc5ZeroB?: boolean
}

export interface FurnitureTranslucentCrystal {
	version: 1
	family: 'translucent-crystal'
	blend: 'native-grey-straight-alpha'
	geometry: 'native-crystal-basis-v1'
	requiredUv: number[]
	scalars: Record<string, number>
	colors: Record<string, [number, number, number, number]>
	textures: Record<string, CrystalTexture>
	noiseReduction: 'native-G8-uint-mod5-budget24-v1'
	preview?: import('./translucentCrystalPreview.js').TranslucentCrystalPreviewDomain
}

export interface TranslucentCrystalLighting {
	/** Captured/editor-linked light in native UE world space; not screenshot tint. */
	nativeLightDirection: Vector3
	/** Native selected direct-light linear colour before max(.12)/desaturation. */
	nativeLightColor: Vector3
	/** Native runtime direct-light/shadow factor, range [0,1]. */
	shadow: number | TranslucentCrystalPreviewShadow
	/** Native runtime day/night blend scalar, range [-1,1]. */
	dayNight: number
	/** Native jewellery global attribute strength, range [0,1]. */
	jewelryStrength: number
	/** Native View[151].x sample_b bias; POM sample_d keeps original derivatives. */
	materialTextureMipBias: number
}

/** Preview shadow supplies a real renderer map and per-fragment visibility. */
export interface TranslucentCrystalPreviewShadow {
	kind: 'editor-directional-shadow'
	programKey: string
	uniforms: Record<string, { value: unknown }>
	fragment: string
	vertexDeclarations: string
	vertexBody: string
	update(renderer: WebGLRenderer, scene: Scene, camera: Camera, object: Object3D): void
}

function parameter(key: string): string {
	return `c${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

const scalarKeys = [
	'Crystal_N_Tiling',
	'Crystal_EdgeLightRange',
	'Crystal_EdgeLightUseTangent',
	'Crystal_D_Tiling',
	'Crystal_DetailHeightRatio',
	'Crystal_ReflectNormalTiling',
	'Crystal_ReflectNUseDetailPOMUV',
	'Crystal_OpMin',
	'Crystal_OpMax',
	'Crystal_DetailOpWeight',
	'Crystal_TotalEmissive',
	'Crystal_StripSpecWidth',
	'Crystal_RoughnessEmissiveMaskSwitch',
	'Global_NightEmissive',
	'Crystal_ShadowEmissive',
	'Global_IgnoreSunlight',
];

const colorKeys = [
	'Crystal_D_UVSelect',
	'Crystal_EdgeLightColor',
	'Crystal_StripSpecularColor',
	'Crystal_DetailMap_Tiling&Offset',
	'Crystal_DetailColorTint',
	'Crystal_D_Tint',
	'Crystal_HDRAttributes',
	'Crystal_HDRColorTint',
	'Global_Attr_Jewelrys',
];

export function readFurnitureTranslucentCrystal(value: unknown): FurnitureTranslucentCrystal | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as Record<string, unknown>;
	if (
		p.version !== 1 ||
		p.family !== 'translucent-crystal' ||
		p.blend !== 'native-grey-straight-alpha' ||
		p.geometry !== 'native-crystal-basis-v1' ||
		p.noiseReduction !== 'native-G8-uint-mod5-budget24-v1' ||
		!Array.isArray(p.requiredUv) ||
		!p.requiredUv.includes(0) ||
		!p.requiredUv.includes(1) ||
		new Set(p.requiredUv).size !== p.requiredUv.length ||
		!p.requiredUv.every((uv) => Number.isInteger(uv) && uv >= 0 && uv <= 3)
	) return null;
	if (
		!p.scalars ||
		typeof p.scalars !== 'object' ||
		!Object.values(p.scalars).every((v) => typeof v === 'number' && Number.isFinite(v)) ||
		!p.colors ||
		typeof p.colors !== 'object' ||
		!Object.values(p.colors).every(
			(v) =>
				Array.isArray(v) &&
				v.length === 4 &&
				v.every((n) => typeof n === 'number' && Number.isFinite(n)),
		) ||
		!p.textures ||
		typeof p.textures !== 'object'
	) return null;
	if (
		scalarKeys.some((key) => !(key in (p.scalars as object))) ||
		colorKeys.some((key) => !(key in (p.colors as object))) ||
		(p.scalars as Record<string, number>).Crystal_DetailHeightRatio! < 0
	) return null;

	const selection = (p.colors as Record<string, number[]>).Crystal_D_UVSelect!;
	if (
		selection.some((weight, channel) => weight !== 0 && !(p.requiredUv as number[]).includes(channel))
	) return null;

	const textures = p.textures as Record<string, CrystalTexture>;
	for (const role of ['D', 'N', 'T', 'O', 'D1', 'N1', 'S']) {
		const t = textures[role];
		if (
			!t ||
			typeof t.parameter !== 'string' ||
			typeof t.sRGB !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.cube !== 'boolean' ||
			t.cube !== (role === 'S') ||
			!Number.isFinite(t.rgbScale) ||
			t.rgbScale < 1 ||
			!['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(t.addressX) ||
			!['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(t.addressY)
		) return null;
	}

	return value as FurnitureTranslucentCrystal;
}

const core = /* glsl */ `
${nativeWorldFrameGLSL}
vec3 crystalPositivePow(vec3 value,float exponent) {
  return vec3(value.r>0.0?pow(value.r,exponent):0.0,
    value.g>0.0?pow(value.g,exponent):0.0,value.b>0.0?pow(value.b,exponent):0.0);
}
vec3 crystalNormal(vec2 rg,mat3 frame) {
  vec2 xy=rg*2.0-1.0;
  xy.y=-xy.y;
  return normalize(frame*vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0))));
}
vec3 crystalReflectNormal(vec2 bodyRG,vec2 reflectRG,mat3 frame) {
  // a576 440–463: source angle-corrected blend, deliberately not normalized
  // before 464–467's 2*dot(N,V)*N-V cube direction.
  vec2 bodyXY=bodyRG*2.0-1.0;
  vec2 reflectXY=reflectRG*2.0-1.0;
  vec3 body=vec3(bodyXY,sqrt(max(1.0-dot(bodyXY,bodyXY),0.0))+1.0);
  vec3 detail=vec3(-reflectXY,sqrt(max(1.0-dot(reflectXY,reflectXY),0.0)));
  vec3 combined=body*dot(body,detail)-detail*body.z;
  combined.y=-combined.y;
  return frame*combined;
}
vec2 crystalPOM(vec2 uv,vec3 view,mat3 frame) {
  // a576 364–368: signed tangent view / tangent Z, no abs-Z/epsilon.
  vec3 tangentView=vec3(dot(frame[0],view),-dot(frame[1],view),dot(frame[2],view));
  if (!(abs(tangentView.z)>0.0)) discard;
  vec2 ray=-tangentView.xy/tangentView.z*cCrystal_DetailHeightRatio;
  float steps=24.0+(8.0-24.0)*min(abs(tangentView.z),1.0);
  float inverse=1.0/steps;
  vec2 delta=ray*inverse;
  vec2 dx=dFdx(uv),dy=dFdy(uv);
  float bound=floor(steps)+2.0;
  float current=1.0,previous=1.0,previousSample=1.0;
  vec2 offset=vec2(0.0);
  for (int i=0;i<26;i++) {
    if (float(i)>=bound) break;
    // t28.yzwx -> destination .w reads source .x, NOT texture alpha.
    float sampleHeight=textureGrad(crystalD1,uv+offset,dx,dy).r;
    if (current<sampleHeight) {
      float difference=sampleHeight-current;
      float denominator=difference+previous-previousSample;
      if (!(abs(denominator)>0.0)) discard;
      offset-=delta*(difference/denominator);
      break;
    }
    previous=current;
    previousSample=sampleHeight;
    current-=inverse;
    offset+=delta;
  }
  return uv+offset;
}
vec3 crystalHDR(vec3 direction) {
  vec3 world=transpose(mat3(viewMatrix))*direction;
   vec3 native=normalize(furnitureNativeWorld(world));
  vec2 uv=vec2(fract(atan(-native.x,-native.z)/6.28318530718),1.0-acos(clamp(native.y,-1.0,1.0))/3.14159265359);
  vec3 colour=texture2D(crystalS,uv).rgb*crystalHDRScale;
  colour=crystalPositivePow(colour,cCrystal_HDRAttributes.r);
  colour=mix(colour,vec3(dot(colour,vec3(.3,.59,.11))),clamp(1.0-cCrystal_HDRAttributes.g,0.0,1.0));
  vec3 axis=vec3(.57735026919);
  float angle=cCrystal_HDRAttributes.b*6.28318530718;
  return (colour*cos(angle)+cross(axis,colour)*sin(angle)+axis*dot(axis,colour)*(1.0-cos(angle)))*cCrystal_HDRColorTint.rgb;
}
`;

export function createTranslucentCrystalMaterial(
	p: FurnitureTranslucentCrystal,
	sources: Partial<Record<string, Texture | null>>,
	lighting: TranslucentCrystalLighting,
): MeshBasicMaterial {
	if (!readFurnitureTranslucentCrystal(p)) throw new Error('[ModelManager][Crystal] incomplete native profile');
	if (
		![
			lighting.nativeLightDirection.x,
			lighting.nativeLightDirection.y,
			lighting.nativeLightDirection.z,
			lighting.nativeLightColor.x,
			lighting.nativeLightColor.y,
			lighting.nativeLightColor.z,
			lighting.dayNight,
			lighting.jewelryStrength,
			lighting.materialTextureMipBias,
		].every(Number.isFinite) ||
		(typeof lighting.shadow === 'number'
			? !Number.isFinite(lighting.shadow) || lighting.shadow < 0 || lighting.shadow > 1
			: lighting.shadow.kind !== 'editor-directional-shadow') ||
		lighting.dayNight < -1 ||
		lighting.dayNight > 1 ||
		lighting.jewelryStrength < 0 ||
		lighting.jewelryStrength > 1
	) throw new Error('[ModelManager][Crystal] native light/shadow/day-night inputs required');

	const owned: Texture[] = [];
	const textures: Record<string, Texture> = {};

	const wrap = (address: string) =>
		address === 'TA_Clamp'
			? ClampToEdgeWrapping
			: address === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const [role, contract] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source) throw new Error(`[ModelManager][Crystal] native resource ${role} missing`);

		const texture = source.clone();
		texture.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = contract.cube ? RepeatWrapping : wrap(contract.addressX);
		texture.wrapT = contract.cube ? ClampToEdgeWrapping : wrap(contract.addressY);
		texture.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = contract.nearest
			? NearestFilter
			: contract.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		texture.generateMipmaps = contract.mipmaps;
		if (contract.cube) texture.flipY = false;
		texture.needsUpdate = true;
		textures[role] = texture;
		owned.push(texture);
	}
	// Native grey enum is BLEND_Translucent's numeric alias. This selected legacy
	// Subsurface BasePass writes straight colour/coverage, not opaque/premultiplied.
	const material = new MeshBasicMaterial({
		transparent: true,
		depthWrite: false,
		blending: CustomBlending,
		blendEquation: AddEquation,
		blendSrc: SrcAlphaFactor,
		blendDst: OneMinusSrcAlphaFactor,
		blendEquationAlpha: AddEquation,
		blendSrcAlpha: ZeroFactor,
		blendDstAlpha: OneMinusSrcAlphaFactor,
		forceSinglePass: true,
	});
	material.defines = { USE_TANGENT: '' };
	material.userData.translucentCrystal = p;
	material.addEventListener('dispose', () => owned.forEach((texture) => texture.dispose()));
	material.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
		const transport = geometry.userData.ueTranslucentCrystalProof;
		const candidate: unknown = group;
		const drawGroup =
			candidate &&
			typeof candidate === 'object' &&
			'start' in candidate &&
			typeof candidate.start === 'number' &&
			Number.isInteger(candidate.start) &&
			candidate.start >= 0 &&
			'count' in candidate &&
			typeof candidate.count === 'number' &&
			Number.isInteger(candidate.count) &&
			candidate.count >= 0 &&
			'materialIndex' in candidate &&
			typeof candidate.materialIndex === 'number' &&
			Number.isInteger(candidate.materialIndex) &&
			candidate.materialIndex >= 0
				? { start: candidate.start, count: candidate.count, materialIndex: candidate.materialIndex }
				: undefined;
		const ranges = transport?.drawRanges;
		const range = Array.isArray(ranges)
			? ranges.find(
				(entry) =>
					drawGroup &&
						entry.start === drawGroup.start &&
						entry.count === drawGroup.count &&
						entry.materialIndex === drawGroup.materialIndex,
			)
			: undefined;
		const proof = Array.isArray(ranges) ? range?.proof : transport;
		const count = geometry.getAttribute('position')?.count;
		const vertexCount = range?.vertexCount ?? count;
		const vertexStart = range?.vertexStart ?? 0;
		if (
			!count ||
			!Number.isInteger(vertexStart) ||
			!Number.isInteger(vertexCount) ||
			vertexStart < 0 ||
			!vertexCount ||
			vertexStart + vertexCount > count ||
			!proof ||
			proof.contract !== p.geometry ||
			proof.verifiedVertexCount !== vertexCount ||
			proof.basisMatched !== true ||
			proof.uvMatched !== true ||
			proof.positionMatched !== true ||
			proof.mismatches !== 0 ||
			proof.pose !== 'source-bind-pose' ||
			('isSkinnedMesh' in object && object.isSkinnedMesh) ||
			geometry.getAttribute('tangent')?.itemSize !== 4 ||
			geometry.getAttribute('tangent')?.count !== count ||
			p.requiredUv.some((channel) => geometry.getAttribute(channel === 0 ? 'uv' : `uv${channel}`)?.count !== count)
		) throw new Error('[ModelManager][Crystal] original native frame/UV/bind-pose proof required');

		if (typeof lighting.shadow !== 'number') lighting.shadow.update(renderer, scene, camera, object);
	};
	material.onBeforeCompile = (shader) => {
		let declarations = '';
		for (const [key, value] of Object.entries(p.scalars)) {
			shader.uniforms[parameter(key)] = { value };
			declarations += `uniform float ${parameter(key)};\n`;
		}

		for (const [key, value] of Object.entries(p.colors)) {
			shader.uniforms[parameter(key)] = { value: new Vector4(...value) };
			declarations += `uniform vec4 ${parameter(key)};\n`;
		}

		for (const [role, texture] of Object.entries(textures)) {
			shader.uniforms[`crystal${role}`] = { value: texture };
			declarations += `uniform sampler2D crystal${role};\n`;
		}

		shader.uniforms.crystalHDRScale = { value: p.textures.S!.rgbScale };
		shader.uniforms.crystalNativeLight = { value: lighting.nativeLightDirection };
		shader.uniforms.crystalNativeLightColor = { value: lighting.nativeLightColor };
		if (typeof lighting.shadow === 'number')
			shader.uniforms.crystalShadow = { value: lighting.shadow };
		else Object.assign(shader.uniforms, lighting.shadow.uniforms);

		shader.uniforms.crystalDayNight = { value: lighting.dayNight };
		shader.uniforms.crystalJewelryStrength = { value: lighting.jewelryStrength };
		shader.uniforms.crystalMipBias = { value: lighting.materialTextureMipBias };

		const varyings = 'varying vec3 vCrystalPosition,vCrystalNormal,vCrystalTangent;\nvarying float vCrystalHandedness;\nvarying vec2 vCrystalUV0,vCrystalUV1,vCrystalUV2,vCrystalUV3;';
		shader.vertexShader = shader.vertexShader
			.replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
			.replace('#include <common>', `#include <common>\n${varyings}`)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>\nvCrystalPosition=mvPosition.xyz;\nvCrystalNormal=transformedNormal;\nvCrystalTangent=transformedTangent;\nfloat crystalParity=sign(determinant(mat3(modelMatrix)));\n#ifdef USE_INSTANCING\ncrystalParity*=sign(determinant(mat3(instanceMatrix)));\n#endif\nvCrystalHandedness=tangent.w*crystalParity;\nvCrystalUV0=uv;\nvCrystalUV1=uv1;\nvCrystalUV2=${p.requiredUv.includes(2) ? 'uv2' : 'uv'};\nvCrystalUV3=${p.requiredUv.includes(3) ? 'uv3' : 'uv'};`,
			);
		shader.vertexShader =
			'#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\n#ifndef USE_UV2\nattribute vec2 uv2;\n#endif\n#ifndef USE_UV3\nattribute vec2 uv3;\n#endif\n' +
			shader.vertexShader;
		if (typeof lighting.shadow !== 'number') {
			shader.vertexShader = lighting.shadow.vertexDeclarations + shader.vertexShader;
			shader.vertexShader = shader.vertexShader.replace(
				'#include <project_vertex>',
				`#include <project_vertex>\n${lighting.shadow.vertexBody}`,
			);
		}

		const body = /* glsl */ `
vec3 view=isOrthographic?vec3(0,0,1):normalize(-vCrystalPosition);
vec3 geometric=normalize(vCrystalNormal),tangent=normalize(vCrystalTangent);
mat3 frame=mat3(tangent,cross(geometric,tangent)*vCrystalHandedness,geometric);
vec4 bodyNormalSample=texture2D(crystalN,vCrystalUV0*cCrystal_N_Tiling);
vec2 bodyNormalRG=bodyNormalSample.rg;
vec3 normal=crystalNormal(bodyNormalRG,frame);
float edge=pow(max(abs(1.0-max(dot(normal,view),0.0)),.0001),cCrystal_EdgeLightRange);
float along=abs(dot(tangent,view));
float tangentEdge=along>0.0?pow(along,cCrystal_EdgeLightRange*2.5):0.0;
edge=mix(edge,tangentEdge,cCrystal_EdgeLightUseTangent);
vec3 second=texture2D(crystalT,vCrystalUV1,crystalMipBias).rgb;
vec2 bodyUV=(vCrystalUV0*cCrystal_D_UVSelect.x+vCrystalUV1*cCrystal_D_UVSelect.y+vCrystalUV2*cCrystal_D_UVSelect.z+vCrystalUV3*cCrystal_D_UVSelect.w)*cCrystal_D_Tiling;
vec4 bodySample=texture2D(crystalD,bodyUV);
vec3 rawBody=bodySample.rgb*clamp(second,0.0,1.0);
vec3 halfGrey=mix(rawBody,vec3(dot(rawBody,vec3(.3,.59,.11))),.5);
vec3 masks=texture2D(crystalO,vCrystalUV0).rgb;
vec3 nativeLight=max(crystalNativeLight,vec3(.001));
vec3 editorLight=vec3(nativeLight.x,-nativeLight.y,nativeLight.z);
vec3 viewLight=mat3(viewMatrix)*editorLight;
float strip=1.0-abs(dot(viewLight,reflect(-view,normal)));
vec3 stripColour=strip>0.0?pow(strip,cCrystal_StripSpecWidth)*cCrystal_StripSpecularColor.rgb*halfGrey*masks.g:vec3(0);
vec2 detailBase=vCrystalUV0*cCrystal_DetailMap_Tiling_Offset.xy+cCrystal_DetailMap_Tiling_Offset.zw;
vec2 detailUV=crystalPOM(detailBase,view,frame);
vec3 detail=texture2D(crystalD1,detailUV,crystalMipBias).rgb;
vec3 colour=rawBody*cCrystal_D_Tint.rgb+detail*cCrystal_DetailColorTint.rgb*halfGrey+halfGrey*cCrystal_EdgeLightColor.rgb*edge*masks.r+stripColour;
vec2 reflectBase=vCrystalUV0*cCrystal_ReflectNormalTiling;
vec2 reflectDetail=detailUV*cCrystal_ReflectNormalTiling;
vec2 reflectUV=mix(reflectBase-vec2(dot(tangent,view),-dot(frame[1],view))*.175,reflectDetail,cCrystal_ReflectNUseDetailPOMUV);
vec3 reflectNormal=crystalReflectNormal(bodyNormalRG,texture2D(crystalN1,reflectUV).rg,frame);
colour+=crystalHDR(reflect(-view,reflectNormal))*halfGrey;
vec3 globalAttributes=mix(vec3(1.0),cGlobal_Attr_Jewelrys.gba,crystalJewelryStrength);
colour=mix(vec3(dot(colour,vec3(.3,.59,.11))),colour,globalAttributes.r)*globalAttributes.g;
colour=crystalPositivePow(colour,globalAttributes.b);
float coverage=clamp(bodySample.a*(cCrystal_OpMax-cCrystal_OpMin)+cCrystal_OpMin,0.0,1.0);
coverage=clamp(coverage+coverage*(dot(detail,vec3(.3,.59,.11))-.5)*cCrystal_DetailOpWeight,0.0,1.0);
float dayFactor=mix((crystalDayNight+1.0)*.5,1.0,cGlobal_NightEmissive);
// r16.z is the original t23.z channel, not t26 specular-mask B.
float emissiveMask=clamp(bodyNormalSample.b+cCrystal_RoughnessEmissiveMaskSwitch,0.0,1.0);
float shadowFactor=clamp(crystalShadow+cCrystal_ShadowEmissive,0.0,1.0);
vec3 lightColour=max(crystalNativeLightColor,vec3(.12));
lightColour=mix(lightColour,vec3(dot(lightColour,vec3(.3,.59,.11))),.7);
lightColour=clamp(lightColour+vec3(cGlobal_IgnoreSunlight),0.0,1.0);
diffuseColor.rgb=colour*cCrystal_TotalEmissive*lightColour*dayFactor*emissiveMask*shadowFactor;
diffuseColor.a=coverage;
`;
		let materialBody = body;
		if (typeof lighting.shadow !== 'number')
			materialBody = materialBody.replace('crystalShadow+cCrystal_ShadowEmissive', 'crystalPreviewShadow()+cCrystal_ShadowEmissive');

		let samples = '';
		for (const [role, contract] of Object.entries(p.textures)) {
			if (!contract.bc5ZeroB) continue;
			samples += `vec4 crystalSample${role}(vec2 uv) { vec4 pixel=texture2D(crystal${role},uv); pixel.b=0.0; return pixel; }\n`;
			samples += `vec4 crystalSample${role}(vec2 uv,float bias) { vec4 pixel=texture2D(crystal${role},uv,bias); pixel.b=0.0; return pixel; }\n`;
			materialBody = materialBody.split(`texture2D(crystal${role},`).join(`crystalSample${role}(`);
		}

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>\n${varyings}\n${declarations}\nuniform float crystalHDRScale,crystalShadow,crystalDayNight,crystalJewelryStrength,crystalMipBias;\nuniform vec3 crystalNativeLight,crystalNativeLightColor;\n${typeof lighting.shadow === 'number' ? '' : lighting.shadow.fragment}\n${samples}${core}`,
			)
			.replace('#include <map_fragment>', materialBody)
			.replace('#include <alphamap_fragment>', '')
			.replace('#include <color_fragment>', '');
	};
	material.customProgramCacheKey = () =>
		`translucent-crystal-native-4-world-frame-v1:${JSON.stringify(p.requiredUv)}:${typeof lighting.shadow === 'number' ? 'native-runtime-scalar-shadow' : lighting.shadow.programKey}`;
	return material;
}
