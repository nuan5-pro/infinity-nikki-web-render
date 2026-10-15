import {
	ClampToEdgeWrapping,
	Color,
	DoubleSide,
	FrontSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshStandardMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NearestMipmapNearestFilter,
	NoColorSpace,
	RepeatWrapping,
	ShaderChunk,
	SRGBColorSpace,
	Vector2,
	Vector4,
	type BufferGeometry,
	type Material,
	type Texture,
} from 'three';

type RGB = [number, number, number];

type RGBA = [number, number, number, number];

type Signs = [number, number];

interface FeatherTexture {
	role: string;
	key: string;
	uv: number;
	sRGB: boolean;
	mipmaps: boolean;
	nearest: boolean;
	wrap: [string, string];
	encoding: 'rgba' | 'native-rg';
	sampler: 'view-world-wrap' | 'texture-asset';
}

export interface FurnitureLongFeather {
	family: 'long-feather';
	version: 1;
	domain: 'masked-static-v2' | 'grey-static-clear-v2';
	uvPolicy?: 'native-last-channel-clamp';
	uniforms: RGBA[];
	textures: FeatherTexture[];
	cutoff: 0.3333;
	screenPhase: 0;
	twoSided: boolean;
}

const roles = ['N', 'D', 'D1', 'B', 'M', 'C', 'S'];

const keys = [
	'法线贴图',
	'UV2颜色贴图',
	'UV3颜色贴图',
	'UV1遮罩图',
	'UV2遮罩图',
	'金属反射MatCap',
	'LongFeatherScreenNoise',
];

const uvChannels = [0, 1, 2, 0, 1, -1, -1];
const sat = (v: number) => Math.max(0, Math.min(1, v));
const gray = (v: RGB) => v[0] * 0.3 + v[1] * 0.59 + v[2] * 0.11;

export function readFurnitureLongFeather(value: unknown): FurnitureLongFeather | null {
	if (!value || typeof value !== 'object') return null;

	const c = value as FurnitureLongFeather;
	if (
		c.family !== 'long-feather' ||
		c.version !== 1 ||
		(c.domain !== 'masked-static-v2' && c.domain !== 'grey-static-clear-v2') ||
		c.cutoff !== 0.3333 ||
		c.screenPhase !== 0 ||
		typeof c.twoSided !== 'boolean' ||
		!Array.isArray(c.uniforms) ||
		c.uniforms.length !== 44 ||
		!c.uniforms.every(
			(v) =>
				Array.isArray(v) &&
				v.length === 4 &&
				v.every((x) => typeof x === 'number' && Number.isFinite(x)),
		)
	) return null;

	const u = c.uniforms;
	if (c.domain === 'grey-static-clear-v2') {
		if (
			c.uvPolicy !== 'native-last-channel-clamp' ||
			!c.twoSided ||
			u[42]![3] < 0
		) return null;
	} else if (c.uvPolicy !== undefined) return null;

	if (
		u[0]![2] !== 0 ||
		u[6]![0] !== 0 ||
		u[8]![3] !== 0 ||
		u[23]![3] !== 0 ||
		u[25]![3] !== 0 ||
		u[26]![0] !== 0 ||
		u[26]![2] > u[27]![0] ||
		u[27]![0] >= 0 ||
		u[29]![0] * u[29]![1] !== 0 ||
		u[34]![0] !== 0 ||
		u[34]![2] !== 0 ||
		u[36]![1] !== 0 ||
		u[38]![1] <= 0 ||
		u[41]![2] !== 0 ||
		u[42]![0] !== 0
	) return null;
	if (!Array.isArray(c.textures) || c.textures.length !== 7) return null;

	for (let i = 0; i < 7; i++) {
		const t = c.textures[i]!;
		if (
			!t ||
			t.role !== roles[i] ||
			t.key !== keys[i] ||
			t.uv !== uvChannels[i] ||
			typeof t.sRGB !== 'boolean' ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			t.encoding !== (i === 0 ? 'native-rg' : 'rgba') ||
			(i === 0 && t.sRGB) ||
			t.sampler !== (i === 6 ? 'texture-asset' : 'view-world-wrap') ||
			!Array.isArray(t.wrap) ||
			t.wrap.length !== 2 ||
			!t.wrap.every((v) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(v))
		) return null;
		if (i < 6 && (t.nearest || t.wrap.some((v) => v !== 'TA_Wrap'))) return null;
	}

	return c;
}

/** Validate before merging: generic merge code can fill missing UV/color slots.
 * The dedicated RGBA carrier is original GPU UNorm, not glTF linear color.
 */
export function validateLongFeatherGeometry(geometry: BufferGeometry, c: FurnitureLongFeather): void {
	if (!readFurnitureLongFeather(c)) throw new Error('Invalid long-feather source contract');

	const count = geometry.getAttribute('position')?.count;
	if (!count) throw new Error('Long-feather requires source positions');
	// The native LocalVF clamps index2 to the last real channel. This must run
	// before generic union padding; never replace an existing source UV2.
	if (!geometry.getAttribute('uv2') && c.uvPolicy === 'native-last-channel-clamp') {
		const last = geometry.getAttribute('uv1');
		if (last?.count === count && last.itemSize === 2) geometry.setAttribute('uv2', last);
	}

	for (const [key, size] of [
		['position', 3],
		['normal', 3],
		['tangent', 4],
		['uv', 2],
		['uv1', 2],
		['uv2', 2],
	] as const) {
		const a = geometry.getAttribute(key);
		if (!a || a.count !== count || a.itemSize !== size) throw new Error(`Long-feather requires source ${key}`);
	}

	const raw = geometry.getAttribute('_layer_color') ?? geometry.getAttribute('ueLongFeatherColor');
	if (
		!raw ||
		raw.itemSize !== 4 ||
		raw.count !== count ||
		raw.normalized ||
		!(raw.array instanceof Float32Array)
	) throw new Error('Long-feather requires original raw RGBA carrier');

	for (let i = 0; i < count; i++) {
		const blue = raw.getZ(i);
		if (!Number.isFinite(blue) || blue < 0 || blue > 1) throw new Error('Invalid native long-feather vertex blue');
	}

	geometry.setAttribute('ueLongFeatherColor', raw);
}

export function longFeatherNormalSigns(source: Material): Signs {
	const retained = source.userData.longFeatherNormalSigns;
	if (
		Array.isArray(retained) &&
		retained.length === 2 &&
		retained.every((v) => v === -1 || v === 1)
	) return [retained[0], retained[1]];

	const material = source as MeshStandardMaterial;
	if (
		!material.isMeshStandardMaterial ||
		material.normalScale.x === 0 ||
		material.normalScale.y === 0
	) throw new Error('Long-feather requires the original loader tangent phase');
	// Raw native G retains CUE SwapYZ's reflected bitangent. Compose only the
	// separate loader/merge phase, never its scale magnitude or an RGB rewrite.
	return [material.normalScale.x < 0 ? -1 : 1, material.normalScale.y < 0 ? 1 : -1];
}

/** Native masked PS uses a screen-noise offset, not a standard alpha channel.
 * pixel is relative, top-down native SV_Position; phase=0 is intentionally
 * stationary, not an assertion about the game's temporal-AA frame index.
 */
export function longFeatherCovered(c: FurnitureLongFeather, maskR: number, noiseR: number, pixel: Signs): boolean {
	const step =
		(((Math.floor(pixel[0] + c.screenPhase) + 2 * Math.floor(pixel[1] + c.screenPhase)) % 5) + 5) %
		5;
	return maskR * c.uniforms[38]![1] + (noiseR + step) * (1 / 6) - 0.5 >= c.cutoff;
}

/** Native GreyTrans/OIT and velocity-depth disagree deliberately. The approved
 * single-draw preview retains alpha, but deliberately does not write late depth.
 * The reduction requires fully visible dissolve/plane inputs; native vertex
 * position-buffer hide flags and the translucency reject input remain explicit.
 */
export function evaluateLongFeatherGreyCoverage(uniforms: RGBA[], maskR: number, vertexHidden: boolean, translucencyReject: number): { alpha: number; oitEligible: boolean; depthCovered: boolean } {
	if (
		uniforms.length !== 44 ||
		!uniforms.every((v) => v.length === 4 && v.every(Number.isFinite)) ||
		uniforms[25]![3] !== 0 ||
		uniforms[26]![0] !== 0 ||
		uniforms[26]![2] > uniforms[27]![0] ||
		uniforms[27]![0] >= 0 ||
		uniforms[41]![2] !== 0 ||
		uniforms[38]![1] <= 0 ||
		!Number.isFinite(maskR) ||
		maskR < 0 ||
		maskR > 1 ||
		!Number.isFinite(translucencyReject) ||
		translucencyReject < 0 ||
		translucencyReject > 1
	) throw new Error('Grey long-feather coverage requires the visible static source domain');

	const opacity = maskR * uniforms[38]![1];
	const alpha = sat(opacity * (vertexHidden ? 0 : 1)) * (1 - translucencyReject);
	// Velocity PS thresholds the un-clamped red-mask product. Its noise and
	// literal .33722156 final clip reduce to a binary result in this domain.
	const depthCovered = opacity >= 0.001 && opacity >= uniforms[41]![3];
	return { alpha, oitEligible: alpha > 0.001, depthCovered };
}

/** CB5 cloud amount and the authored material threshold gate CLFS by a fourth
 * power. A zero observed gate is not a uniform CLFS texture or a weather switch.
 */
export function longFeatherCloudGate(cloudAmount: number, materialThreshold: number): number {
	if (!Number.isFinite(cloudAmount) || !Number.isFinite(materialThreshold)) throw new Error('Invalid native cloud gate');

	const gate = sat(cloudAmount - materialThreshold);
	return gate * gate * gate * gate;
}

/** Native color/texture masks in the inactive-player-dye domain. The caller's
 * lightFacing belongs to the editor key light, replacing the UE scene input.
 */
export function evaluateLongFeatherBase(
	c: FurnitureLongFeather,
	uv1Color: RGB,
	uv2Color: RGB,
	mask0: RGB,
	mask1: RGB,
	vertexBlue: number,
	lightFacing: number,
): { base: RGB; ao: number; metalness: number } {
	const u = c.uniforms;
	const d0 = uv1Color.map((v) => v + (gray(uv1Color) - v) * u[2]![3]) as RGB;
	const d1 = uv2Color.map((v) => v + (gray(uv2Color) - v) * u[3]![0]) as RGB;
	const aoMask = u[9]![3] >= 0.5 ? mask0[1] * vertexBlue + 1 - vertexBlue : mask0[1];
	const blend = (aoMask * u[10]![0] + u[10]![1]) * (mask1[0] * u[10]![2] + u[10]![3]);
	const facing = sat(2 * lightFacing);
	const smooth = facing * facing * (3 - 2 * facing);
	const base = d0.map((v, i) => {
		const root = mask0[2] + (1 - mask0[2]) * sat(u[9]![i]!);
		const color = sat(v * d1[i]! * u[3]![i + 1]!) * root;
		const shade = u[2]![i]! + smooth * (u[1]![i]! - u[2]![i]!);
		return color * (shade + blend * (1 - shade));
	}) as RGB;
	return { base, ao: aoMask * u[19]![3] + u[20]![0], metalness: sat(mask1[1] * u[36]![0]) };
}

/** Source PS332..371: magnitude contrast is NOT component-wise contrast;
 * roughness B controls its LOD independently of the final surface roughness.
 */
export function evaluateLongFeatherMatcap(
	c: FurnitureLongFeather,
	sample: RGB,
	base: RGB,
	rawMetal: number,
	roughness: number,
	ao: number,
	nv: number,
): RGB {
	const u = c.uniforms;
	const length = Math.hypot(...sample);
	const amplitude = Math.max(0, length * (u[18]![2] - u[18]![3]) + u[18]![3]) / Math.max(length, 0.0001);

	const r = [
		1 - roughness,
		0.0425 - 0.0275 * roughness,
		1.04 - 0.572 * roughness,
		-0.04 + 0.022 * roughness,
	];

	const a = Math.min(r[0]! * r[0]!, 2 ** (-9.28 * nv)) * r[0]! + r[1]!;
	const ab = [-1.04 * a + r[2]!, 1.04 * a + r[3]!];
	return sample.map((v, i) => {
		const b = base[i]!;
		const polynomial = Math.max(ao, ao * (((2.0404 * b - 0.3324) * ao + (-4.7951 * b + 0.6417)) * ao + 2.7552 * b + 0.6903));
		const brdf = rawMetal * b * ab[0]! + sat(50 * rawMetal * base[1]) * ab[1]!;
		return v * amplitude * u[19]![i]! * polynomial * brdf;
	}) as RGB;
}

export function createLongFeatherMaterial(c: FurnitureLongFeather, slots: Partial<Record<string, Texture | null>>, source: Material): MeshStandardMaterial {
	if (!readFurnitureLongFeather(c)) throw new Error('Invalid native long-feather material');

	const grey = c.domain === 'grey-static-clear-v2';
	const signs = longFeatherNormalSigns(source);

	const wrap = (v: string) =>
		v === 'TA_Clamp'
			? ClampToEdgeWrapping
			: v === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	const textures = c.textures.map((t) => {
		const resource = slots[t.role];
		if (!resource?.isTexture) throw new Error(`Long-feather missing native ${t.role}`);

		const owned = resource.clone();
		owned.colorSpace = t.sRGB ? SRGBColorSpace : NoColorSpace;
		owned.channel = Math.max(t.uv, 0);
		owned.wrapS = wrap(t.wrap[0]);
		owned.wrapT = wrap(t.wrap[1]);
		owned.repeat.set(1, 1);
		owned.offset.set(0, 0);
		owned.center.set(0, 0);
		owned.rotation = 0;
		owned.matrixAutoUpdate = true;
		owned.updateMatrix();
		owned.magFilter = t.nearest ? NearestFilter : LinearFilter;
		owned.minFilter = t.mipmaps
			? t.nearest
				? NearestMipmapNearestFilter
				: LinearMipmapLinearFilter
			: owned.magFilter;
		// Source-base image transport regenerates mips; it is not the UE cooked
		// chain. The native absolute LOD is retained rather than forced to zero.
		owned.generateMipmaps = t.mipmaps && owned.mipmaps.length === 0;
		owned.needsUpdate = true;
		return owned;
	});
	const material = new MeshStandardMaterial({
		color: new Color(1, 1, 1),
		map: textures[1],
		normalMap: textures[0],
		normalScale: new Vector2(1, 1),
		roughness: 0.9,
		metalness: 0,
		transparent: grey,
		alphaTest: 0,
		vertexColors: false,
		side: c.twoSided ? DoubleSide : FrontSide,
		depthWrite: !grey,
	});
	// Transparent DoubleSide otherwise causes Three to submit back/front draws.
	// This policy intentionally preserves exactly one draw, not a depth pair.
	material.forceSinglePass = grey;
	material.defines = { USE_UV1: '', USE_UV2: '' };
	material.name = source.name;
	material.toneMapped = source.toneMapped;
	material.visible = source.visible;
	material.userData = { ...source.userData, longFeather: c, longFeatherNormalSigns: signs };

	const viewport = new Vector4(0, 0, 1, 1);
	material.onBeforeRender = (...args) => {
		source.onBeforeRender(...args);
		args[0].getCurrentViewport(viewport);
	};
	material.addEventListener('dispose', () => textures.forEach((texture) => texture.dispose()));
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, {
			lfMaterial: { value: c.uniforms.map((v) => new Vector4(...v)) },
			lfNormalSigns: { value: new Vector2(...signs) },
			lfViewport: { value: viewport },
			lfN: { value: textures[0] },
			lfD0: { value: textures[1] },
			lfD1: { value: textures[2] },
			lfMask0: { value: textures[3] },
			lfMask1: { value: textures[4] },
			lfMatcap: { value: textures[5] },
			lfNoise: { value: textures[6] },
		});
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec4 ueLongFeatherColor;
varying vec2 vFeatherUV0, vFeatherUV1, vFeatherUV2;
varying float vFeatherBlue;`,
			)
			.replace(
				'#include <uv_vertex>',
				`#include <uv_vertex>
vFeatherUV0=uv; vFeatherUV1=uv1; vFeatherUV2=uv2; vFeatherBlue=ueLongFeatherColor.b;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform vec4 lfMaterial[44];
uniform vec2 lfNormalSigns;
uniform vec4 lfViewport;
uniform sampler2D lfN, lfD0, lfD1, lfMask0, lfMask1, lfMatcap, lfNoise;
varying vec2 vFeatherUV0, vFeatherUV1, vFeatherUV2;
varying float vFeatherBlue;
vec3 featherMask0, featherMask1, featherBase;
float featherAO, featherOpacity;
vec3 featherDesaturate(vec3 c,float amount) { return mix(c,vec3(dot(c,vec3(.3,.59,.11))),amount); }`,
			)
			.replace(
				'#include <map_fragment>',
				`
featherMask0=texture2D(lfMask0,vFeatherUV0).rgb;
featherMask1=texture2D(lfMask1,vFeatherUV1).rgb;
featherBase=clamp(featherDesaturate(texture2D(lfD0,vFeatherUV1).rgb,lfMaterial[2].w)*
  featherDesaturate(texture2D(lfD1,vFeatherUV2).rgb,lfMaterial[3].x)*lfMaterial[3].yzw,0.0,1.0);
vec2 featherPixel=vec2(gl_FragCoord.x-lfViewport.x,lfViewport.w-(gl_FragCoord.y-lfViewport.y));
float featherStep=mod(floor(featherPixel.x)+2.0*floor(featherPixel.y),5.0);
float featherNoise=texture2D(lfNoise,featherPixel/64.0).r;
${
	grey
		? `
// Fully visible native GreyTrans color has smooth red-mask opacity, not the
// masked screen-noise threshold. Retain the source noise input; its dissolve
// and late-depth uses are inactive/omitted in this declared static domain.
featherOpacity=clamp(featherMask0.r*lfMaterial[38].y,0.0,1.0);
if(featherOpacity <= .001) discard;`
		: `
featherOpacity=1.0;
if(featherMask0.r*lfMaterial[38].y+(featherNoise+featherStep)/6.0-.5 < .3333) discard;`
}`,
			)
			.replace('#include <color_fragment>', '')
			.replace('#include <alphamap_fragment>', '')
			.replace('#include <alphatest_fragment>', '')
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=0.9;')
			.replace(
				'#include <metalnessmap_fragment>',
				'float metalnessFactor=clamp(featherMask1.g*lfMaterial[36].x,0.0,1.0);',
			)
			.replace(
				'#include <normal_fragment_begin>',
				ShaderChunk.normal_fragment_begin
					.replace('normal *= faceDirection;', '')
					.replace('tbn[0] *= faceDirection;', '')
					.replace('tbn[1] *= faceDirection;', ''),
			)
			.replace(
				'#include <normal_fragment_maps>',
				`
vec2 featherRaw=texture2D(lfN,vFeatherUV0).rg*2.0-1.0;
vec3 featherN=normalize(vec3(featherRaw*lfMaterial[0].y*lfNormalSigns,sqrt(max(1.0-dot(featherRaw,featherRaw),0.0))));
if(lfMaterial[0].y < .001) featherN=vec3(0.0,0.0,1.0);
normal=normalize(tbn*featherN);
vec3 featherView=isOrthographic ? vec3(0.0,0.0,1.0) : normalize(vViewPosition);
float featherFacing=0.0;
#if NUM_DIR_LIGHTS > 0
  featherFacing=clamp(2.0*dot(normal,directionalLights[0].direction),0.0,1.0);
#endif
featherFacing=featherFacing*featherFacing*(3.0-2.0*featherFacing);
vec3 featherShade=mix(lfMaterial[2].rgb,lfMaterial[1].rgb,featherFacing);
featherBase*=mix(clamp(lfMaterial[9].rgb,0.0,1.0),vec3(1.0),featherMask0.b);
float featherAOMask=lfMaterial[9].w >= .5 ? featherMask0.g*vFeatherBlue+1.0-vFeatherBlue : featherMask0.g;
float featherShadeMix=(featherAOMask*lfMaterial[10].x+lfMaterial[10].y)*(featherMask1.r*lfMaterial[10].z+lfMaterial[10].w);
featherBase=mix(featherBase*featherShade,featherBase,featherShadeMix);
featherAO=featherAOMask*lfMaterial[19].w+lfMaterial[20].x;
diffuseColor.rgb=featherBase;
diffuseColor.a=featherOpacity;`,
			)
			.replace(
				'#include <emissivemap_fragment>',
				`
float featherNV=dot(normal,featherView);
vec3 featherReflection=2.0*featherNV*normal-featherView;
vec2 featherMatcapUV=featherReflection.xy*.5+.5;
float featherR=max(featherMask1.b,.001);
float featherLod=1.2*log2(featherR)+7.0+lfMaterial[18].y;
vec3 featherCap=textureLod(lfMatcap,featherMatcapUV,featherLod).rgb;
float featherLength=length(featherCap);
featherCap*=max(0.0,featherLength*(lfMaterial[18].z-lfMaterial[18].w)+lfMaterial[18].w)/max(featherLength,.0001);
featherCap*=lfMaterial[19].rgb;
vec4 featherCoeff=featherMask1.b*vec4(-1.0,-.0275,-.572,.022)+vec4(1.0,.0425,1.04,-.04);
float featherA004=min(featherCoeff.x*featherCoeff.x,exp2(-9.28*featherNV))*featherCoeff.x+featherCoeff.y;
vec2 featherAB=vec2(-1.04,1.04)*featherA004+featherCoeff.zw;
vec3 featherF0=featherMask1.g*featherBase;
vec3 featherEnv=featherF0*featherAB.x+clamp(50.0*featherF0.g,0.0,1.0)*featherAB.y;
vec3 featherPoly=max(vec3(featherAO),featherAO*(((featherBase*2.0404-.3324)*featherAO+
  (-featherBase*4.7951+.6417))*featherAO+featherBase*2.7552+.6903));
featherCap*=featherEnv*featherPoly;
float featherEmissionAO=(featherAOMask*lfMaterial[20].y+lfMaterial[20].z)*(featherMask1.r*lfMaterial[20].w+lfMaterial[21].x);
vec3 featherRim=featherBase*lfMaterial[11].yzw*pow(max(1.0-abs(featherNV),0.0),lfMaterial[11].x);
// Retain the native matcap response. Direct anisotropic lobes and transmission
// are deliberately replaced by editor PBR, not re-labelled as exact lighting.
totalEmissiveRadiance=max(vec3(0.0),(featherCap+featherRim)*featherEmissionAO*lfMaterial[21].y);`,
			);
	};
	material.customProgramCacheKey = () =>
		grey
			? 'long_feather_grey_static_clear_v2_single_draw_raw_rg_rgba'
			: 'long_feather_masked_static_v2_raw_rg_rgba';
	return material;
}
