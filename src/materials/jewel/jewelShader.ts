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
	Vector4,
	type Texture,
} from 'three';
import {
	createJewelryMaskedShaderState,
	jewelryMaskedColorCore,
	jewelryMaskedFragmentDeclarations,
	readJewelryMaskedSourceContract,
	type JewelryMaskedMaterialOptions,
	type JewelryMaskedSourceContract,
} from './jewelryMaskedShader.js';
import { jewelrySimpleColorCore, jewelrySimpleRoles } from './jewelrySimplePreview.js';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

interface JewelTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
	bc5ZeroB?: boolean;
}

export interface FurnitureJewel {
	preview?: 'jewelry-simple-1';
	maskedSource?: JewelryMaskedSourceContract;
	opal?: { parallax: boolean; heightGradient: boolean; geometry: 'native-opal-primitive-v1' };
	requiredUv: number[];
	family:
		| 'jewel'
		| 'blue-crystal'
		| 'opaque-crystal'
		| 'opaque-crystal-cube'
		| 'jewelry-matcap'
		| 'pearl-matcap'
		| 'opal';
	rgbReflection?: boolean;
	diffuseRefract?: boolean;
	faceNormal?: boolean;
	emissionOnly?: boolean;
	alphaMode: 'constant' | 'diffuse-a' | 'diffuse-r' | 'jewelry-r-a' | 'pearl-a-circle' | 'opal-a';
	blend: 'opaque' | 'masked';
	alphaCutoff: number;
	scalars: Record<string, number>;
	colors: Record<string, [number, number, number, number]>;
	textures: Record<string, JewelTexture>;
}

export function readFurnitureJewel(value: unknown): FurnitureJewel | null {
	if (!value || typeof value !== 'object') return null;

	const jewel = value as FurnitureJewel;
	if (
		![
			'jewel',
			'blue-crystal',
			'opaque-crystal',
			'opaque-crystal-cube',
			'jewelry-matcap',
			'pearl-matcap',
			'opal',
		].includes(jewel.family) ||
		!['constant', 'diffuse-a', 'diffuse-r', 'jewelry-r-a', 'pearl-a-circle', 'opal-a'].includes(jewel.alphaMode) ||
		!['opaque', 'masked'].includes(jewel.blend) ||
		!Number.isFinite(jewel.alphaCutoff) ||
		!jewel.scalars ||
		!jewel.colors ||
		!jewel.textures ||
		!Array.isArray(jewel.requiredUv) ||
		!jewel.requiredUv.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 3)
	) return null;
	if (
		!Object.values(jewel.scalars).every((item) => typeof item === 'number' && Number.isFinite(item)) ||
		!Object.values(jewel.colors).every((item) => Array.isArray(item) && item.length === 4 && item.every(Number.isFinite))
	) return null;
	if (
		'maskedSource' in jewel &&
		(jewel.family !== 'jewelry-matcap' ||
			jewel.blend !== 'masked' ||
			jewel.alphaMode !== 'jewelry-r-a' ||
			jewel.opal ||
			!readJewelryMaskedSourceContract(jewel.maskedSource))
	) return null;
	if (
		'preview' in jewel &&
		(jewel.preview !== 'jewelry-simple-1' ||
			jewel.family !== 'jewelry-matcap' ||
			jewel.blend !== 'masked' ||
			jewel.alphaMode !== 'jewelry-r-a' ||
			'maskedSource' in jewel ||
			jewel.opal ||
			![...jewelrySimpleRoles].every((role) => jewel.textures[role] && !jewel.textures[role]!.cube))
	) return null;
	if (
		jewel.opal &&
		(jewel.family !== 'opal' ||
			jewel.opal.geometry !== 'native-opal-primitive-v1' ||
			typeof jewel.opal.parallax !== 'boolean' ||
			typeof jewel.opal.heightGradient !== 'boolean' ||
			(!jewel.opal.parallax && !jewel.opal.heightGradient))
	) return null;

	if (jewel.family === 'opal') {
		const low = jewel.colors.Gradient_Color_Low;
		const high = jewel.colors.Gradient_Color_High;
		if (!low || !high || !Number.isFinite(jewel.scalars.Depth)) return null;

		const gradient = low.slice(0, 3).some((value, index) => value !== high[index]);
		if (
			(jewel.scalars.Depth !== 0) !== !!jewel.opal?.parallax ||
			gradient !== !!jewel.opal?.heightGradient
		) return null;
		if (
			jewel.opal?.parallax &&
			(!jewel.textures.D1 ||
				jewel.textures.D1.parameter !== 'Parallax Texture' ||
				jewel.textures.D1.cube)
		) return null;
		if (
			gradient &&
			(!(jewel.scalars.MeshHeight! > 0) ||
				!['Vertical Gradient Power', 'Vertical Gradient Mult'].every((key) => Number.isFinite(jewel.scalars[key])))
		) return null;
	}

	for (const texture of Object.values(jewel.textures)) {
		if (
			!texture ||
			typeof texture.parameter !== 'string' ||
			typeof texture.sRGB !== 'boolean' ||
			!Number.isFinite(texture.rgbScale) ||
			texture.rgbScale < 1 ||
			typeof texture.cube !== 'boolean' ||
			typeof texture.mipmaps !== 'boolean' ||
			typeof texture.nearest !== 'boolean' ||
			![texture.addressX, texture.addressY].every((address) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(address))
		) return null;
	}

	return jewel;
}

const parameterName = (name: string) => `j${name.replace(/[^a-zA-Z0-9_]/g, '_')}`;

const sharedFragment = /* glsl */ `
${nativeWorldFrameGLSL}
varying vec3 vJewelPosition;
varying vec3 vJewelNormal;
varying vec2 vJewelUV0;
varying vec2 vJewelUV1;
varying vec2 vJewelUV2;
varying vec2 vJewelUV3;
uniform bool jewelCoordinatesReady;
uniform bool jewelFaceNormal;
vec2 jewelUV(vec4 weights) {
  return weights.x*vJewelUV0 + weights.y*vJewelUV1 + weights.z*vJewelUV2 + weights.w*vJewelUV3;
}
vec3 jewelView() {
  return isOrthographic ? vec3(0.0,0.0,1.0) : normalize(-vJewelPosition);
}
mat3 jewelFrame(vec3 normal) {
  vec3 dx = dFdx(vJewelPosition), dy = dFdy(vJewelPosition);
  vec2 ux = dFdx(vJewelUV0), uy = dFdy(vJewelUV0);
  vec3 t = cross(dy, normal)*ux.x + cross(normal, dx)*uy.x;
  vec3 b = cross(dy, normal)*ux.y + cross(normal, dx)*uy.y;
  float magnitude = max(dot(t,t),dot(b,b));
  if (magnitude < 0.00000001) {
    t = normalize(cross(abs(normal.z)<0.9 ? vec3(0,0,1) : vec3(0,1,0),normal));
    return mat3(t,cross(normal,t),normal);
  }
  return mat3(t*inversesqrt(magnitude),b*inversesqrt(magnitude),normal);
}
vec3 jewelNormal(vec2 rg, float flatten, mat3 frame) {
  vec2 xy = rg*2.0-1.0;
  // native-rg transport leaves G intact. The final Three tangent frame
  // receives the UE -> GLTF Y reflection exactly once, here only.
  xy.y = -xy.y;
  vec3 n = vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));
  return normalize(frame*mix(n,vec3(0,0,1),flatten));
}
vec3 jewelFacingNormal(vec3 normal) {
  return jewelFaceNormal && !gl_FrontFacing ? -normal : normal;
}
vec3 jewelCube(sampler2D panorama, vec3 viewDirection, float scale) {
  vec3 worldDirection = transpose(mat3(viewMatrix))*normalize(viewDirection);
  // The view inverse already produces final editor world, not source GLB axes.
  vec3 nativeDirection = normalize(furnitureNativeWorld(worldDirection));
  // CUE CubeConverter: x=-sin(phi)sin(theta), z=-cos(phi)sin(theta),
  // image row j/H=1-theta/pi. GLTF image transport keeps flipY=false.
  float u = atan(-nativeDirection.x,-nativeDirection.z)/6.28318530718;
  float v = 1.0-acos(clamp(nativeDirection.y,-1.0,1.0))/3.14159265359;
  return texture2D(panorama,vec2(fract(u),v)).rgb*scale;
}
float jewelEdge(vec3 normal, vec3 view, float power) {
  return pow(max(abs(1.0-max(dot(normal,view),0.0)),0.0001),power);
}
vec3 jewelPowPositive(vec3 colour, float power) {
  vec3 result = pow(max(colour,vec3(0.00000001)),vec3(power));
  // Native ge(0,RGB) / movc returns zero even when the exponent is zero.
  return vec3(colour.r>0.0 ? result.r : 0.0,colour.g>0.0 ? result.g : 0.0,colour.b>0.0 ? result.b : 0.0);
}
`;

const classicCore = (emissionOnly: boolean) => /* glsl */ `
mat3 frame = jewelFrame(normalize(vJewelNormal));
vec4 normalSample = texture2D(jewelN,vJewelUV0*jJewel_N_Tiling);
vec3 tangentNormal = jewelNormal(normalSample.rg,jJewel_N_Flatness,frame);
vec3 normal = jewelFacingNormal(tangentNormal);
vec3 view = jewelView();
vec3 reflection = reflect(-view,normal);
vec3 tint = mix(jJewel_D_Tint.rgb*jJewel_D_Tint.a,
  jJewel_D_EdgeTint.rgb*jJewel_D_EdgeTint.a,jewelEdge(normal,view,jD_EdgeTintRange));
vec4 body = texture2D(jewelD,jewelUV(jJewel_D_UV)*jJewel_D_Tiling);
vec3 base = body.rgb*tint;
float materialMask = mix(body.a,1.0,jUseAlphaMask);
vec3 refraction = jewelCube(jewelO,-normalize(view+tangentNormal*jRefraction_Distortion),jewelScaleO);
vec3 core = mix(base,base*refraction*jJewel_Refraction_Tint.rgb*jJewel_Refraction_Tint.a,
  materialMask*jRefractionAmount);
float fresnel = 0.04+0.96*jewelEdge(normal,view,jReflectionExp);
core += base*jewelCube(jewelO,reflection,jewelScaleO)*fresnel*
  jJewel_Reflection_Tint.rgb*jJewel_Reflection_Tint.a;
vec2 tangentView = vec2(dot(frame[0],view),dot(frame[1],view));
vec2 bumpUV = (vJewelUV0+(normalSample.rg*2.0-vec2(1.5))*jBumpNormal_Intensity)*jBumpPattern_Tiling;
bumpUV += tangentView*(-0.6*jBumpPattern_Height);
float pattern = dot(texture2D(jewelT,bumpUV).rgb,jBumpPatternChannel.rgb);
pattern *= mix(1.0,materialMask,jUseAlphaAsMask);
core += base*pattern*jBumpPattern_Color.rgb*jBumpPattern_Color.a;
vec3 jewelColor = ${emissionOnly ? 'vec3(0)' : 'clamp(core*jTotalIntensityControl,0.0,1.0)'} +
  max(core,vec3(0))*jTotalIntensityControl*jHomeEmissiveToggle*
  jJewel_Emissive*max(jJewel_EmissiveInShadow,1.0);
`;

const blueCore = (rgbReflection: boolean, diffuseRefract: boolean) => /* glsl */ `
mat3 frame = jewelFrame(normalize(vJewelNormal));
vec3 view = jewelView();
vec3 tangentNormal = jewelNormal(texture2D(jewelN,vJewelUV0*jNormalTiling).rg,0.0,frame);
vec3 normal = jewelFacingNormal(tangentNormal);
vec2 tangentView = vec2(dot(frame[0],view),dot(frame[1],view));
vec4 detail = texture2D(jewelT,vJewelUV0-0.5*jDepth*tangentView);
vec3 cubeColour = jewelCube(jewelO,-normalize(view+tangentNormal*jNormalDistortion),jewelScaleO);
vec3 refracted = cubeColour;
refracted *= jRefractColor.rgb*jRefractLumi;
vec3 inner2 = jInnerColor2.rgb*jInnerColor2.a;
vec4 body = texture2D(jewelD,vJewelUV0);
${diffuseRefract ? 'inner2 *= body.rgb;' : ''}
refracted = mix(inner2,refracted,jRefracAmount);
refracted = mix(refracted,inner2,detail.b);
refracted = mix(refracted,jInnerDetailColorLight.rgb*jInnerDetailColorLight.a,
  detail.r*mix(jDetailAmount,1.0,detail.b));
refracted *= mix(jInneEmissiveIntensityMin,jInnerEmissiveIntensityMax,detail.b);
vec3 surface = body.rgb*jSurfaceDetailColorTint.rgb*jSurfaceEmissiveIntensity;
vec3 colour = mix(mix(refracted,surface,body.a),refracted*surface,jUseBaseColorEmissiveLerp);
float facing = pow(max(1.0-abs(dot(normal,view)),0.0),jFresnelPower);
// a925: the RGB reflection variant consumes the cube's R intensity times
// detail RGB. Scene-direction strip/sphere specular and glint are omitted.
colour += ${rgbReflection ? 'facing*detail.rgb*cubeColour.r' : 'vec3(facing*detail.g)'}*(jReflectionColor1.rgb*jReflectionIntensity-colour);
vec3 base = mix(colour,surface,body.a*jUseBaseColorEmissiveLerp);
vec3 emission = colour*jTotalEmissiveIntensity*(1.0-body.a*jUseBaseColorEmissiveLerp);
vec3 jewelColor = clamp(base,0.0,1.0)+max(emission,vec3(0));
`;

const opaqueCore = (cube: boolean) => /* glsl */ `
mat3 frame = jewelFrame(normalize(vJewelNormal));
vec3 view = jewelView();
vec3 normal = jewelFacingNormal(jewelNormal(texture2D(jewelN,vJewelUV0*jBaseTiling).rg,0.0,frame));
vec2 tangentView = vec2(dot(frame[0],view),dot(frame[1],view));
vec2 bodyUV = vJewelUV0*jBaseTiling + tangentView*(0.05*jBase_Color_Depth-0.025);
vec3 body = texture2D(jewelD,bodyUV).rgb;
${cube ? 'body *= jewelCube(jewelS,mix(-view,reflect(-view,normal),jUseNormalReflection),jewelScaleS);' : ''}
vec2 emissionUV = jewelUV(jEmissiveSelectUV)+tangentView*(0.05*jEmissive_Depth-0.025);
vec2 flow = texture2D(jewelO,jewelUV(jEmissiveSelectUV)*jFlowmapTiling.xy).rg*2.0-1.0;
vec2 flowOffset = flow*jFlowmapIntensity;
// Time zero retains both actual emission texture samples; BA are panner
// rates, not a static UV offset. Source animation is explicitly frozen.
vec3 emission = texture2D(jewelT,emissionUV*jEmissiveTexTiling.xy+flowOffset).rgb;
emission += texture2D(jewelT,emissionUV*jEmissiveTexTiling.xy+flowOffset).rgb;
emission = emission*jEmissiveColor.rgb+body*jEmissiveTintColor.rgb;
float edge = jewelEdge(normal,view,jFresnel_Setting.x);
float f = edge*(1.0-jFresnel_Setting.y)+jFresnel_Setting.y;
float range = clamp((f-jFresnel_Setting.z)/jFresnel_Setting.w,0.0,1.0);
range = range*range*(3.0-2.0*range);
vec3 inner = mix(jFresnel_Color_Inner.rgb,jFresnel_Color_Mid.rgb,min(range*2.0,1.0));
vec3 outer = mix(jFresnel_Color_Mid.rgb,jFresnel_Color_Outer.rgb,clamp((range-0.5)*2.0,0.0,1.0));
emission += mix(inner,outer,range)*range;
vec3 jewelColor = clamp(body*jTintColor.rgb,0.0,1.0)+max(emission,vec3(0));
`;

const jewelryCore = /* glsl */ `
mat3 frame = jewelFrame(normalize(vJewelNormal));
vec3 view = jewelView();
vec3 tangentNormal = jewelNormal(texture2D(jewelN,vJewelUV0*jJewel_N_Tiling).rg,jJewel_N_Flatness,frame);
vec3 normal = jewelFacingNormal(tangentNormal);
float facing = max(dot(view,normal),0.0);
float edge3 = pow(max(abs(1.0-facing),0.0001),3.0);
vec4 srma = texture2D(jewelO1,vJewelUV0);
vec2 secondUV = mix(vJewelUV0,vJewelUV1,jJewel_2UColor_UV);
secondUV = mix(secondUV,vJewelUV2,clamp(jJewel_2UColor_UV-1.0,0.0,1.0));
secondUV = mix(secondUV,vJewelUV3,clamp(jJewel_2UColor_UV-2.0,0.0,1.0));
vec4 secondSample = texture2D(jewelT,secondUV);
vec3 second = clamp(secondSample.rgb+vec3(jIsApplyingDIYColor),0.0,1.0);
vec4 bodySample = texture2D(jewelD,jewelUV(jJewel_D_UV)*vec2(jJewel_D_Tiling,jJewel_D_Tiling*jJewel_D_Tiling_Y));
vec3 body = bodySample.rgb*second;
// Native normal-view matcap; not a world-position gradient or diffuse/ORM.
vec3 matcap = texture2D(jewelO,vec2(normal.x,-normal.y)*0.5+0.5).rgb*jJewel_MatcapColor.rgb*body;
matcap *= 1.0-clamp(srma.g*jJewel_SRM_Adjust.g,0.0,1.0)*jJewel_RoughnessOnSpec;
vec3 fake = jewelCube(jewelC,-normalize(view+tangentNormal*(0.1+(jJewel_IOR-0.1)*edge3)),jewelScaleC);
fake *= body*jJewel_FakeBackGroundColorTint.rgb;
vec2 detailUV = vJewelUV0*jJewel_DetailMap_Tiling_Offset.xy+jJewel_DetailMap_Tiling_Offset.zw;
// The source's iterative parallax loop is omitted; its RGB input is retained.
vec3 detail = texture2D(jewelD1,detailUV).rgb*body*jJewel_DetailColorTint.rgb;
vec2 tangentView = vec2(dot(frame[0],view),dot(frame[1],view));
vec2 reflectUV = vJewelUV0*jJewel_ReflectNTiling-0.6*jJewel_ReflectNHeight*tangentView;
vec3 reflectionNormal = jewelNormal(texture2D(jewelN1,reflectUV).rg,0.0,frame);
vec3 reflected = reflect(-view,reflectionNormal);
vec3 refracted = -normalize(view+3.0*reflectionNormal);
vec3 hdr = jewelCube(jewelS,mix(reflected,refracted,jJewel_DiamondDistortion),jewelScaleS);
float hdrGray = dot(hdr,vec3(0.3,0.59,0.11));
hdr = mix(vec3(hdrGray),hdr,clamp(jJewel_HDR_Attributes.g,0.0,1.0));
hdr = jewelPowPositive(hdr,jJewel_HDR_Attributes.r);
vec3 axis = vec3(0.57735026919);
float angle = jJewel_HDR_Attributes.b*6.28318530718;
hdr = hdr*cos(angle)+cross(axis,hdr)*sin(angle)+axis*dot(axis,hdr)*(1.0-cos(angle));
hdr *= (0.1+0.9*edge3)*body*jJewel_HDRColorTint.rgb*mix(1.0,srma.a,jJewel_UseHDRMask_SRMA_A_);
float pseudoOpacity = min(1.0,max(clamp(srma.a+jJewel_UseHDRMask_SRMA_A_,0.0,1.0)*jJewel_Opacity,
  clamp(max(detail.r,max(detail.g,detail.b)),0.0,1.0)));
vec3 colour = mix(fake,hdr+detail+body*jJewel_D_Tint.rgb,pseudoOpacity)+matcap;
vec3 diy = (secondSample.rgb*jDIY_UserColor.rgb+vec3(jDIY_BaseColorBias))*jDIY_BaseColorScale;
colour = mix(colour,diy*mix(colour,vec3(dot(colour,vec3(0.3,0.59,0.11))),0.9),jIsApplyingDIYColor);
float emissionMask = clamp(srma.r+1.0-jJewel_UseEmissiveMask_SRMA_R_,0.0,1.0);
vec3 jewelColor = clamp(colour,0.0,1.0)+max(colour,vec3(0))*emissionMask*jJewel_Emissive;
`;

const pearlCore = /* glsl */ `
mat3 frame = jewelFrame(normalize(vJewelNormal));
vec3 normal = jewelNormal(texture2D(jewelN,vJewelUV0).rg,0.0,frame);
vec3 view = jewelView();
vec3 second = texture2D(jewelT,vJewelUV1*jBB_2U_Tiling_Offset.xy+jBB_2U_Tiling_Offset.zw).rgb;
vec4 bodySample = texture2D(jewelD,vJewelUV0);
vec3 body = bodySample.rgb*jBB_ColorTint.rgb;
body *= clamp(second+vec3(jIsApplyingDIYColor),0.0,1.0);
vec3 halfGray = mix(body,vec3(dot(body,vec3(0.3,0.59,0.11))),0.5);
vec3 edge = halfGray*jBB_EdgeLightTint.rgb*jewelEdge(normal,view,jBB_EdgelightRange);
vec3 hdr = jewelCube(jewelS,reflect(-view,normal),jewelScaleS);
hdr = jewelPowPositive(hdr,jBB_HDRAttributes.r);
hdr = mix(vec3(dot(hdr,vec3(0.3,0.59,0.11))),hdr,clamp(jBB_HDRAttributes.g,0.0,1.0));
vec3 axis = vec3(0.57735026919);
float angle = jBB_HDRAttributes.b*6.28318530718;
hdr = hdr*cos(angle)+cross(axis,hdr)*sin(angle)+axis*dot(axis,hdr)*(1.0-cos(angle));
hdr *= jBB_HDRColorTint.rgb*halfGray;
vec3 matcap = texture2D(jewelO,vec2(normal.x,-normal.y)*0.5+0.5).rgb;
matcap *= jBB_MatcapColorTint.rgb*halfGray;
vec3 colour = body+edge+hdr+matcap;
vec3 diy = (second*jDIY_UserColor.rgb+vec3(jDIY_BaseColorBias))*jDIY_BaseColorScale;
colour = mix(colour,diy*mix(colour,vec3(dot(colour,vec3(0.3,0.59,0.11))),0.9),jIsApplyingDIYColor);
vec3 base = clamp(colour*mix(vec3(1),jTargetBaseColor.rgb,jBaseColorAmount*jEnableEdgeGlow),0.0,1.0);
vec3 jewelColor = base+max(colour,vec3(0))*jBB_TotalEmissive;
`;

// cd8/06b/838 colour and c1/8b/a341 opacity share these RG coarse-march
// and G binary-refinement consumers. Gradients stay fixed at the original UV.
const opalParallax = /* glsl */ `
varying vec3 vJewelTangent;
varying float vJewelHandedness;
mat3 jewelNativeFrame() {
  return mat3(vJewelTangent, cross(vJewelNormal,vJewelTangent)*vJewelHandedness, vJewelNormal);
}
vec2 jewelOpalParallax(vec2 uv, vec3 view, mat3 frame) {
  vec3 tangentView = normalize(vec3(dot(frame[0],view),-dot(frame[1],view),dot(frame[2],view)));
  float z = abs(tangentView.z);
  // Native divisions are undefined at exact grazing and at a zero RG
  // denominator. Fail closed; do not invent an epsilon or replacement ray.
  if (!(z > 0.0)) discard;
  float fade = 1.0-z;
  fade *= fade;
  fade *= fade;
  fade *= fade;
  fade = 1.0-fade;
  vec3 ray = vec3(-jDepth*fade*tangentView.xy/z,1.0);
  float rayLength = length(ray.xy);
  if (isnan(rayLength) || isinf(rayLength)) discard;
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec3 march = vec3(uv,0.0);
  for (int i=0; i<8; i++) {
    vec2 rg = textureGrad(jewelD1,march.xy,dx,dy).rg;
    float denominator = rayLength+rg.r;
    if (!(denominator > 0.0)) discard;
    float stepSize = clamp(1.0-rg.g-march.z,0.0,1.0)*rg.r/denominator;
    march += ray*stepSize;
  }
  vec3 halfStep = ray*(march.z*0.5);
  vec3 point = vec3(uv,0.0)+halfStep;
  for (int i=0; i<8; i++) {
    float height = 1.0-textureGrad(jewelD1,point.xy,dx,dy).g;
    halfStep *= 0.5;
    point += point.z<height ? halfStep : -halfStep;
  }
  return point.xy;
}
`;

const opalCore = (opal: FurnitureJewel['opal']) => /* glsl */ `
mat3 frame = ${opal?.parallax ? 'jewelNativeFrame()' : 'jewelFrame(normalize(vJewelNormal))'};
vec3 view = jewelView();
float sourceFacing = dot(view,normalize(vJewelNormal));
float side = jDiffuse_Color_Bleed_Fresnel_Side;
float bleed = clamp(sourceFacing*clamp(side,0.0,1.0)+(1.0-sourceFacing)*clamp(-side,0.0,1.0)+jDiffuse_Color_Bleed_Fresnel_Offset,0.0,1.0);
vec3 normal = jewelNormal(texture2D(jewelN,vJewelUV0).rg,1.0-jTop_Layer_Normal_Intensity*bleed,frame);
vec2 uv = ${opal?.parallax ? 'jewelOpalParallax(vJewelUV0*jUV_Tile,view,frame)' : 'vJewelUV0*jUV_Tile'};
vec4 bodySample = texture2D(jewelD,uv);
vec3 emissiveSample = texture2D(jewelT,uv).rgb;
float pattern = texture2D(jewelB,vJewelUV0).r;
vec2 noiseUV = (vJewelUV0+(vec2(normalize(vJewelNormal).x,-normalize(vJewelNormal).y)+pattern)*jHolo_Distortion_Intensity)*jHolo_Pattern_Tiling;
float noise = texture2D(jewelC,noiseUV).r;
float breath = noise>=0.5 ? 1.0+jHolo_Mask_Edge_Softness*(noise*noise-1.0) : jHolo_Mask_Edge_Softness*noise*noise;
vec3 emission = mix(jBase_Emissive_Color.rgb,jewelPowPositive(emissiveSample,jEmissiveMapExp)*jEmissiveMapIntensity,breath);
vec4 orm = texture2D(jewelO,vJewelUV0);
${
	opal?.heightGradient
		? `
float heightRatio = clamp(vJewelObjectHeight/jMeshHeight,0.0,1.0);
float heightWeight = heightRatio>0.0 ? clamp(pow(heightRatio,jVertical_Gradient_Power)*jVertical_Gradient_Mult,0.0,1.0) : 0.0;
vec3 heightColour = mix(jGradient_Color_Low.rgb,jGradient_Color_High.rgb,heightWeight);`
		: 'vec3 heightColour = jGradient_Color_Low.rgb;'
}
emission = emission*heightColour+orm.a*jCurvature_Emissive_Color.rgb;
float emissiveMask = mix(jAO_Min,jAO_Max,orm.r);
emissiveMask = emissiveMask>0.0 ? pow(emissiveMask,jEmissive_Mask_Power) : 0.0;
emission *= emissiveMask*jEimssive_Overall_Intensity_Day*jHomeEmissiveToggle;
vec3 background = mix(jBase_Background_Color.rgb,bodySample.rgb,jBaseColor_Edge_Alpha);
vec3 base = mix(background,bodySample.rgb,emissiveSample.r);
base = mix(jBaseColor_Edge.rgb,base,bleed);
vec3 jewelColor = clamp(base,0.0,1.0)+max(emission,vec3(0));
`;

/** Captured material colour only: one ordinary pass, no scene refraction/OIT.
 * Shader chunk colour modulation remains after the native RGB core, preserving
 * the editor's instanceColor, picking and highlight hooks. Coverage channels
 * come from the actual shadow consumer; opaque RGB never acquires PNG coverage.
 */
export function createJewelMaterial(
	jewel: FurnitureJewel,
	textures: Partial<Record<string, Texture | null>>,
	maskedOptions?: JewelryMaskedMaterialOptions,
): MeshBasicMaterial {
	if ('preview' in jewel && !readFurnitureJewel(jewel)) throw new Error('[JewelryPreview] invalid declared lightweight preview');

	const simple = jewel.preview === 'jewelry-simple-1';
	if ('maskedSource' in jewel && !readFurnitureJewel(jewel)) throw new Error('[JewelryMasked] invalid declared opt-in; refusing legacy fallback');

	const masked = jewel.maskedSource
		? createJewelryMaskedShaderState(jewel.maskedSource, maskedOptions)
		: null;
	const owned: Texture[] = [];
	const sampling: Record<string, Texture> = {};

	const wrap = (value: string) =>
		value === 'TA_Clamp'
			? ClampToEdgeWrapping
			: value === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	for (const [role, contract] of Object.entries(jewel.textures)) {
		if (simple && !jewelrySimpleRoles.has(role)) continue;
		const source = textures[role];
		if (!source) throw new Error(`[ModelManager][Jewel] missing captured source role ${role}`);

		const texture = source.clone();
		texture.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = contract.cube ? RepeatWrapping : wrap(contract.addressX);
		texture.wrapT = contract.cube ? ClampToEdgeWrapping : wrap(contract.addressY);
		texture.generateMipmaps = contract.mipmaps;
		texture.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = contract.nearest
			? NearestFilter
			: contract.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		if (contract.cube) texture.flipY = false;
		texture.needsUpdate = true;
		sampling[role] = texture;
		owned.push(texture);
	}

	const material = new MeshBasicMaterial({
		transparent: false,
		opacity: 1,
		depthWrite: true,
		alphaTest: jewel.blend === 'masked' ? jewel.alphaCutoff : 0,
		forceSinglePass: true,
	});
	if (jewel.opal?.parallax) material.defines = { USE_TANGENT: '' };
	material.userData.jewel = jewel;
	if (masked) masked.configure(material);
	material.addEventListener('dispose', () => owned.forEach((texture) => texture.dispose()));

	const ready = { value: true };
	const uvWeights = Object.entries(jewel.colors)
		.filter(([key]) => ['Jewel_D_UV', 'EmissiveSelectUV'].includes(key))
		.map(([, value]) => value);
	material.onBeforeRender = (_renderer, _scene, _camera, geometry, object, group) => {
		if (masked) masked.bind(_renderer, _scene, _camera, geometry, object, group);
		if (jewel.opal) {
			const transport = geometry.userData.ueJewelPrimitiveProof;
			const ranges = transport?.drawRanges;
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
					? {
						start: candidate.start,
						count: candidate.count,
						materialIndex: candidate.materialIndex,
					}
					: undefined;
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
			const vertexStart = range?.vertexStart ?? 0;
			const vertexCount = range?.vertexCount ?? count;
			if (
				!Number.isInteger(count) ||
				!count ||
				!proof ||
				proof.contract !== jewel.opal.geometry ||
				proof.sourceNativeIndex !== '_UE_VERTEX_INDEX' ||
				proof.positionMatched !== true ||
				proof.uv0Matched !== true ||
				proof.mismatches !== 0 ||
				proof.verifiedVertexCount !== vertexCount ||
				!Number.isInteger(vertexStart) ||
				!Number.isInteger(vertexCount) ||
				vertexStart < 0 ||
				!vertexCount ||
				vertexStart + vertexCount > count ||
				proof.heightSpace !== 'native-position-z-cm-source-bind-pose' ||
				('isSkinnedMesh' in object && object.isSkinnedMesh)
			) throw new Error('[ModelManager][Jewel] Opal requires complete original native primitive/UV/coordinate proof');
			if (
				jewel.opal.parallax &&
				(proof.basisMatched !== true ||
					geometry.getAttribute('tangent')?.itemSize !== 4 ||
					geometry.getAttribute('tangent')?.count !== count)
			) throw new Error('[ModelManager][Jewel] Opal POM requires native tangent and handedness');

			const height = geometry.getAttribute('_jewel_object_height');
			if (
				jewel.opal.heightGradient &&
				(proof.primitiveLocalHeightMatched !== true ||
					!height ||
					height.itemSize !== 1 ||
					height.count !== count ||
					height.normalized ||
					!(height.array instanceof Float32Array) ||
					!height.array.subarray(vertexStart, vertexStart + vertexCount).every(Number.isFinite))
			) throw new Error('[ModelManager][Jewel] Opal gradient requires native primitive-local height');
		}

		ready.value = jewel.requiredUv.every((channel) => !!geometry.getAttribute(channel === 0 ? 'uv' : `uv${channel}`));
		ready.value =
			ready.value &&
			!!geometry.getAttribute('uv') &&
			uvWeights.every((weights) => weights.every((weight, index) => weight === 0 || !!geometry.getAttribute(index === 0 ? 'uv' : `uv${index}`)),
			);
		if (jewel.family === 'jewelry-matcap') {
			const selected = jewel.scalars.Jewel_2UColor_UV ?? 0;
			for (let index = 1; index <= Math.min(3, Math.ceil(selected)); index++) {
				if (!geometry.getAttribute(`uv${index}`)) ready.value = false;
			}
		}

		if (jewel.family === 'pearl-matcap' && !geometry.getAttribute('uv1')) ready.value = false;
	};
	material.customProgramCacheKey = () =>
		simple
			? `jewelry-simple-1:${JSON.stringify([...jewelrySimpleRoles].filter((role) => jewel.textures[role]?.bc5ZeroB).sort())}`
			: masked
				? masked.programKey
				: `jewel-native-3:${JSON.stringify([
					jewel.family,
					jewel.alphaMode,
					!!jewel.emissionOnly,
					!!jewel.rgbReflection,
					!!jewel.diffuseRefract,
					jewel.opal,
					Object.keys(jewel.textures)
						.filter((role) => jewel.textures[role]?.bc5ZeroB)
						.sort(),
				])}`;
	material.onBeforeCompile = (shader) => {
		shader.uniforms.jewelCoordinatesReady = ready;
		shader.uniforms.jewelFaceNormal = { value: !!jewel.faceNormal };

		let uniforms = '';
		const opalDeclarations = `${jewel.opal?.parallax ? 'varying vec3 vJewelTangent;\nvarying float vJewelHandedness;\n' : ''}${jewel.opal?.heightGradient ? 'varying float vJewelObjectHeight;\n' : ''}`;
		for (const [key, value] of Object.entries(jewel.scalars)) {
			const name = parameterName(key);
			shader.uniforms[name] = { value };
			uniforms += `uniform float ${name};\n`;
		}

		for (const [key, value] of Object.entries(jewel.colors)) {
			const name = parameterName(key);
			shader.uniforms[name] = { value: new Vector4(...value) };
			uniforms += `uniform vec4 ${name};\n`;
		}

		for (const [role, texture] of Object.entries(sampling)) {
			shader.uniforms[`jewel${role}`] = { value: texture };
			shader.uniforms[`jewelScale${role}`] = { value: jewel.textures[role]!.rgbScale };
			uniforms += `uniform sampler2D jewel${role};\nuniform float jewelScale${role};\n`;
			if (jewel.textures[role]?.bc5ZeroB) {
				uniforms += `vec4 jewelSample${role}(vec2 uv) { vec4 pixel=texture2D(jewel${role},uv); pixel.b=0.0; return pixel; }\n`;
				if (masked)
					uniforms += `vec4 jewelSample${role}(vec2 uv,float bias) { vec4 pixel=texture2D(jewel${role},uv,bias); pixel.b=0.0; return pixel; }\n`;
			}
		}

		shader.vertexShader =
		/* glsl */ `
varying vec3 vJewelPosition;
varying vec3 vJewelNormal;
varying vec2 vJewelUV0;
varying vec2 vJewelUV1;
varying vec2 vJewelUV2;
varying vec2 vJewelUV3;
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
			opalDeclarations +
			(jewel.opal?.heightGradient ? 'attribute float _jewel_object_height;\n' : '') +
			shader.vertexShader
				.replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
				.replace(
					'#include <project_vertex>',
					`#include <project_vertex>
vJewelPosition = mvPosition.xyz;
vJewelNormal = normalize(transformedNormal);
vJewelUV0 = uv; vJewelUV1 = uv1; vJewelUV2 = uv2; vJewelUV3 = uv3;
${
	jewel.opal?.parallax
		? `
float jewelFrameParity = sign(determinant(mat3(modelMatrix)));
#ifdef USE_INSTANCING
jewelFrameParity *= sign(determinant(mat3(instanceMatrix)));
#endif
vJewelTangent = normalize(transformedTangent);
vJewelHandedness = tangent.w*jewelFrameParity;`
		: ''
}
${jewel.opal?.heightGradient ? 'vJewelObjectHeight = _jewel_object_height;' : ''}`,
				);
		if (masked) {
			Object.assign(shader.uniforms, masked.uniforms);
			shader.vertexShader =
				masked.vertexDeclarations +
				shader.vertexShader.replace(
					'#include <project_vertex>',
					`${masked.vertexBeforeProjectBody}\n#include <project_vertex>\n${masked.vertexBody}`,
				);
		}

		let core = classicCore(!!jewel.emissionOnly);
		switch (jewel.family) {
		case 'blue-crystal':
			core = blueCore(!!jewel.rgbReflection, !!jewel.diffuseRefract);
			break;
		case 'opaque-crystal':
			core = opaqueCore(false);
			break;
		case 'opaque-crystal-cube':
			core = opaqueCore(true);
			break;
		case 'jewelry-matcap':
			core = simple ? jewelrySimpleColorCore : masked ? jewelryMaskedColorCore : jewelryCore;
			break;
		case 'pearl-matcap':
			core = pearlCore;
			break;
		case 'opal':
			core = opalCore(jewel.opal);
			break;
		}

		for (const [role, contract] of Object.entries(jewel.textures)) {
			if (contract.bc5ZeroB)
				core = core.split(`texture2D(jewel${role},`).join(`jewelSample${role}(`);
		}

		let alpha = '1.0';
		switch (jewel.alphaMode) {
		case 'diffuse-a':
			alpha = '1.0+jUseAlphaMask*(body.a-1.0)';
			break;
		case 'diffuse-r':
			alpha = '1.0+jUseAlphaMask*(body.r-1.0)';
			break;
		case 'jewelry-r-a':
			alpha = masked
				? 'bodySample.a*clamp(secondSample.r+step(maskedMaterial[38].w,0.5),0.0,1.0)'
				: 'bodySample.a*clamp(secondSample.r+step(jJewel_2UColor_A_Usage,0.5),0.0,1.0)';
			break;
			// edbafb: real pre-dither coverage, not the diffuse PNG alone.
		case 'pearl-a-circle':
			alpha = 'bodySample.a*clamp((1.0-length(vJewelUV0-vec2(0.5))*2.222222)*100000.0,0.0,1.0)';
			break;
		case 'opal-a':
			alpha = 'bodySample.a';
			break;
		}

		shader.fragmentShader =
			uniforms +
			sharedFragment +
			(masked ? jewelryMaskedFragmentDeclarations : '') +
			(jewel.opal?.parallax ? opalParallax : '') +
			(jewel.opal?.heightGradient ? 'varying float vJewelObjectHeight;\n' : '') +
			shader.fragmentShader;
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <map_fragment>',
			`
if (!jewelCoordinatesReady) discard;
${core}
diffuseColor.rgb *= jewelColor;
diffuseColor.a = clamp(${alpha},0.0,1.0);`,
		);
	};
	return material;
}
