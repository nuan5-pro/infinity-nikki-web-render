import {
	AddEquation,
	ClampToEdgeWrapping,
	Color,
	CustomBlending,
	DoubleSide,
	LessEqualDepth,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshStandardMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NearestMipmapNearestFilter,
	NoBlending,
	NoColorSpace,
	OneMinusSrcAlphaFactor,
	RepeatWrapping,
	ShaderChunk,
	SrcAlphaFactor,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4,
	ZeroFactor,
	type Material,
	type Texture,
} from 'three';
import { installTranslucentLacePrepass } from './translucentLacePrepass.js';

type RGB = [number, number, number];

type RGBA = [number, number, number, number];

type Signs = [number, number];

export interface TranslucentLacePass {
	type: 'depth-prepass' | 'color'
	queue: number
	colorWrite: boolean
	depthWrite: boolean
	depthFunc: 'less-equal'
	cull: 'none'
	blend: 'grey-transmittance'
	blendSrc: 'src-alpha'
	blendDst: 'one-minus-src-alpha'
	blendSrcAlpha: 'zero'
	blendDstAlpha: 'one-minus-src-alpha'
}

export interface FurnitureTranslucentLace {
	family: 'translucent-lace'
	version: 1
	pixelShader: '7e40987198bd815542a9be4902b8acf3db16500e'
	depthPixelShader: '06500db8834544a89adf16db40895b6831dfe25c'
	depthCutoff: 0.33722156286239624
	color: RGBA
	fuzzy: RGB
	opacity: RGBA
	uvScale: number
	rotation: number
	detailUvScale: number
	detailFlatness: number
	roughness: Signs
	metalness: number
	specular: number
	textures: [LaceTexture, LaceTexture, LaceTexture]
	passes: [TranslucentLacePass, TranslucentLacePass]
	scheduling: 'native-queue-scope-unproved'
}

interface LaceTexture {
	key: string
	sRGB: boolean
	mipmaps: boolean
	nearest: boolean
	wrap: [string, string]
	encoding: 'rgba' | 'native-rg'
	sampler: 'view-world-wrap' | 'texture-asset'
}

/** Caller supplies the actual D/N/T resources and transport-to-TBN signs.
 * These signs describe image/coordinate transport, not native face sidedness.
 * Raw native RG and a glTF-normal-converted image must not be interchanged.
 */
export interface TranslucentLaceInputs {
	albedo: Texture
	normal: Texture
	detailNormal: Texture
	normalSigns: Signs
	detailNormalSigns: Signs
}

const cutoff = 0.33722156286239624;
const sourcePS = '7e40987198bd815542a9be4902b8acf3db16500e';
const depthPS = '06500db8834544a89adf16db40895b6831dfe25c';

export function readFurnitureTranslucentLace(value: unknown): FurnitureTranslucentLace | null {
	if (!value || typeof value !== 'object') return null;

	const c = value as Record<string, unknown>;
	if (
		c.family !== 'translucent-lace' ||
		c.version !== 1 ||
		c.pixelShader !== sourcePS ||
		c.depthPixelShader !== depthPS ||
		c.depthCutoff !== cutoff ||
		c.scheduling !== 'native-queue-scope-unproved'
	) return null;

	const numbers = (v: unknown, n: number) =>
		Array.isArray(v) &&
		v.length === n &&
		v.every((x) => typeof x === 'number' && Number.isFinite(x));

	for (const [key, size] of [
		['color', 4],
		['fuzzy', 3],
		['opacity', 4],
		['roughness', 2],
	] as const) {
		if (!numbers(c[key], size)) return null;
	}

	for (const key of [
		'uvScale',
		'rotation',
		'detailUvScale',
		'detailFlatness',
		'metalness',
		'specular',
	]) {
		if (typeof c[key] !== 'number' || !Number.isFinite(c[key])) return null;
	}

	if (
		(c.color as RGBA)[3] !== 0 ||
		(c.uvScale as number) <= 0 ||
		(c.detailUvScale as number) <= 0 ||
		(c.fuzzy as RGB)[0] < 0 ||
		(c.opacity as RGBA)[2] < 0
	) return null;

	const keys = ['Albedo Map', 'Normal Map(LinearColor)', 'DetailNormalMap'];
	if (!Array.isArray(c.textures) || c.textures.length !== 3) return null;

	for (let i = 0; i < 3; i++) {
		const t = c.textures[i] as LaceTexture | null;
		if (
			!t ||
			t.key !== keys[i] ||
			typeof t.sRGB !== 'boolean' ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			t.encoding !== (i === 0 ? 'rgba' : 'native-rg') ||
			(i !== 0 && t.sRGB) ||
			t.sampler !== (i === 2 ? 'texture-asset' : 'view-world-wrap') ||
			!Array.isArray(t.wrap) ||
			t.wrap.length !== 2 ||
			!t.wrap.every((s) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(s))
		) return null;
		if (i !== 2 && (t.nearest || t.wrap.some((s) => s !== 'TA_Wrap'))) return null;
	}

	if (!Array.isArray(c.passes) || c.passes.length !== 2) return null;

	for (let i = 0; i < 2; i++) {
		const p = c.passes[i] as TranslucentLacePass | null;
		if (
			!p ||
			p.type !== (i === 0 ? 'depth-prepass' : 'color') ||
			p.queue !== i ||
			p.colorWrite !== (i === 1) ||
			p.depthWrite !== (i === 0) ||
			p.depthFunc !== 'less-equal' ||
			p.cull !== 'none' ||
			p.blend !== 'grey-transmittance' ||
			p.blendSrc !== 'src-alpha' ||
			p.blendDst !== 'one-minus-src-alpha' ||
			p.blendSrcAlpha !== 'zero' ||
			p.blendDstAlpha !== 'one-minus-src-alpha'
		) return null;
	}

	return value as FurnitureTranslucentLace;
}

/** CPU reference of native 425..472 and custom-depth 106..120.
 * Inputs are sampled linear RGBA plus native fuzzy-frame and shading-frame
 * view dots. Native fuzzy facing flips RNM.Z only before TBN, not all XYZ.
 */
export function evaluateTranslucentLace(c: FurnitureTranslucentLace, sample: RGBA, fuzzyNV: number, flippedNV: number): { base: RGB; alpha: number; depthCovered: boolean } {
	const sat = (x: number) => Math.max(0, Math.min(1, x));
	const nv = sat(fuzzyNV);
	const edge = nv < 1 ? Math.pow(1 - nv, c.fuzzy[0]) * c.fuzzy[1] : 0;
	const base = sample
		.slice(0, 3)
		.map((v, i) => sat(v * c.color[i]! * (1 - nv * c.fuzzy[2] + edge))) as RGB;
	const op = c.opacity[0] + sample[3] * (c.opacity[1] - c.opacity[0]);
	const f = Math.max(Math.abs(1 - Math.max(flippedNV, 0)), 0.0001);
	const alpha = sat(op + c.opacity[3] * (Math.pow(f, c.opacity[2]) - op));
	return { base, alpha, depthCovered: alpha >= c.depthCutoff };
}

export function createTranslucentLaceMaterial(c: FurnitureTranslucentLace, input: TranslucentLaceInputs, source: Material): MeshStandardMaterial {
	if (!readFurnitureTranslucentLace(c)) throw new Error('Invalid compiled translucent lace profile');

	for (const signs of [input.normalSigns, input.detailNormalSigns]) {
		if (signs.length !== 2 || !signs.every((s) => s === -1 || s === 1)) throw new Error('Translucent lace requires explicit normal transport signs');
	}

	const wrap = (v: string) =>
		v === 'TA_Clamp'
			? ClampToEdgeWrapping
			: v === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	const textures = [input.albedo, input.normal, input.detailNormal].map((texture, i) => {
		if (!texture?.isTexture) throw new Error(`Missing native translucent lace slot ${i}`);

		const owned = texture.clone();
		const config = c.textures[i]!;
		owned.colorSpace = config.sRGB ? SRGBColorSpace : NoColorSpace;
		owned.channel = 0;
		owned.wrapS = wrap(config.wrap[0]);
		owned.wrapT = wrap(config.wrap[1]);
		owned.repeat.set(1, 1);
		owned.offset.set(0, 0);
		owned.center.set(0, 0);
		owned.rotation = 0;
		owned.matrixAutoUpdate = true;
		owned.updateMatrix();
		owned.magFilter = config.nearest ? NearestFilter : LinearFilter;
		owned.minFilter = config.mipmaps
			? config.nearest
				? NearestMipmapNearestFilter
				: LinearMipmapLinearFilter
			: owned.magFilter;
		owned.generateMipmaps = config.mipmaps && owned.mipmaps.length === 0;
		owned.needsUpdate = true;
		return owned;
	});
	const material = new MeshStandardMaterial({
		color: new Color(1, 1, 1),
		map: textures[0],
		normalMap: textures[1],
		roughness: Math.max(0, Math.min(1, (c.roughness[0] + c.roughness[1]) * 0.5)),
		metalness: Math.max(0, Math.min(1, c.metalness)),
		emissive: new Color(0, 0, 0),
		transparent: true,
		opacity: 1,
		alphaTest: 0,
		depthTest: true,
		depthWrite: false,
		depthFunc: LessEqualDepth,
		side: DoubleSide,
		forceSinglePass: true,
		premultipliedAlpha: false,
		vertexColors: false,
		blending: CustomBlending,
		blendEquation: AddEquation,
		blendSrc: SrcAlphaFactor,
		blendDst: OneMinusSrcAlphaFactor,
		blendEquationAlpha: AddEquation,
		blendSrcAlpha: ZeroFactor,
		blendDstAlpha: OneMinusSrcAlphaFactor,
	});
	material.name = source.name;
	material.toneMapped = source.toneMapped;
	material.visible = source.visible;
	material.userData = {
		...source.userData,
		translucentLace: c,
		translucentLacePass: 'color',
		requiresTranslucentLaceDepthPrepass: true,
		translucentLaceNormalSigns: [...input.normalSigns],
	};
	material.onBeforeRender = source.onBeforeRender;
	material.addEventListener('dispose', () => textures.forEach((t) => t.dispose()));
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, {
			laceD: { value: textures[0] },
			laceN: { value: textures[1] },
			laceDetail: { value: textures[2] },
			laceTint: { value: new Vector4(...c.color) },
			laceFuzzy: { value: new Vector3(...c.fuzzy) },
			laceOpacity: { value: new Vector4(...c.opacity) },
			laceUVScale: { value: c.uvScale },
			laceRotation: { value: c.rotation },
			laceDetailScale: { value: c.detailUvScale },
			laceDetailFlatness: { value: c.detailFlatness },
			laceSpecular: { value: c.specular },
			laceNormalSigns: { value: new Vector2(...input.normalSigns) },
			laceDetailSigns: { value: new Vector2(...input.detailNormalSigns) },
			laceDepthCutoff: { value: c.depthCutoff },
			// Static primitive fade=1 is declared, not a captured current scene value.
			lacePrimitiveFade: { value: 1 },
		});
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec2 vLaceUV;`,
			)
			.replace(
				'#include <uv_vertex>',
				`#include <uv_vertex>
vLaceUV = uv;`,
			);

		const normalBegin = ShaderChunk.normal_fragment_begin
			.replace('normal *= faceDirection;', '')
			.replace('tbn[0] *= faceDirection;', '')
			.replace('tbn[1] *= faceDirection;', '');
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec2 vLaceUV;
uniform sampler2D laceD;
uniform sampler2D laceN;
uniform sampler2D laceDetail;
uniform vec4 laceTint;
uniform vec3 laceFuzzy;
uniform vec4 laceOpacity;
uniform float laceUVScale;
uniform float laceRotation;
uniform float laceDetailScale;
uniform float laceDetailFlatness;
uniform float laceSpecular;
uniform vec2 laceNormalSigns;
uniform vec2 laceDetailSigns;
uniform float laceDepthCutoff;
uniform float lacePrimitiveFade;
vec4 laceSample;
float laceAlpha;
vec2 laceRotate(vec2 uv) {
  float angle = laceRotation * 6.2831854820251465;
  float cs = cos(angle), sn = sin(angle);
  vec2 p = uv - vec2(0.5);
  return vec2(cs*p.x-sn*p.y, sn*p.x+cs*p.y) + vec2(0.5);
}
vec3 laceDecode(vec2 rg, vec2 signs) {
  vec2 xy = (rg * 2.0 - 1.0) * signs;
  return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
}`,
			)
			.replace(
				'#include <map_fragment>',
				'laceSample = texture2D(laceD, laceRotate(vLaceUV * laceUVScale));',
			)
			.replace('#include <color_fragment>', '')
			.replace('#include <alphamap_fragment>', '')
			.replace('#include <alphatest_fragment>', '')
			.replace('#include <normal_fragment_begin>', normalBegin)
			.replace(
				'#include <normal_fragment_maps>',
				`
vec3 laceMainN = laceDecode(texture2D(laceN, laceRotate(vLaceUV * laceUVScale)).rg, laceNormalSigns);
vec3 laceDetailN = laceDecode(texture2D(laceDetail, laceRotate(vLaceUV * laceDetailScale)).rg, laceDetailSigns);
laceDetailN = mix(laceDetailN, vec3(0.0,0.0,1.0), laceDetailFlatness);
vec3 laceT = laceMainN + vec3(0.0,0.0,1.0);
vec3 laceU = laceDetailN * vec3(-1.0,-1.0,1.0);
vec3 laceRNM = laceT * dot(laceT, laceU) - laceU * laceT.z;
vec3 laceUnflippedN = normalize(tbn * laceRNM);
normal = laceUnflippedN * faceDirection;
vec3 laceView = isOrthographic ? vec3(0.0,0.0,1.0) : normalize(vViewPosition);
// Native PS349 retains the face factor in r11.z; PS415 overwrites XY only.
// PS416..425 builds the fuzzy frame with RNM.Z*face before the source TBN.
// Its frame is distinct from both the unflipped and fully flipped shading N.
vec3 laceFuzzyN = normalize(tbn * vec3(laceRNM.xy, laceRNM.z * faceDirection));
float laceNV = clamp(dot(laceView, laceFuzzyN), 0.0, 1.0);
float laceFuzzyEdge = laceNV < 1.0 ? pow(1.0-laceNV, laceFuzzy.x)*laceFuzzy.y : 0.0;
diffuseColor.rgb = clamp(laceSample.rgb * laceTint.rgb * (1.0-laceNV*laceFuzzy.z+laceFuzzyEdge), 0.0, 1.0);
float laceF = max(abs(1.0-max(dot(laceView, normal),0.0)),0.0001);
float laceOp = mix(laceOpacity.x, laceOpacity.y, laceSample.a);
laceAlpha = clamp(laceOp + laceOpacity.w * (pow(laceF,laceOpacity.z)-laceOp), 0.0, 1.0);
diffuseColor.a = laceAlpha * lacePrimitiveFade;`,
			)
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vec3(0.0);')
			.replace(
				'#include <lights_physical_fragment>',
				ShaderChunk.lights_physical_fragment.replace(
					'material.specularColor = vec3( 0.04 );',
					'material.specularColor = vec3(0.08 * clamp(laceSpecular,0.0,1.0));',
				),
			);
	};
	material.customProgramCacheKey = () => 'translucent_lace_ednb1_color_v2_fuzzy_z_face';
	installTranslucentLacePrepass(material, createTranslucentLaceDepthMaterial(material));
	return material;
}

/** Raw RG keeps native G. CUE SwapYZ reflects the exported tangent frame but
 * preserves tangent.w, so native y needs -1. GLTFLoader's derivative-TBN sign
 * (and geometry merge correction) is a separate phase; multiply that sign only.
 * The producer writes normalTexture.scale=1, never native intensity here.
 */
export function translucentLaceNormalSigns(source: Material): Signs {
	const retained = source.userData.translucentLaceNormalSigns;
	if (
		Array.isArray(retained) &&
		retained.length === 2 &&
		retained.every((v) => v === -1 || v === 1)
	) return [retained[0], retained[1]];

	const standard = source as MeshStandardMaterial;
	if (
		!standard.isMeshStandardMaterial ||
		standard.normalScale.x === 0 ||
		standard.normalScale.y === 0
	) throw new Error('Translucent lace requires original loader tangent phase');

	return [standard.normalScale.x < 0 ? -1 : 1, standard.normalScale.y < 0 ? 1 : -1];
}

/** Shares the color owner's textures/coverage. Dispose the pair together.
 * The caller controls routing; this helper deliberately does not install a
 * per-draw callback or assert global queue semantics that were not captured.
 */
export function createTranslucentLaceDepthMaterial(color: MeshStandardMaterial): MeshStandardMaterial {
	if (
		!readFurnitureTranslucentLace(color.userData.translucentLace) ||
		color.userData.translucentLacePass !== 'color'
	) throw new Error('Missing translucent lace color owner');

	const depth = color.clone();
	depth.name = `${color.name}:native-lace-depth`;
	depth.transparent = false;
	depth.blending = NoBlending;
	depth.colorWrite = false;
	depth.depthWrite = true;
	depth.depthTest = true;
	depth.depthFunc = LessEqualDepth;
	depth.side = DoubleSide;
	depth.toneMapped = false;
	depth.userData.translucentLacePass = 'depth-prepass';
	depth.userData.requiresTranslucentLaceDepthPrepass = false;
	depth.onBeforeCompile = (shader, renderer) => {
		color.onBeforeCompile(shader, renderer);

		const start = shader.fragmentShader.indexOf('#include <lights_physical_fragment>');
		// The color hook expands this chunk, so use its distinctive first line.
		const lighting = start >= 0 ? start : shader.fragmentShader.indexOf('PhysicalMaterial material;');
		if (lighting < 0) throw new Error('Missing supported lace depth shader boundary');

		shader.fragmentShader =
			shader.fragmentShader.slice(0, lighting) +
			`
if (laceAlpha * lacePrimitiveFade < laceDepthCutoff) discard;
gl_FragColor = vec4(0.0);
}`;
	};
	depth.customProgramCacheKey = () => 'translucent_lace_ednb1_depth_v2_shared_coverage';
	return depth;
}
