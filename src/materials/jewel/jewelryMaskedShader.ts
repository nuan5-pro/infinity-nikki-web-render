import {
	InstancedMesh,
	Matrix3,
	Matrix4,
	Vector3,
	Vector4,
	type BufferGeometry,
	type Camera,
	type MeshBasicMaterial,
	type Object3D,
	type Scene,
	type Texture,
	type WebGLRenderer,
} from 'three';
import {
	jewelryMaskedActiveKernelsGLSL,
	jewelryMaskedLocalVertexShader,
	jewelryMaskedPixelShader,
	jewelryMaskedPreshader,
	type MaskedVec3,
	type MaskedVec4,
} from './jewelryMaskedSource.js';
import {
	assertJewelryMaskedNativeTextureCapability,
	assertJewelryMaskedTextureBinding,
	type JewelryMaskedNativeResource,
} from './jewelryMaskedResources.js';
import type { JewelryMaskedPreviewDrawProof } from './jewelryMaskedPreview.js';
import type { FurnitureRawReference } from '../../furniture/types.js';

export const JEWELRY_MASKED_TEXTURE_ROLES = [
	'N',
	'O1',
	'O',
	'T',
	'D',
	'D1',
	'N1',
	'C',
	'S',
] as const;

export type JewelryMaskedTextureRole = (typeof JEWELRY_MASKED_TEXTURE_ROLES)[number];

export interface JewelryMaskedSourceContract {
	version: 1
	contract: 'jewelry-v2-masked-de3c-local430-static-v1'
	pixelShader: string
	vertexShader: string
	opacityShader: string
	preshaderContract: string
	materialLayoutHash: number
	sourceContractSha256: string
	geometryCaptureSha256: string
	runtimeProofSha256: string
	sourceModelSha256: string
	previewFrameSha256: string
	componentBoundsCaptureSha256: string
	nativeTextureBindings: Record<JewelryMaskedTextureRole, string>
	/** Complete native/preshader register recipe, not guessed missing parameters. */
	materialCB: MaskedVec4[]
	domain: {
		kind: 'editor-linked-mpc-tod-defaults'
		collectionStateId: '73C1D5ED-4B7AE2FA-DA3C9D83-4F8F468D'
		collectionCaptureSha256: string
		viewDefaultsSourceSha256: string
		aaMethod: 0
		ready: 0
		globalAttributeFactor: 1
		swapLightFactor: 1
		materialTextureMipBias: 0
		normalOverride: MaskedVec4
		implicitNoisePackageSha256: string
		clock: 'editor-monotonic-seconds-not-live-UE'
		primitivePositionDomain: 'source-defined-tile-offset-preview-not-live-CVar'
	}
}

export interface JewelryMaskedDrawInput {
	renderer: WebGLRenderer
	scene: Scene
	camera: Camera
	geometry: BufferGeometry
	object: Object3D
	/** Current validated original draw scope, never inferred from an aggregate bbox/material name. */
	proof: JewelryMaskedPreviewDrawProof
}

export interface JewelryMaskedPreviewInputs {
	clockDomain: 'editor-monotonic-seconds-not-live-UE'
	editorTimeSeconds: number
	/** Actual selected DirectionalLight, mapped into the same view frame as TBN. */
	lightDirectionView: MaskedVec3
	lightLinearColorIntensity: MaskedVec3
	/** Native camera/ObjectWorldPosition bounds-centre/cb136/cb36 equation. */
	sourceDistanceBlend: number
	distanceDomain: 'source-projection-and-primitive-origin-validated'
	/** Verified editor-view → native-world direction frame: native View rows16..18, not actor/local basis. */
	viewToSourceWorldDirection: readonly number[]
	/** Uniform distance is valid for an instanced draw only when every instance is independently proved equal. */
	instanceDistanceBlends?: readonly number[]
}

export interface JewelryMaskedTextureBinding {
	texture: Texture
	resource: JewelryMaskedNativeResource
}

export interface JewelryMaskedMaterialOptions {
	resolvePreview: (input: JewelryMaskedDrawInput) => JewelryMaskedPreviewInputs
	nativeTextures: {
		bindings: Record<JewelryMaskedTextureRole, JewelryMaskedTextureBinding>
		/** Same source t9; separate original s6 sampling node, not the detail RGB s0 object. */
		detailHeight: JewelryMaskedTextureBinding
		samplerDomain: 'explicit-editor-linear-trilinear-not-live-RHI'
	}
}

const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const finite4 = (value: unknown): value is MaskedVec4 =>
	Array.isArray(value) &&
	value.length === 4 &&
	value.every((item) => typeof item === 'number' && Number.isFinite(item) && Number.isFinite(Math.fround(item)));

const record = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const nonnegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

const sameRange = (left: FurnitureRawReference, right: FurnitureRawReference | undefined) =>
	!!right &&
	left.resource === right.resource &&
	left.byteOffset === right.byteOffset &&
	left.byteLength === right.byteLength;

export function readJewelryMaskedSourceContract(value: unknown): JewelryMaskedSourceContract | null {
	if (!value || typeof value !== 'object') return null;

	const data = value as JewelryMaskedSourceContract;
	const domain = data.domain;
	if (
		data.version !== 1 ||
		data.contract !== 'jewelry-v2-masked-de3c-local430-static-v1' ||
		data.pixelShader !== jewelryMaskedPixelShader ||
		data.vertexShader !== jewelryMaskedLocalVertexShader ||
		data.opacityShader !== 'cfcd63ed610888ccf8acbba69d9115e7de7f9d3e' ||
		data.preshaderContract !== jewelryMaskedPreshader ||
		data.materialLayoutHash !== 56953856 ||
		![
			data.sourceContractSha256,
			data.geometryCaptureSha256,
			data.runtimeProofSha256,
			data.previewFrameSha256,
			data.componentBoundsCaptureSha256,
		].every(sha256) ||
		!data.nativeTextureBindings ||
		!JEWELRY_MASKED_TEXTURE_ROLES.every(
			(role) =>
				typeof data.nativeTextureBindings[role] === 'string' &&
				/^\/Game\/.+\.[^/]+$/.test(data.nativeTextureBindings[role]),
		) ||
		!Array.isArray(data.materialCB) ||
		data.materialCB.length !== 40 ||
		!data.materialCB.every(finite4) ||
		!domain ||
		domain.kind !== 'editor-linked-mpc-tod-defaults' ||
		domain.collectionStateId !== '73C1D5ED-4B7AE2FA-DA3C9D83-4F8F468D' ||
		![domain.viewDefaultsSourceSha256].every(sha256) ||
		domain.aaMethod !== 0 ||
		domain.ready !== 0 ||
		domain.globalAttributeFactor !== 1 ||
		domain.swapLightFactor !== 1 ||
		domain.materialTextureMipBias !== 0 ||
		domain.implicitNoisePackageSha256 !==
			'a1fd94076f62af28f8f986ada8239646039a0a4e3356bc4b66483dc10ced798a' ||
		domain.clock !== 'editor-monotonic-seconds-not-live-UE' ||
		domain.primitivePositionDomain !== 'source-defined-tile-offset-preview-not-live-CVar' ||
		!finite4(domain.normalOverride) ||
		domain.normalOverride.some((item, i) => item !== (i === 3 ? 1 : 0))
	) return null;
	// Static source dissolve domain: PS593-603 and657-662 reduce to one only
	// with normalized noise and this exact width/softness recipe. Unknown domains fence.
	const m = data.materialCB;
	if (
		m[25]![3] !== 0 ||
		m[27]![1] !== 0 ||
		m[27]![3] !== 0 ||
		m[28]![0] !== 0 ||
		m[28]![2] !== Math.fround(-0.01) ||
		m[28]![3] !== 0 ||
		m[29]![0] !== Math.fround(-0.01) ||
		m[32]![1] !== 0 ||
		m[38]![2] !== 0
	) return null;

	return data;
}

export const jewelryMaskedFragmentDeclarations = /* glsl */ `
uniform vec4 maskedMaterial[40];
uniform vec4 maskedNormalOverride;
uniform vec3 maskedLightDirectionView;
uniform vec3 maskedLightColor;
uniform float maskedEditorTime;
uniform float maskedDistanceBlend;
uniform float maskedMipBias;
uniform samplerCube maskedCubeC;
uniform samplerCube maskedCubeS;
uniform sampler2D maskedHeightTexture;
uniform mat3 maskedViewToSourceWorldDirection;
centroid varying vec3 vMaskedTangent;
centroid varying vec3 vMaskedNormal;
centroid varying float vMaskedHandedness;
varying vec3 vMaskedLocalCM;
${jewelryMaskedActiveKernelsGLSL.split('textureGrad(jewelD1,').join('textureGrad(maskedHeightTexture,')}
vec3 maskedSurfaceRG(vec2 rg, float flatten, mat3 frame) {
  vec2 xy=rg*2.0-1.0;
  vec3 local=mix(vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0))),vec3(0.0,0.0,1.0),flatten);
  local=normalize(local*maskedNormalOverride.w+maskedNormalOverride.xyz);
  return normalize(frame*local);
}
float maskedPositivePow(float value, float power) { return value>0.0?exp2(log2(value)*power):0.0; }
vec3 maskedPositivePow3(vec3 value, float power) {
  return vec3(maskedPositivePow(value.x,power),maskedPositivePow(value.y,power),maskedPositivePow(value.z,power));
}
`;

/** Native colour/material/emission boundary, not a replacement for UE's GBuffer lighting. */
export const jewelryMaskedColorCore = /* glsl */ `
// PS78-81 reconstruct B AFTER centroid interpolation of T/Z/handedness.
// Interpolating a per-vertex B is not equivalent for varying native SNORM bases.
mat3 frame=mat3(vMaskedTangent,cross(vMaskedNormal,vMaskedTangent)*vMaskedHandedness,vMaskedNormal);
vec3 view=jewelView();
vec3 normal=maskedSurfaceRG(texture2D(jewelN,vJewelUV0*maskedMaterial[0].y,-1.0).rg,maskedMaterial[0].z,frame);
vec4 srma=texture2D(jewelO1,vJewelUV0,maskedMipBias);
float noL=clamp(dot(normal,maskedLightDirectionView),0.0,1.0);
float emissionMask=clamp(srma.r+maskedMaterial[0].w,0.0,1.0);
float emissionFactor=emissionMask*mix(maskedMaterial[1].y,maskedMaterial[1].x,noL);
vec3 lightColor=max(maskedLightColor,vec3(0.12));
vec3 emissionLighting=clamp(mix(lightColor,vec3(dot(lightColor,vec3(0.3,0.59,0.11))),0.7)+maskedMaterial[1].z,0.0,1.0)*emissionFactor;
float facing=max(dot(normal,view),0.0), edgeBase=max(abs(1.0-facing),0.0001);
float edge3=edgeBase*edgeBase*edgeBase;
vec3 reflectedMain=2.0*normal*dot(normal,view)-view;
vec3 strip=maskedPositivePow(1.0-abs(dot(reflectedMain,normalize(maskedLightDirectionView+0.01))),maskedMaterial[1].w)*maskedMaterial[2].rgb;
vec3 edge=maskedPositivePow(edgeBase,maskedMaterial[2].w)*maskedMaterial[3].rgb;
float halfCos=clamp(dot(normalize(view+maskedLightDirectionView),normal),0.0,1.0);
vec4 glintAttributes=vec4(maskedMaterial[5].x,srma.b*maskedMaterial[4].z*maskedMaterial[4].w,maskedMaterial[5].yz);
glintAttributes*=mix(vec4(1.0),maskedMaterial[6],maskedDistanceBlend);
vec3 lobes=jewelryMaskedGlintLobes(vMaskedLocalCM,glintAttributes,maskedEditorTime,emissionFactor);
// Static exact MPC default AAMethod0: AA5's shadow operand is unconsumed.
// All source AA equations remain in the helper; other domains are not admitted here.
float glint=jewelryMaskedGlintAA(dot(lobes,lobes),maskedDistanceBlend,maskedMaterial[7].x,0,0.0,
  1.0,1.0,maskedMaterial[7].yz,maskedMaterial[7].w,maskedMaterial[8].x,maskedMaterial[8].y);
vec2 secondUV=mix(vJewelUV0,vJewelUV1,maskedMaterial[10].w);
secondUV=mix(secondUV,vJewelUV2,maskedMaterial[11].x);
secondUV=mix(secondUV,vJewelUV3,maskedMaterial[11].y);
vec4 secondSample=texture2D(jewelT,secondUV,maskedMipBias);
vec3 second=clamp(secondSample.rgb+maskedMaterial[11].z,0.0,1.0);
vec2 bodyUV=vJewelUV0*maskedMaterial[11].w+vJewelUV1*maskedMaterial[12].x+
  vJewelUV2*maskedMaterial[12].y+vJewelUV3*maskedMaterial[12].z;
vec4 bodySample=texture2D(jewelD,bodyUV*maskedMaterial[13].xy);
vec3 body=bodySample.rgb*second;
vec3 matcap=texture2D(jewelO,vec2(normal.x,-normal.y)*0.5+0.5,maskedMipBias).rgb*maskedMaterial[10].rgb;
vec3 specular=(strip+edge+glint*maskedMaterial[9].rgb*min(facing,1.0)*mix(1.0,halfCos*halfCos,maskedMaterial[3].w)+matcap)*body;
specular*=1.0-clamp(srma.g*maskedMaterial[4].y,0.0,1.0)*maskedMaterial[13].z;
vec3 fake=textureCube(maskedCubeC,maskedViewToSourceWorldDirection*(-normalize(view+normal*(0.1+(maskedMaterial[13].w-0.1)*edge3)))).rgb*body*maskedMaterial[14].rgb;
vec2 detailUV=vJewelUV0*maskedMaterial[15].xy+maskedMaterial[15].zw;
vec3 tangentView=vec3(dot(frame[0],view),dot(frame[1],view),dot(frame[2],view));
// Exact index5 normalized PF_G8 proof reduces the entire jitter expression to
// zero for every uint remainder0..4 and sampled R0..1; no substitute texture.
detailUV=jewelryMaskedPOM(detailUV,tangentView,maskedMaterial[16].x,0.0,0.0,dFdx(detailUV),dFdy(detailUV));
vec3 detail=texture2D(jewelD1,detailUV).rgb*body*maskedMaterial[16].yzw;
vec2 reflectUV=vJewelUV0*maskedMaterial[18].x+(-0.5-0.1)*maskedMaterial[18].y*tangentView.xy;
vec3 reflectionNormal=jewelryMaskedReflectionRG(texture2D(jewelN1,reflectUV,-1.0).rg,frame);
// Do NOT normalize this composite before reflect (PS457-465).
vec3 reflected=2.0*reflectionNormal*dot(reflectionNormal,view)-view;
vec3 refracted=-normalize(view+3.0*reflectionNormal);
vec3 hdr=textureCube(maskedCubeS,maskedViewToSourceWorldDirection*mix(reflected,refracted,maskedMaterial[18].z)).rgb;
hdr=mix(hdr,vec3(dot(hdr,vec3(0.3,0.59,0.11))),maskedMaterial[18].w);
hdr=maskedPositivePow3(hdr,maskedMaterial[19].x);
vec3 axis=vec3(uintBitsToFloat(0x3f13cd3au));
float projected=dot(axis,hdr)*axis.x;
vec3 plane=hdr-projected;
hdr=plane*cos(maskedMaterial[17].w)+cross(axis,plane)*sin(maskedMaterial[17].w)+projected;
hdr*=(0.1+0.9*edge3)*body*maskedMaterial[17].rgb;
hdr*=mix(1.0,srma.a,maskedMaterial[19].y);
hdr*=mix(maskedMaterial[19].z,1.0,noL);
float pseudoOpacity=min(1.0,max(clamp(srma.a+maskedMaterial[19].y,0.0,1.0)*maskedMaterial[20].w,
  clamp(max(detail.r,max(detail.g,detail.b)),0.0,1.0)));
vec3 colour=mix(fake,hdr+detail+body*maskedMaterial[20].rgb,pseudoOpacity)+specular;
vec3 diy=(secondSample.rgb*maskedMaterial[21].rgb+maskedMaterial[21].w)*maskedMaterial[22].x;
colour=mix(colour,diy*mix(colour,vec3(dot(colour,vec3(0.3,0.59,0.11))),0.9),maskedMaterial[11].z);
// Actual MPC default Global_Attributes_Factor1; CB23's shuffle is x,w,y,z.
colour=mix(colour,vec3(dot(colour,vec3(0.3,0.59,0.11))),1.0-maskedMaterial[23].x);
colour=maskedPositivePow3(colour*maskedMaterial[23].y,maskedMaterial[23].z);
vec3 jewelColor=clamp(colour,0.0,1.0)+max(colour*emissionLighting,vec3(0.0));
`;

export function createJewelryMaskedShaderState(source: JewelryMaskedSourceContract, options?: JewelryMaskedMaterialOptions) {
	if (!readJewelryMaskedSourceContract(source)) throw new Error('[JewelryMasked] unproved exact source/runtime contract');
	if (
		!options?.nativeTextures ||
		options.nativeTextures.samplerDomain !== 'explicit-editor-linear-trilinear-not-live-RHI'
	) throw new Error('[JewelryMasked] explicit original native mip/sampler provider missing');

	const addressDomain = (role: JewelryMaskedTextureRole) =>
		['N', 'D', 'D1', 'N1', 'S'].includes(role)
			? ('explicit-editor-wrap' as const)
			: ('asset-header' as const);

	for (const role of JEWELRY_MASKED_TEXTURE_ROLES) {
		const binding = options.nativeTextures.bindings[role];
		if (
			!binding ||
			binding.resource.sourcePath !== source.nativeTextureBindings[role] ||
			binding.resource.type !== (role === 'C' || role === 'S' ? 'TextureCube' : 'Texture2D')
		) throw new Error(`[JewelryMasked] exact native source binding missing ${role}`);

		assertJewelryMaskedTextureBinding(binding.texture, binding.resource, addressDomain(role));
	}

	const height = options.nativeTextures.detailHeight;
	const detail = options.nativeTextures.bindings.D1;
	if (
		!height ||
		height.texture === detail.texture ||
		height.resource.type !== 'Texture2D' ||
		height.resource.sourcePath !== source.nativeTextureBindings.D1 ||
		!sameRange(height.resource.package, detail.resource.package) ||
		height.resource.mipChain.length !== detail.resource.mipChain.length ||
		height.resource.mipChain.some((mip, index) => !sameRange(mip.native, detail.resource.mipChain[index]?.native))
	) throw new Error('[JewelryMasked] original t9 height s6 and RGB s0 require separate explicit samplers');

	assertJewelryMaskedTextureBinding(height.texture, height.resource, 'asset-header');

	const uniforms = {
		maskedMaterial: { value: source.materialCB.map((value) => new Vector4(...value)) },
		maskedNormalOverride: { value: new Vector4(...source.domain.normalOverride) },
		maskedLightDirectionView: { value: new Vector3() },
		maskedLightColor: { value: new Vector3() },
		maskedEditorTime: { value: Number.NaN },
		maskedDistanceBlend: { value: Number.NaN },
		maskedMipBias: { value: source.domain.materialTextureMipBias },
		maskedSourceToGeometry: { value: new Matrix3() },
		maskedSourceCMToGeometry: { value: new Matrix4() },
		maskedViewToSourceWorldDirection: { value: new Matrix3() },
		maskedCubeC: { value: options.nativeTextures.bindings.C.texture },
		maskedCubeS: { value: options.nativeTextures.bindings.S.texture },
		maskedHeightTexture: { value: height.texture },
		...Object.fromEntries(
			JEWELRY_MASKED_TEXTURE_ROLES.filter((role) => role !== 'C' && role !== 'S').map((role) => [
				`jewel${role}`,
				{ value: options.nativeTextures.bindings[role].texture },
			]),
		),
	};

	const bind = (renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: unknown) => {
		if (!options) throw new Error('[JewelryMasked] explicit actual preview provider missing; no runtime defaults');

		for (const role of JEWELRY_MASKED_TEXTURE_ROLES) {
			const binding = options.nativeTextures.bindings[role];
			assertJewelryMaskedNativeTextureCapability(renderer, binding.resource);
			assertJewelryMaskedTextureBinding(binding.texture, binding.resource, addressDomain(role));
		}

		assertJewelryMaskedTextureBinding(height.texture, height.resource, 'asset-header');
		if ('isSkinnedMesh' in object && object.isSkinnedMesh) throw new Error('[JewelryMasked] LocalVF source requires a static mesh');

		const count = geometry.getAttribute('position')?.count;
		const candidate = record(group);
		const validGroup =
			candidate &&
			nonnegativeInteger(candidate.start) &&
			nonnegativeInteger(candidate.count) &&
			nonnegativeInteger(candidate.materialIndex)
				? { start: candidate.start, count: candidate.count, materialIndex: candidate.materialIndex }
				: null;
		const transport = record(geometry.userData.ueJewelryMaskedProof);
		const ranges = transport?.drawRanges;
		const range = Array.isArray(ranges)
			? ranges
				.map(record)
				.find(
					(entry) =>
						entry &&
							validGroup &&
							entry.start === validGroup.start &&
							entry.count === validGroup.count &&
							entry.materialIndex === validGroup.materialIndex,
				)
			: undefined;
		const proof = Array.isArray(ranges) ? record(range?.proof) : transport;
		if (
			!proof ||
			!count ||
			proof.contract !== source.contract ||
			(source.sourceModelSha256 !== undefined &&
				proof.sourceModelSha256 !== source.sourceModelSha256) ||
			proof.geometryCaptureSha256 !== source.geometryCaptureSha256 ||
			proof.positionMatched !== true ||
			proof.uvMatched !== true ||
			proof.packedBasisMatched !== true ||
			proof.localCMMatched !== true ||
			proof.mismatches !== 0 ||
			proof.beforeBake !== true ||
			proof.runtimeAdmitted !== true ||
			proof.sourceContractSha256 !== source.sourceContractSha256 ||
			proof.runtimeProofSha256 !== source.runtimeProofSha256 ||
			proof.proofScope !== 'original-static-section-before-bake' ||
			proof.pixelShader !== source.pixelShader ||
			proof.vertexShader !== source.vertexShader
		) throw new Error('[JewelryMasked] source primitive/typed/static frame proof missing');

		const vertexStart = range ? range.vertexStart : 0;
		const vertexCount = range ? range.vertexCount : count;
		if (
			!nonnegativeInteger(vertexStart) ||
			!nonnegativeInteger(vertexCount) ||
			vertexCount === 0 ||
			vertexStart + vertexCount > count ||
			proof.verifiedVertexCount !== vertexCount ||
			!nonnegativeInteger(proof.proofIndex) ||
			proof.proofIndex === 0
		) throw new Error('[JewelryMasked] source proof/count/scoped vertex range mismatch');

		for (const [name, size, type] of [
			['jewelryNativePackedBasis', 2, Uint32Array],
			['jewelryNativeLocalCM', 3, Float32Array],
			['jewelryNativeSourceIndex', 1, Uint32Array],
			['jewelryNativeProofIndex', 1, Uint32Array],
		] as const) {
			const attribute = geometry.getAttribute(name);
			if (
				!attribute ||
				attribute.itemSize !== size ||
				attribute.count !== count ||
				attribute.normalized ||
				!(attribute.array instanceof type)
			) throw new Error(`[JewelryMasked] exact typed carrier missing ${name}`);
		}

		const index = geometry.getIndex();
		const drawStart = validGroup?.start ?? geometry.drawRange.start;
		const drawCount = validGroup?.count ?? index?.count ?? count;
		if (
			!nonnegativeInteger(drawStart) ||
			!nonnegativeInteger(drawCount) ||
			drawCount === 0 ||
			drawCount % 3 !== 0 ||
			drawStart + drawCount > (index?.count ?? count)
		) throw new Error('[JewelryMasked] invalid source triangle drawrange');

		const proofIndex = geometry.getAttribute('jewelryNativeProofIndex');
		const localCM = geometry.getAttribute('jewelryNativeLocalCM');
		for (let i = drawStart; i < drawStart + drawCount; i++) {
			const vertex = index ? index.getX(i) : i;
			if (
				vertex < vertexStart ||
				vertex >= vertexStart + vertexCount ||
				proofIndex.getX(vertex) !== proof.proofIndex ||
				![localCM.getX(vertex), localCM.getY(vertex), localCM.getZ(vertex)].every(Number.isFinite)
			) throw new Error('[JewelryMasked] draw crosses original source scope or uses padded carrier');
		}

		const frame: unknown = proof.sourceToGeometry;
		if (
			!Array.isArray(frame) ||
			frame.length !== 9 ||
			!frame.every((value) => typeof value === 'number' && Number.isFinite(value))
		) throw new Error('[JewelryMasked] sourceToGeometry missing; no identity substitute');

		uniforms.maskedSourceToGeometry.value.fromArray(frame);
		if (uniforms.maskedSourceToGeometry.value.determinant() === 0) throw new Error('[JewelryMasked] singular sourceToGeometry');

		const cmFrame: unknown = proof.sourceCMToGeometry;
		if (
			!Array.isArray(cmFrame) ||
			cmFrame.length !== 16 ||
			!cmFrame.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
			cmFrame[3] !== 0 ||
			cmFrame[7] !== 0 ||
			cmFrame[11] !== 0 ||
			cmFrame[15] !== 1
		) throw new Error('[JewelryMasked] full native-local CM beforeBake frame missing; no position substitute');

		uniforms.maskedSourceCMToGeometry.value.fromArray(cmFrame);
		if (
			!Number.isFinite(uniforms.maskedSourceCMToGeometry.value.determinant()) ||
			uniforms.maskedSourceCMToGeometry.value.determinant() === 0
		) throw new Error('[JewelryMasked] singular full native-local CM frame');
		if (
			!object.matrixWorld.elements.every(Number.isFinite) ||
			object.matrixWorld.determinant() === 0 ||
			!camera.matrixWorld.elements.every(Number.isFinite) ||
			camera.matrixWorld.determinant() === 0
		) throw new Error('[JewelryMasked] singular/nonfinite actual object or camera frame');

		if (object instanceof InstancedMesh) {
			const instance = new Matrix4();
			for (let i = 0; i < object.count; i++) {
				object.getMatrixAt(i, instance);
				if (!instance.elements.every(Number.isFinite) || instance.determinant() === 0) throw new Error('[JewelryMasked] singular/nonfinite actual instance frame');
			}
		}

		const runtime = options.resolvePreview({
			renderer,
			scene,
			camera,
			geometry,
			object,
			proof: {
				runtimeProofSha256: source.runtimeProofSha256,
				sourceModelSha256: source.sourceModelSha256,
				geometryCaptureSha256: source.geometryCaptureSha256,
				beforeBake: true,
				sourceCMToGeometry: [...cmFrame],
			},
		});
		if (
			runtime.clockDomain !== source.domain.clock ||
			runtime.distanceDomain !== 'source-projection-and-primitive-origin-validated' ||
			![
				runtime.editorTimeSeconds,
				runtime.sourceDistanceBlend,
				...runtime.lightDirectionView,
				...runtime.lightLinearColorIntensity,
			].every(Number.isFinite) ||
			runtime.sourceDistanceBlend < 0 ||
			runtime.sourceDistanceBlend > 1 ||
			Math.hypot(...runtime.lightDirectionView) === 0
		) throw new Error('[JewelryMasked] invalid/unknown explicit editor runtime inputs');

		const direction = runtime.viewToSourceWorldDirection;
		if (!Array.isArray(direction) || direction.length !== 9 || !direction.every(Number.isFinite)) throw new Error('[JewelryMasked] verified view-to-native-world cube frame missing');

		const columns = [0, 1, 2].map((column) => direction.slice(column * 3, column * 3 + 3));
		if (
			columns.some((column) => Math.abs(Math.hypot(...column) - 1) > 1e-12) ||
			columns.some((column, i) => Math.abs(column.reduce((sum, value, axis) => sum + value * columns[(i + 1) % 3]![axis]!, 0)) > 1e-12)
		) throw new Error('[JewelryMasked] cube direction requires an orthogonal source world frame');
		if (
			object instanceof InstancedMesh &&
			(!runtime.instanceDistanceBlends ||
				runtime.instanceDistanceBlends.length !== object.count ||
				!runtime.instanceDistanceBlends.every((value) => value === runtime.sourceDistanceBlend))
		) throw new Error('[JewelryMasked] whole-component distance requires a per-instance frame');

		uniforms.maskedViewToSourceWorldDirection.value.fromArray(direction);
		uniforms.maskedEditorTime.value = runtime.editorTimeSeconds;
		uniforms.maskedDistanceBlend.value = runtime.sourceDistanceBlend;
		uniforms.maskedLightDirectionView.value.set(...runtime.lightDirectionView);
		uniforms.maskedLightColor.value.set(...runtime.lightLinearColorIntensity);
	};

	const vertexDeclarations = /* glsl */ `
attribute uvec2 jewelryNativePackedBasis;
attribute vec3 jewelryNativeLocalCM;
uniform mat3 maskedSourceToGeometry;
uniform mat4 maskedSourceCMToGeometry;
centroid varying vec3 vMaskedTangent;
centroid varying vec3 vMaskedNormal;
centroid varying float vMaskedHandedness;
varying vec3 vMaskedLocalCM;
vec4 maskedDecodeVertexDWORD(uint value) {
  ivec4 p=ivec4((uvec4(value)>>uvec4(0u,8u,16u,24u))&255u);
  p=ivec4(p.x>=128?p.x-256:p.x,p.y>=128?p.y-256:p.y,p.z>=128?p.z-256:p.z,p.w>=128?p.w-256:p.w);
  return max(vec4(p)/127.0,vec4(-1.0));
}
`;
	const vertexBody = /* glsl */ `
vec4 sourceX=maskedDecodeVertexDWORD(jewelryNativePackedBasis.x), sourceZ=maskedDecodeVertexDWORD(jewelryNativePackedBasis.y);
vec3 sourceT=cross(cross(sourceZ.xyz,sourceX.xyz)*sourceZ.w,sourceZ.xyz)*sourceZ.w;
mat3 sourceWorld=mat3(modelMatrix);
#ifdef USE_INSTANCING
sourceWorld*=mat3(instanceMatrix);
#endif
sourceWorld*=maskedSourceToGeometry;
sourceWorld=mat3(sourceWorld[0]/length(sourceWorld[0]),sourceWorld[1]/length(sourceWorld[1]),sourceWorld[2]/length(sourceWorld[2]));
mat3 sourceView=mat3(viewMatrix)*sourceWorld;
vMaskedTangent=sourceView*sourceT; vMaskedNormal=sourceView*sourceZ.xyz;
// LocalVS174's determinant handedness, including the verified source→viewer
// coordinate parity. This is not a magnitude normalization of the native basis.
vMaskedHandedness=sign(determinant(sourceView))*sourceZ.w;
vMaskedLocalCM=jewelryNativeLocalCM;
`;
	const vertexBeforeProjectBody = /* glsl */ `
// Exact native POSITION carrier and verified full beforeBake frame. The CUE
// display-position roundtrip is not the selected native LocalVS input.
transformed=(maskedSourceCMToGeometry*vec4(jewelryNativeLocalCM,1.0)).xyz;
`;
	return {
		uniforms,
		bind,
		vertexDeclarations,
		vertexBody,
		vertexBeforeProjectBody,
		programKey: `jewel-masked-source-3:${source.sourceContractSha256}:${source.runtimeProofSha256}`,

		configure(material: MeshBasicMaterial) {
			material.userData.jewelryMaskedSource = source;
		},
	};
}
