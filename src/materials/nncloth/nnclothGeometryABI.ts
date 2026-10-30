import {
	DirectionalLight,
	Matrix4,
	Vector3,
	Vector4,
	type Material,
	type Scene,
	type WebGLRenderer,
} from 'three';
import { assertNNClothSourceGeometry } from './nnclothGeometry.js';
import { assertNNClothBoundsFrame, type NNClothBoundsFrame } from './nnclothBounds.js';
import {
	createNNClothPreviewView,
	updateNNClothPreviewView,
} from './nnclothPreviewABI.js';
import type { NNClothShaderABI } from './nnclothCompiledMaterial.js';
import { materialTime } from '../../runtime/materialClock.js';

export interface NNClothSourceCollections {
	tod: [number, number, number, number][];
	weather: [number, number, number, number][];
}

const frameTimes = new WeakMap<WebGLRenderer, { frame: number; time: number }>();

function previewFrameTime(renderer: WebGLRenderer) {
	const frame = renderer.info.render.frame;
	const saved = frameTimes.get(renderer);
	if (saved?.frame === frame) return saved.time;

	const time = materialTime(renderer);
	frameTimes.set(renderer, { frame, time });
	return time;
}

function previewDirectional(scene: Scene) {
	let light: DirectionalLight | null = null;
	scene.traverse((object) => {
		if (object instanceof DirectionalLight && object.visible) {
			if (light) throw new Error('[NNCloth] exact preview ABI supports the captured single-directional editor domain');

			light = object;
		}
	});
	return light;
}

export function createNNClothGeometryABI(
	collections: NNClothSourceCollections,
	words: Record<string, number>,
	snapshot?: { realTime: number },
	component?: { customPrimitiveData: number[] },
): NNClothShaderABI {
	if (
		collections.tod.length !== 31 ||
		collections.weather.length !== 40 ||
		[...collections.tod, ...collections.weather].some((value) => value.length !== 4 || value.some((component) => !Number.isFinite(component))) ||
		words['316'] !== 0 ||
		words['317'] !== 0 ||
		!Number.isFinite(words['0'])
	) throw new Error('[NNCloth] captured collections/preshader zero-WPO domain missing');

	const view = createNNClothPreviewView();
	const center = new Vector3();
	const extent = new Vector3();
	const radius = { value: 0 };
	const boundsMatrix = new Matrix4();
	if (
		!component ||
		!Array.isArray(component.customPrimitiveData) ||
		component.customPrimitiveData.some((value) => !Number.isFinite(value))
	) throw new Error('[NNCloth] actual preview component custom-data domain invalid');
	// Components without an override use zero-initialized custom data.
	const customData2 = { value: component.customPrimitiveData[2] ?? 0 };

	const beforeRender: Material['onBeforeRender'] = (renderer, scene, camera, geometry, _object, group) => {
		assertNNClothSourceGeometry(geometry, [0, 1, 2]);

		const slot = (group as unknown as { materialIndex?: number } | undefined)?.materialIndex ?? 0;
		const frame = geometry.userData.nnclothBoundsFrames?.[slot] as NNClothBoundsFrame;
		assertNNClothBoundsFrame(frame);
		center.fromArray(frame.bounds.origin);
		extent.fromArray(frame.bounds.extent);
		radius.value = frame.bounds.radius;
		boundsMatrix.fromArray(frame.nativeToGeometry);
		customData2.value = component.customPrimitiveData[2] ?? 0;
		updateNNClothPreviewView(view, renderer, camera, previewDirectional(scene), snapshot?.realTime ?? previewFrameTime(renderer));
	};

	const varyings = `
varying vec4 vNNUV01,vNNUV23,vNNRawNormal;
varying vec3 vNNRawPosition,vNNWorldNormal,vNNWorldTangent,vNNObjectCenter,vNNFragmentWorld;
varying float vNNWorldHand,vNNMirror,vNNObjectRadius;`;
	const localTime = collections.tod[3]![2];
	// Exact LocalVS264 immediate DWORD, not its six-decimal ASM display.
	const timeScale = new Float32Array(new Uint32Array([0x3daaaaab]).buffer)[0]!;
	const tent = Math.fround(1 - Math.abs(Math.fround(Math.fround(localTime * timeScale) - 1)));
	const seasonal =
		tent <= 0
			? 0
			: Math.min(1, Math.fround(Math.fround(2 ** Math.fround(Math.fround(Math.log2(tent)) * words['0']!)) * 4));
	return {
		mode: 'geometry',
		uniforms: {
			nnView: { value: view },
			nnTOD: { value: collections.tod.map((value) => new Vector4(...value)) },
			nnWeather: { value: collections.weather.map((value) => new Vector4(...value)) },
			nnObjectCenter: { value: center },
			nnSeasonal: { value: seasonal },
			nnObjectRadius: radius,
			nnObjectExtent: { value: extent },
			nnBoundsToGeometry: { value: boundsMatrix },
			nnCustomData2: customData2,
		},
		beforeRender,
		vertexDeclarations: `${varyings}
attribute vec3 nnSourcePosition,nnWorldNormal;
attribute vec4 nnSourceNormal,nnWorldTangent;
#ifndef USE_UV1
attribute vec2 uv1;
#endif
#ifndef USE_UV2
attribute vec2 uv2;
#endif
uniform vec3 nnObjectCenter,nnObjectExtent;uniform float nnObjectRadius;uniform mat4 nnBoundsToGeometry;`,
		vertexSetupGLSL: `
mat4 nnObjectMatrix=modelMatrix;
#ifdef USE_INSTANCING
nnObjectMatrix=modelMatrix*instanceMatrix;
#endif
mat3 nnAxes=mat3(normalize(nnObjectMatrix[0].xyz),normalize(nnObjectMatrix[1].xyz),normalize(nnObjectMatrix[2].xyz));
vNNWorldNormal=nnAxes*nnWorldNormal;
vNNWorldTangent=nnAxes*nnWorldTangent.xyz;
float nnObjectParity=determinant(mat3(nnObjectMatrix))<0.0?-1.0:1.0;
vNNWorldHand=nnWorldTangent.w*nnObjectParity;
// World-tangent.w contains CUE SwapYZ and all subsequent bake parities.
// Divide by untouched native TangentZ.w, rather than counting the global
// editor mirror again through object.matrixWorld alone.
vNNMirror=vNNWorldHand*nnSourceNormal.w<0.0?-1.0:1.0;
vNNRawNormal=nnSourceNormal;
vNNRawPosition=nnSourcePosition;
vNNUV01=vec4(uv,uv1);
vNNUV23=vec4(uv2,uv2);
vec3 nnFragmentWorld=(nnObjectMatrix*vec4(transformed,1.0)).xyz;
vNNFragmentWorld=vec3(-nnFragmentWorld.y,nnFragmentWorld.x,nnFragmentWorld.z);
mat4 nnBoundsWorld=nnObjectMatrix*nnBoundsToGeometry;
vec3 nnCenterWorld=(nnBoundsWorld*vec4(nnObjectCenter,1.0)).xyz;
vNNObjectCenter=vec3(-nnCenterWorld.y,nnCenterWorld.x,nnCenterWorld.z);
vec3 nnExtentWorld=abs(nnBoundsWorld[0].xyz*nnObjectExtent.x)+abs(nnBoundsWorld[1].xyz*nnObjectExtent.y)+abs(nnBoundsWorld[2].xyz*nnObjectExtent.z);
vec3 nnRadiusSquared=nnBoundsWorld[0].xyz*nnBoundsWorld[0].xyz+nnBoundsWorld[1].xyz*nnBoundsWorld[1].xyz+nnBoundsWorld[2].xyz*nnBoundsWorld[2].xyz;
vNNObjectRadius=min(sqrt(max(nnRadiusSquared.x,max(nnRadiusSquared.y,nnRadiusSquared.z)))*nnObjectRadius,length(nnExtentWorld));`,
		fragmentDeclarations: varyings + '\nuniform float nnSeasonal;',
		primitiveGLSL: `
uniform float nnCustomData2;
vec4 nnPrimitiveLoad(uint index,uint offset){
  uint word=index*4u+offset;
  // This preview has no volumetric-lightmap single-sample, distance-field
  // indirect/capsule, or contact-shadow feature (bits 4/256/512). This is not a
  // claim about native live flags. Ordinary Three PCF shadows remain enabled.
  if(word==0u)return uintBitsToFloat(uvec4(vNNMirror<0.0?64u:0u,0u,0u,0u));
  if(word==72u)return vec4(0.0,0.0,0.0,vNNObjectRadius);
  if(word==76u)return vec4(vNNObjectCenter,0.0);
  if(word==134u)return vec4(nnCustomData2,0.0,0.0,0.0);
  return vec4(uintBitsToFloat(0x7fc00000u));
}`,
		bodySetupGLSL: `
void nnSetupBodyInputs(){
  nnInput[0]=vec4(-vNNWorldTangent.y,vNNWorldTangent.x,vNNWorldTangent.z,0.0);
  nnInput[1]=vec4(-vNNWorldNormal.y,vNNWorldNormal.x,vNNWorldNormal.z,vNNWorldHand);
  nnInput[2]=vNNUV01;nnInput[3]=vNNUV23;nnInput[4]=vec4(nnSeasonal,0.,0.,0.);
  nnInput[5]=uintBitsToFloat(uvec4(0u));
  nnInput[6]=vec4(vNNRawPosition,0.0);nnInput[7]=vec4(vNNRawNormal.xyz,0.0);nnInput[8]=vec4(0.0);
  nnInput[9]=vec4(gl_FragCoord.x,nnView[136].y-gl_FragCoord.y,gl_FragCoord.z,gl_FragCoord.w);
  nnInput[10]=uintBitsToFloat(uvec4(gl_FrontFacing?1u:0u,0u,0u,0u));
}`,
		coverageInputGLSL: `
vec4 nnDepthInput[9];vec4 nnDepthFade=vec4(0.0);
void nnSetupDepthInputs(){
  nnDepthInput[0]=nnInput[9];nnDepthInput[1]=nnInput[0];nnDepthInput[2]=nnInput[1];
  nnDepthInput[3]=nnInput[2];nnDepthInput[4]=nnInput[3];nnDepthInput[5]=nnInput[5];
  nnDepthInput[6]=nnInput[6];nnDepthInput[7]=nnInput[7];nnDepthInput[8]=nnInput[10];
}`,
	};
}
