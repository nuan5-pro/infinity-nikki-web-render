import {
	ClampToEdgeWrapping,
	Color,
	DataTexture,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshStandardMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NearestMipmapNearestFilter,
	NoColorSpace,
	RepeatWrapping,
	RGBAFormat,
	ShaderChunk,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4,
	type Material,
	type Texture,
} from 'three';

type RGB = [number, number, number];

type RGBA = [number, number, number, number];

type Four<T> = [T, T, T, T];

export interface FurnitureCloth {
	family: 'cloth-master';
	version: 2;
	root: 'main' | 'home';
	mode: 'opaque' | 'masked' | 'translucent';
	alphaCutoff: number;
	opacitySource: 'one' | 'diffuse-alpha' | 'sss-scalar';
	opacity: RGB;
	color: RGB;
	roughness: [number, number];
	metalness: [number, number];
	ao: [number, number];
	uvScale: number;
	mainUvChannel: number;
	detailUvScale: number;
	detailFlatness: number;
	twoSideSign: number;
	normalFaceSign?: boolean;
	normalOutputFaceSign?: boolean;
	edgeColor: RGBA;
	edgePower: number;
	diffuseEdge: [number, number];
	anisoColor: RGBA;
	anisoTangent: RGB;
	anisoBaseMix: number;
	anisoRoughness: number;
	anisoScale: [number, number];
	emissive: RGB;
	colorInShadow: RGB;
	advanced: boolean;
	reflectBase: RGB;
	reflectDark: RGB;
	palette: boolean;
	paletteUvBlend: number;
	paletteConstant: RGBA;
	maskColor: RGB;
	maskUvChannel: number;
	maskUvScale: [number, number];
	fourthRole: 'detail-normal' | 'palette' | 'mask' | 'none';
	resourceKeys?: Four<string>;
	textureActive: Four<boolean>;
	textureConstant: Four<RGBA>;
	textureSRGB: Four<boolean>;
	textureMipmaps: Four<boolean>;
	textureNearest: Four<boolean>;
	textureWrap: Four<[string, string]>;
}

export function readFurnitureCloth(value: unknown): FurnitureCloth | null {
	if (!value || typeof value !== 'object') return null;

	const c = value as Record<string, unknown>;
	if (
		c.family !== 'cloth-master' ||
		c.version !== 2 ||
		!['main', 'home'].includes(String(c.root)) ||
		!['opaque', 'masked', 'translucent'].includes(String(c.mode)) ||
		!['one', 'diffuse-alpha', 'sss-scalar'].includes(String(c.opacitySource)) ||
		!['detail-normal', 'palette', 'mask', 'none'].includes(String(c.fourthRole))
	) return null;

	const numbers = (array: unknown, size: number): boolean =>
		Array.isArray(array) &&
		array.length === size &&
		array.every((v) => typeof v === 'number' && Number.isFinite(v));

	for (const [key, size] of [
		['opacity', 3],
		['color', 3],
		['roughness', 2],
		['metalness', 2],
		['ao', 2],
		['edgeColor', 4],
		['diffuseEdge', 2],
		['anisoColor', 4],
		['anisoTangent', 3],
		['anisoScale', 2],
		['emissive', 3],
		['colorInShadow', 3],
		['reflectBase', 3],
		['reflectDark', 3],
		['paletteConstant', 4],
		['maskColor', 3],
		['maskUvScale', 2],
	] as const)
		if (!numbers(c[key], size)) return null;

	for (const key of [
		'alphaCutoff',
		'uvScale',
		'mainUvChannel',
		'detailUvScale',
		'detailFlatness',
		'twoSideSign',
		'edgePower',
		'anisoBaseMix',
		'anisoRoughness',
		'paletteUvBlend',
		'maskUvChannel',
	])
		if (typeof c[key] !== 'number' || !Number.isFinite(c[key])) return null;

	for (const key of ['textureActive', 'textureSRGB', 'textureMipmaps', 'textureNearest']) {
		const flags = c[key];
		if (!Array.isArray(flags) || flags.length !== 4 || !flags.every((v) => typeof v === 'boolean')) return null;
	}

	if (
		!Array.isArray(c.textureConstant) ||
		c.textureConstant.length !== 4 ||
		!c.textureConstant.every((v) => numbers(v, 4)) ||
		!Array.isArray(c.textureWrap) ||
		c.textureWrap.length !== 4 ||
		!c.textureWrap.every(
			(v) =>
				Array.isArray(v) &&
				v.length === 2 &&
				v.every((s) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(s)),
		)
	) return null;
	if (
		typeof c.advanced !== 'boolean' ||
		typeof c.palette !== 'boolean' ||
		(c.uvScale as number) <= 0 ||
		(c.detailUvScale as number) <= 0 ||
		!Number.isInteger(c.mainUvChannel) ||
		(c.mainUvChannel as number) < 0 ||
		(c.mainUvChannel as number) > 3 ||
		!Number.isInteger(c.maskUvChannel) ||
		(c.maskUvChannel as number) < 0 ||
		(c.maskUvChannel as number) > 3 ||
		(c.anisoScale as number[]).some((v) => v <= 0)
	) return null;
	if (c.normalFaceSign !== undefined && typeof c.normalFaceSign !== 'boolean') return null;
	if (c.normalOutputFaceSign !== undefined && typeof c.normalOutputFaceSign !== 'boolean') return null;

	return value as FurnitureCloth;
}

/** Compiled Cloth_Master consumers, at most four material texture samples.
 * Static wind suppression does not reinterpret native COLOR as albedo/alpha.
 */
export function createClothMaterial(
	cloth: FurnitureCloth,
	diffuse: Texture | null,
	normal: Texture | null,
	orm: Texture | null,
	fourth: Texture | null,
	source: Material,
): MeshStandardMaterial {
	const input = [diffuse, normal, orm, fourth];

	const wrapping = (value: string) =>
		value === 'TA_Clamp'
			? ClampToEdgeWrapping
			: value === 'TA_Mirror'
				? MirroredRepeatWrapping
				: RepeatWrapping;

	const textures = input.map((texture, role) => {
		if (!cloth.textureActive[role]) return null;
		if (!texture) throw new Error(`Missing compiled cloth slot ${role}`);

		const owned = texture.clone();
		owned.colorSpace = cloth.textureSRGB[role] ? SRGBColorSpace : NoColorSpace;
		owned.channel = cloth.mainUvChannel;
		owned.wrapS = wrapping(cloth.textureWrap[role]![0]);
		owned.wrapT = wrapping(cloth.textureWrap[role]![1]);
		owned.repeat.set(1, 1);
		owned.offset.set(0, 0);
		owned.center.set(0, 0);
		owned.rotation = 0;
		owned.matrixAutoUpdate = true;
		owned.updateMatrix();

		const nearest = cloth.textureNearest[role];
		owned.magFilter = nearest ? NearestFilter : LinearFilter;
		owned.minFilter = cloth.textureMipmaps[role]
			? nearest
				? NearestMipmapNearestFilter
				: LinearMipmapLinearFilter
			: owned.magFilter;
		owned.generateMipmaps = cloth.textureMipmaps[role]!;
		owned.needsUpdate = true;
		return owned;
	});
	// Enable Three's explicit/derivative TBN and AO chunks even when the native
	// sample constant-folds. The placeholder sampler is never read by this PS.
	const placeholder = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat);
	placeholder.channel = cloth.mainUvChannel;
	placeholder.needsUpdate = true;

	const material = new MeshStandardMaterial({
		color: new Color().setRGB(...cloth.color),
		map: textures[0],
		normalMap: textures[1] ?? placeholder,
		aoMap: textures[2] ?? placeholder,
		aoMapIntensity: 1,
		roughness: 1,
		metalness: 1,
		vertexColors: false,
		transparent: cloth.mode === 'translucent',
		opacity: 1,
		alphaTest: cloth.mode === 'masked' ? cloth.alphaCutoff : 0,
		depthWrite: cloth.mode !== 'translucent',
		side: source.side,
		forceSinglePass: true,
	});
	material.name = source.name;
	material.userData = { ...source.userData, cloth };
	material.depthTest = source.depthTest;
	material.colorWrite = source.colorWrite;
	material.toneMapped = source.toneMapped;
	material.visible = source.visible;
	material.addEventListener('dispose', () => {
		textures.forEach((texture) => texture?.dispose());
		placeholder.dispose();
	});

	const standard = source as MeshStandardMaterial;
	const signs = standard.userData.clothNormalSigns;
	if (
		Array.isArray(signs) &&
		signs.length === 2 &&
		signs.every((v: unknown) => v === -1 || v === 1)
	) {
		material.normalScale.set(signs[0]!, signs[1]!);
	} else if (standard.isMeshStandardMaterial) {
		material.normalScale.set(standard.normalScale.x < 0 ? -1 : 1, standard.normalScale.y < 0 ? -1 : 1);
	}

	material.userData.clothNormalSigns = material.normalScale.toArray();
	if (standard.isMeshStandardMaterial) material.flatShading = standard.flatShading;

	const aniso = cloth.anisoColor.slice(0, 3).some((v) => v !== 0);
	const uvName = cloth.mainUvChannel === 0 ? 'uv' : `uv${cloth.mainUvChannel}`;
	const extraUV = new Set<number>([cloth.mainUvChannel]);
	if (cloth.palette && cloth.fourthRole === 'palette' && cloth.paletteUvBlend !== 0) extraUV.add(2);
	if (cloth.fourthRole === 'mask') extraUV.add(cloth.maskUvChannel);
	const maskUVName = cloth.maskUvChannel === 0 ? 'uv' : `uv${cloth.maskUvChannel}`;
	const uvDeclarations = [...extraUV]
		.filter((n) => n !== 0)
		.map((n) => `#ifndef USE_UV${n}\nattribute vec2 uv${n};\n#endif`)
		.join('\n');
	material.onBeforeCompile = (shader) => {
		shader.uniforms.clothMainScale = { value: cloth.uvScale };
		shader.uniforms.clothDetailScale = { value: cloth.detailUvScale };
		shader.uniforms.clothPaletteUVBlend = { value: cloth.paletteUvBlend };
		shader.uniforms.clothMaskUVScale = { value: new Vector2(...cloth.maskUvScale) };
		shader.uniforms.clothMaskColor = { value: new Vector3(...cloth.maskColor) };
		for (let i = 0; i < 4; i++) {
			shader.uniforms[`clothSlot${i}`] = { value: textures[i] };
			shader.uniforms[`clothConstant${i}`] = { value: new Vector4(...cloth.textureConstant[i]!) };
		}

		shader.uniforms.clothPaletteConstant = { value: new Vector4(...cloth.paletteConstant) };
		shader.uniforms.clothDetailFlatness = { value: cloth.detailFlatness };
		shader.uniforms.clothTwoSideSign = { value: cloth.twoSideSign };
		shader.uniforms.clothRoughness = { value: new Vector2(...cloth.roughness) };
		shader.uniforms.clothMetalness = { value: new Vector2(...cloth.metalness) };
		shader.uniforms.clothAo = { value: new Vector2(...cloth.ao) };
		shader.uniforms.clothEdgeColor = { value: new Vector4(...cloth.edgeColor) };
		shader.uniforms.clothEdgePower = { value: cloth.edgePower };
		shader.uniforms.clothDiffuseEdge = { value: new Vector2(...cloth.diffuseEdge) };
		shader.uniforms.clothAnisoColor = { value: new Vector4(...cloth.anisoColor) };
		shader.uniforms.clothAnisoTangent = {
			value: new Vector3(cloth.anisoTangent[0], -cloth.anisoTangent[1], cloth.anisoTangent[2]),
		};
		shader.uniforms.clothAnisoBaseMix = { value: cloth.anisoBaseMix };
		shader.uniforms.clothAnisoRoughness = { value: cloth.anisoRoughness };
		shader.uniforms.clothAnisoScale = { value: new Vector2(...cloth.anisoScale) };
		shader.uniforms.clothEmissive = { value: new Vector3(...cloth.emissive) };
		shader.uniforms.clothShadowColor = { value: new Vector3(...cloth.colorInShadow) };
		shader.uniforms.clothReflectBase = { value: new Vector3(...cloth.reflectBase) };
		shader.uniforms.clothReflectDark = { value: new Vector3(...cloth.reflectDark) };
		shader.uniforms.clothOpacity = { value: new Vector3(...cloth.opacity) };

		const sample = (slot: number, uv: string) => cloth.textureActive[slot] ? `texture2D(clothSlot${slot}, ${uv})` : `clothConstant${slot}`;

		const paletteUV = extraUV.has(2)
			? 'mix(vClothMainUV, vClothPaletteUV, clothPaletteUVBlend)'
			: 'vClothMainUV';
		// Native PS owns face-dependent map-normal multiplication. Three's default
		// normal/TBN flips would add a second sign (or invert native UseTwoSideSign=0).
		// Existing v2 artifacts without this new compiled proof retain their old path.
		const provedFace = cloth.normalFaceSign !== undefined;
		const normalBegin = provedFace
			? ShaderChunk.normal_fragment_begin
				.replace('normal *= faceDirection;', '')
				.replace('tbn[0] *= faceDirection;', '')
				.replace('tbn[1] *= faceDirection;', '')
			: ShaderChunk.normal_fragment_begin;
		const normalCore = `vec3 clothMainN = clothDecodeNormal(${sample(1, 'vClothMainUV')}.rg);
vec3 clothDetailN = ${cloth.fourthRole === 'detail-normal' ? `clothDecodeNormal(${sample(3, 'vClothDetailUV')}.rg)` : 'vec3(0.0, 0.0, 1.0)'};
clothDetailN = mix(clothDetailN, vec3(0.0, 0.0, 1.0), clothDetailFlatness);
vec3 clothT = clothMainN + vec3(0.0, 0.0, 1.0);
vec3 clothU = clothDetailN * vec3(-1.0, -1.0, 1.0);
vec3 mapN = normalize(clothT * dot(clothT, clothU) - clothU * clothT.z);
${
	provedFace
		? cloth.normalFaceSign
			? 'mapN *= 1.0 + (faceDirection - 1.0) * clothTwoSideSign;'
			: ''
		: `#ifdef DOUBLE_SIDED
mapN *= 1.0 + (faceDirection - 1.0) * clothTwoSideSign;
#endif`
}`;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
${uvDeclarations}
uniform float clothMainScale;
uniform float clothDetailScale;
uniform vec2 clothMaskUVScale;
varying vec2 vClothMainUV;
varying vec2 vClothDetailUV;
varying vec2 vClothMaskUV;
${extraUV.has(2) ? 'varying vec2 vClothPaletteUV;' : ''}`,
			)
			.replace(
				'#include <uv_vertex>',
				`#include <uv_vertex>
vClothMainUV = ${uvName} * clothMainScale;
vClothDetailUV = uv * clothDetailScale;
vClothMaskUV = ${maskUVName} * clothMaskUVScale;
${extraUV.has(2) ? 'vClothPaletteUV = uv2;' : ''}`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec2 vClothMainUV;
varying vec2 vClothDetailUV;
varying vec2 vClothMaskUV;
${extraUV.has(2) ? 'varying vec2 vClothPaletteUV;' : ''}
${[0, 1, 2, 3].map((i) => `uniform sampler2D clothSlot${i};\nuniform vec4 clothConstant${i};`).join('\n')}
uniform vec4 clothPaletteConstant;
uniform float clothPaletteUVBlend;
uniform float clothDetailFlatness;
uniform float clothTwoSideSign;
uniform vec2 clothRoughness;
uniform vec2 clothMetalness;
uniform vec2 clothAo;
uniform vec4 clothEdgeColor;
uniform float clothEdgePower;
uniform vec2 clothDiffuseEdge;
uniform vec4 clothAnisoColor;
uniform vec3 clothAnisoTangent;
uniform float clothAnisoBaseMix;
uniform float clothAnisoRoughness;
uniform vec2 clothAnisoScale;
uniform vec3 clothEmissive;
uniform vec3 clothShadowColor;
uniform vec3 clothReflectBase;
uniform vec3 clothReflectDark;
uniform vec3 clothOpacity;
uniform vec3 clothMaskColor;
vec4 clothD;
vec4 clothOrm;
float clothAO;
vec3 clothEdge;
vec3 clothAniso;
vec3 clothShadowBase;
vec3 clothDecodeNormal(vec2 rg) {
  vec2 xy = rg * 2.0 - 1.0;
  return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
}`,
			)
			.replace('#include <color_fragment>', '')
			.replace('#include <alphatest_fragment>', '')
			.replace(
				'#include <map_fragment>',
				`clothD = ${sample(0, 'vClothMainUV')};
clothOrm = ${sample(2, 'vClothMainUV')};
clothAO = clamp(mix(clothAo.x, clothAo.y, clothOrm.r), 0.0, 1.0);
diffuseColor.rgb *= clothD.rgb;
${cloth.fourthRole === 'mask' ? `diffuseColor.rgb = mix(diffuseColor.rgb, clothMaskColor, ${sample(3, 'vClothMaskUV')}.r);` : ''}
${cloth.palette ? `diffuseColor.rgb *= mix(vec3(1.0), ${cloth.fourthRole === 'palette' ? sample(3, paletteUV) : 'clothPaletteConstant'}.rgb, clothOrm.a);` : ''}
diffuseColor.a = 1.0;`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				'float roughnessFactor = clamp(mix(clothRoughness.x, clothRoughness.y, clothOrm.g), 0.0, 1.0);',
			)
			.replace(
				'#include <metalnessmap_fragment>',
				'float metalnessFactor = clamp(mix(clothMetalness.x, clothMetalness.y, clothOrm.b), 0.0, 1.0);',
			)
			.replace('#include <normal_fragment_begin>', normalBegin)
			.replace(
				'#include <normal_fragment_maps>',
				`${ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', normalCore)}
${cloth.normalOutputFaceSign ? 'normal *= faceDirection;' : ''}
vec3 clothView = normalize(vViewPosition);
float clothNV = dot(normal, clothView);
float clothF = max(abs(1.0 - max(clothNV, 0.0)), 0.0001);
float clothEdgeF = pow(clothF, clothEdgePower);
clothEdge = clothEdgeColor.rgb * clothEdgeF;
${
	cloth.root === 'home'
		? `vec3 clothScaled = diffuseColor.rgb * clothDiffuseEdge.x;
vec3 clothDesaturated = mix(clothScaled, vec3(dot(clothScaled, vec3(0.3, 0.59, 0.11))), clothDiffuseEdge.y);
diffuseColor.rgb = mix(diffuseColor.rgb, clothDesaturated, clothEdgeF);`
		: ''
}
clothAniso = vec3(0.0);
${
	aniso
		? `vec3 clothAxis = cross(mat3(viewMatrix) * clothAnisoTangent, normal);
float clothAxisLength = dot(clothAxis, clothAxis);
if (clothAxisLength > 0.0) {
  clothAxis *= inversesqrt(clothAxisLength);
  vec3 clothOtherAxis = normalize(cross(clothAxis, normal));
  vec2 clothAxes = max(clamp(roughnessFactor * clothAnisoRoughness, 0.0, 1.0) * clothAnisoScale, vec2(0.01));
  vec2 clothAxesSquared = clothAxes * clothAxes;
  vec2 clothViewAxes = vec2(dot(clothAxis, clothView), dot(clothOtherAxis, clothView));
  float clothQ = clothNV * clothNV + dot(clothViewAxes * clothViewAxes, 1.0 / (clothAxesSquared * clothAxesSquared));
  clothAniso = clothAnisoColor.rgb / (3.141593 * clothAxesSquared.x * clothAxesSquared.y * clothQ * clothQ);
}`
		: ''
}
${cloth.root === 'home' ? 'clothAniso *= mix(diffuseColor.rgb, vec3(1.0), clothAnisoBaseMix);' : ''}
${
	cloth.advanced
		? `vec3 clothReflection = mix(clothReflectDark, clothReflectBase, clothAO);
float clothNearFade = min(1.0 - clamp((length(vViewPosition) - 50.0) / 300.0, 0.0, 1.0) + 0.2, 1.0);
clothAniso *= clothAnisoColor.rgb * clothReflection * clothNearFade;
diffuseColor.rgb += clothReflection;`
		: ''
}
clothShadowBase = diffuseColor.rgb + clothAniso;
diffuseColor.rgb = clamp(clothShadowBase + clothEdge, 0.0, 1.0);
${
	cloth.opacitySource === 'diffuse-alpha'
		? 'diffuseColor.a = clamp(clothD.a * mix(clothOpacity.x, clothOpacity.y, pow(clothF, clothOpacity.z)), 0.0, 1.0);'
		: cloth.opacitySource === 'sss-scalar'
			? 'diffuseColor.a = clothOpacity.x;'
			: 'diffuseColor.a = 1.0;'
}
#include <alphatest_fragment>
#include <color_fragment>`,
			)
			.replace(
				'#include <emissivemap_fragment>',
				`totalEmissiveRadiance =
  (clothAniso * clothAnisoColor.a + clothEdge * clothEdgeColor.a) * clothAO + clothOrm.a * clothEmissive;
// Native ColorInShadow consumes scene key direction. First editor directional
// light substitutes that input; no directional light means no added scene term.
#if NUM_DIR_LIGHTS > 0
totalEmissiveRadiance += clothShadowBase * clothShadowColor * (1.0 - dot(normal, directionalLights[0].direction));
#endif
// Native edge/aniso emission alpha can be negative. Preserve cancellation;
// display tonemapping happens after reflected + emitted light, not here.
#if defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)
totalEmissiveRadiance *= vColor;
#endif`,
			)
			.replace(
				'#include <aomap_fragment>',
				ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'clothAO'),
			);
	};
	// Structure, not source IDs, defines the program. Instance scalar/colors live
	// in uniforms; sample folding/coverage/root are real compiled differences.
	material.customProgramCacheKey = () =>
		`cloth_v2_${cloth.root}_${cloth.textureActive.join('_')}_${cloth.fourthRole}_${cloth.palette}_${cloth.advanced}_${cloth.opacitySource}_${cloth.mainUvChannel}_${cloth.maskUvChannel}_${extraUV.has(2)}_${aniso}_${cloth.normalFaceSign ?? 'unproved'}${cloth.normalOutputFaceSign ? '_output-face' : ''}`;
	return material;
}
