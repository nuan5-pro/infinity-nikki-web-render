import {
	Color,
	MeshStandardMaterial,
	NoColorSpace,
	SRGBColorSpace,
	ClampToEdgeWrapping,
	MirroredRepeatWrapping,
	RepeatWrapping,
	NearestFilter,
	LinearFilter,
	LinearMipmapLinearFilter,
	ShaderChunk,
	Vector3,
	Vector4,
	type Texture,
	type Material,
	type BufferGeometry,
} from 'three';

type Vec4 = [number, number, number, number];

type Vec3 = [number, number, number];

export interface CabinetStaticProfile {
	family: 'int-static-native';
	version: 1;
	pixelShader: string;
	color: Vec4;
	attribute: Vec4;
	detailNormal: Vec4;
	patternUV: Vec4;
	patternTransform: Vec4;
	patternBlend: Vec4;
	normalIntensity: number;
	patternNormalIntensity: number;
	useORMChannel: number;
	specular: number;
	ao: number;
	emissionTint: Vec3;
	patternEmissionTint: Vec3;
	requiredUV: number[];
	second?: {
		uv: Vec4;
		transform: Vec4;
		blend: Vec4;
		roughness: number;
		metalness: number;
		height: number;
		emission: number;
	};
	textures: Record<
		string,
		{
			parameter: string;
			sRGB: boolean;
			mipmaps: boolean;
			nearest: boolean;
			address: [string, string];
			encoding: 'rgba' | 'native-rg';
			sampler: 'view-world-wrap';
		}
	>;
}

const finiteArray = (value: unknown, count: number) => Array.isArray(value) && value.length === count && value.every(Number.isFinite);

function cabinetRoles(profile: CabinetStaticProfile) {
	return ['D', 'N', 'O', 'N1', 'D1', 'N2', 'O1', 'T', 'T1', ...(profile.second ? ['D2', 'B'] : [])];
}

export function readFurnitureCabinetStatic(value: unknown): CabinetStaticProfile | null {
	if (!value || typeof value !== 'object') return null;

	try {
		const profile = value as CabinetStaticProfile;
		validateCabinetStaticProfile(profile);
		return profile;
	} catch {
		return null;
	}
}

export function validateCabinetStaticProfile(profile: CabinetStaticProfile) {
	if (
		profile.family !== 'int-static-native' ||
		profile.version !== 1 ||
		![
			'eab4a66a4e3a0c21d9fc1b2386340fb3bc1fe379',
			'026f3f517c5ee1239861f3c12e91d77dd0c08e9a',
		].includes(profile.pixelShader)
	) throw new Error('[CabinetStatic] unproved native consumer');

	for (const value of [
		profile.color,
		profile.attribute,
		profile.detailNormal,
		profile.patternUV,
		profile.patternTransform,
		profile.patternBlend,
	]) {
		if (!finiteArray(value, 4)) throw new Error('[CabinetStatic] invalid native vector');
	}

	if (
		!finiteArray(profile.emissionTint, 3) ||
		!finiteArray(profile.patternEmissionTint, 3) ||
		![
			profile.normalIntensity,
			profile.patternNormalIntensity,
			profile.useORMChannel,
			profile.specular,
			profile.ao,
		].every(Number.isFinite)
	) throw new Error('[CabinetStatic] invalid native scalar');

	if (profile.second) {
		if (
			!finiteArray(profile.second.uv, 4) ||
			!finiteArray(profile.second.transform, 4) ||
			!finiteArray(profile.second.blend, 4) ||
			![
				profile.second.roughness,
				profile.second.metalness,
				profile.second.height,
				profile.second.emission,
			].every(Number.isFinite) ||
			profile.second.height !== 0
		) throw new Error('[CabinetStatic] unimplemented native second-layer parallax');
	}

	if (!!profile.second !== (profile.pixelShader === 'eab4a66a4e3a0c21d9fc1b2386340fb3bc1fe379')) throw new Error('[CabinetStatic] consumer structure conflict');

	const required = [0];
	for (let channel = 1; channel < 4; channel++) {
		if (
			profile.patternUV[channel] !== 0 ||
			(channel === 1 && profile.detailNormal[0] !== 0) ||
			(profile.second && profile.second.uv[channel] !== 0)
		)
			required.push(channel);
	}

	if (
		!Array.isArray(profile.requiredUV) ||
		required.join(',') !== profile.requiredUV.join(',') ||
		profile.specular !== 0.5
	) throw new Error('[CabinetStatic] native UV or specular contract conflict');

	for (const role of cabinetRoles(profile)) {
		const texture = profile.textures?.[role];
		if (
			!texture ||
			!texture.parameter ||
			texture.sampler !== 'view-world-wrap' ||
			![texture.sRGB, texture.mipmaps, texture.nearest].every((value) => typeof value === 'boolean') ||
			!Array.isArray(texture.address) ||
			texture.address.length !== 2 ||
			!texture.address.every((value) => ['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(value))
		) throw new Error(`[CabinetStatic] invalid native texture contract ${role}`);

		const normal = ['N', 'N1', 'N2', 'B'].includes(role);
		if (normal ? texture.encoding !== 'native-rg' || texture.sRGB : texture.encoding !== 'rgba') throw new Error(`[CabinetStatic] native texture encoding conflict ${role}`);
	}
}

export function assertCabinetStaticGeometry(geometry: BufferGeometry, profile: CabinetStaticProfile) {
	const count = geometry.getAttribute('position')?.count;
	for (const [name, size] of [
		['normal', 3],
		['tangent', 4],
		...profile.requiredUV.map((channel) => [channel === 0 ? 'uv' : `uv${channel}`, 2]),
	] as Array<[string, number]>) {
		const attribute = geometry.getAttribute(name);
		if (!count || !attribute || attribute.itemSize !== size || attribute.count !== count) throw new Error(`[CabinetStatic] missing native geometry ${name}`);
	}
}

export function createCabinetStaticMaterial(
	profile: CabinetStaticProfile,
	inputs: Record<string, Texture | null | undefined>,
	source: Material,
) {
	validateCabinetStaticProfile(profile);

	const original = source as MeshStandardMaterial;
	if (!original.isMeshStandardMaterial || !original.normalScale.x || !original.normalScale.y) throw new Error('[CabinetStatic] original loader tangent phase is required');

	const roles = cabinetRoles(profile);
	for (const role of roles) {
		if (!inputs[role]) throw new Error(`[CabinetStatic] missing native source role ${role}`);
	}

	const owned: Texture[] = [];
	const sampling: Record<string, Texture> = {};

	const wrap = (value: string) => {
		switch (value) {
		case 'TA_Clamp':
			return ClampToEdgeWrapping;
		case 'TA_Mirror':
			return MirroredRepeatWrapping;
		case 'TA_Wrap':
			return RepeatWrapping;
		default:
			throw new Error('[CabinetStatic] invalid native sampler address');
		}
	};

	for (const role of roles) {
		const sourceTexture = inputs[role];
		const contract = profile.textures[role];
		if (!sourceTexture || !contract) throw new Error(`[CabinetStatic] missing native source role ${role}`);
		if (
			['N', 'N1', 'N2', 'B'].includes(role) &&
			(contract.encoding !== 'native-rg' || contract.sRGB)
		) throw new Error(`[CabinetStatic] source RG normal transport required: ${role}`);

		const texture = sourceTexture.clone();
		texture.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = wrap(contract.address[0]);
		texture.wrapT = wrap(contract.address[1]);
		texture.generateMipmaps = contract.mipmaps;
		texture.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = contract.nearest
			? NearestFilter
			: contract.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		texture.needsUpdate = true;
		sampling[role] = texture;
		owned.push(texture);
	}

	const material = new MeshStandardMaterial({
		color: new Color().setRGB(1, 1, 1),
		normalMap: sampling.N,
		transparent: false,
		opacity: 1,
		alphaTest: 0,
		depthWrite: true,
	});
	// Source PNG RG preserves native G; SwapYZ mirrors the exported frame while
	// the loader/merge tangent phase remains a separate sign.
	material.normalScale.set(original.normalScale.x < 0 ? -1 : 1, original.normalScale.y < 0 ? 1 : -1);
	material.name = source.name;
	material.side = source.side;
	material.depthTest = source.depthTest;
	material.colorWrite = source.colorWrite;
	material.toneMapped = source.toneMapped;
	material.visible = source.visible;
	material.flatShading = original.flatShading;
	material.userData = { ...source.userData, cabinetStatic: profile };
	material.addEventListener('dispose', () => owned.forEach((texture) => texture.dispose()));
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		assertCabinetStaticGeometry(geometry, profile);
	};
	material.onBeforeCompile = (shader) => {
		const vectors = {
			cabinetColor: profile.color,
			cabinetAttribute: profile.attribute,
			cabinetDetail: profile.detailNormal,
			cabinetPatternUV: profile.patternUV,
			cabinetPatternTransform: profile.patternTransform,
			cabinetBlend: profile.patternBlend,
		};

		for (const [name, value] of Object.entries(vectors))
			shader.uniforms[name] = { value: new Vector4(...value) };

		shader.uniforms.cabinetEmissionTint = { value: new Vector3(...profile.emissionTint) };
		shader.uniforms.cabinetPatternEmissionTint = {
			value: new Vector3(...profile.patternEmissionTint),
		};
		for (const [name, value] of Object.entries({
			cabinetNormalIntensity: profile.normalIntensity,
			cabinetPatternNormalIntensity: profile.patternNormalIntensity,
			cabinetUseORM: profile.useORMChannel,
			cabinetAO: profile.ao,
		}))
			shader.uniforms[name] = { value };

		for (const role of roles) shader.uniforms[`cabinet${role}`] = { value: sampling[role] };

		if (profile.second) {
			shader.uniforms.cabinetSecondUV = { value: new Vector4(...profile.second.uv) };
			shader.uniforms.cabinetSecondTransform = { value: new Vector4(...profile.second.transform) };
			shader.uniforms.cabinetSecondBlend = { value: new Vector4(...profile.second.blend) };
			shader.uniforms.cabinetSecondProperties = {
				value: new Vector3(profile.second.roughness, profile.second.metalness, profile.second.emission),
			};
		}

		const declarations = [1, 2, 3]
			.filter((channel) => profile.requiredUV.includes(channel))
			.map((channel) => `#ifndef USE_UV${channel}\nattribute vec2 uv${channel};\n#endif`)
			.join('\n');

		const uvValue = (channel: number) => profile.requiredUV.includes(channel) ? (channel === 0 ? 'uv' : `uv${channel}`) : 'vec2(0.0)';

		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>\n${declarations}\nvarying vec4 vCabinetUV01;\nvarying vec4 vCabinetUV23;`,
			)
			.replace(
				'#include <uv_vertex>',
				`#include <uv_vertex>\nvCabinetUV01 = vec4(uv, ${uvValue(1)});\nvCabinetUV23 = vec4(${uvValue(2)}, ${uvValue(3)});`,
			);

		const secondDeclarations = profile.second
			? 'uniform vec4 cabinetSecondUV, cabinetSecondTransform, cabinetSecondBlend;\nuniform vec3 cabinetSecondProperties;'
			: '';
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			`#include <common>
varying vec4 vCabinetUV01, vCabinetUV23;
${Object.keys(vectors)
	.map((name) => `uniform vec4 ${name};`)
	.join('\n')}
uniform vec3 cabinetEmissionTint, cabinetPatternEmissionTint;
uniform float cabinetNormalIntensity, cabinetPatternNormalIntensity, cabinetUseORM, cabinetAO;
${roles.map((role) => `uniform sampler2D cabinet${role};`).join('\n')}
${secondDeclarations}
vec4 cabinetBase, cabinetPattern, cabinetMask, cabinetSecond;
vec2 cabinetPatternCoords;
vec3 cabinetNormal, cabinetEmission;
float cabinetMetal, cabinetRough;
vec2 cabinetUV(vec4 weights, vec4 transform) {
  return (vCabinetUV01.xy * weights.x + vCabinetUV01.zw * weights.y + vCabinetUV23.xy * weights.z + vCabinetUV23.zw * weights.w) * transform.xy + transform.zw;
}
vec3 cabinetDecode(vec2 encoded, float intensity, bool scaleZ) {
  vec2 xy = encoded * 2.0 - 1.0;
  vec2 zXY = xy * (scaleZ ? clamp(intensity, 0.0, 1.0) : 1.0);
  return vec3(xy * intensity, sqrt(max(1.0 - dot(zXY,zXY), 0.0)));
}
vec3 cabinetRNM(vec3 base, vec3 detail) {
  vec3 t = base + vec3(0.0,0.0,1.0);
  vec3 u = detail * vec3(-1.0,-1.0,1.0);
  return t * dot(t,u) - u * t.z;
}`,
		);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <map_fragment>',
				`
cabinetPatternCoords = cabinetUV(cabinetPatternUV, cabinetPatternTransform);
cabinetBase = texture2D(cabinetD, vCabinetUV01.xy);
cabinetPattern = texture2D(cabinetD1, cabinetPatternCoords);
cabinetMask = texture2D(cabinetO, vCabinetUV01.xy);
vec3 cabinetTintedBase = cabinetBase.rgb * cabinetColor.rgb;
vec3 cabinetPatternColor = mix(cabinetPattern.rgb, cabinetPattern.rgb * cabinetTintedBase, clamp(cabinetBlend.x - 1.0, 0.0, 1.0));
diffuseColor.rgb = mix(cabinetTintedBase, cabinetPatternColor, cabinetPattern.a * clamp(cabinetBlend.x, 0.0, 1.0));
cabinetMetal = mix(cabinetAttribute.x, cabinetAttribute.y, cabinetMask.r);
float cabinetGloss = mix(cabinetAttribute.z, cabinetAttribute.w, cabinetMask.g);
vec3 cabinetPatternAttribute = texture2D(cabinetO1, cabinetPatternCoords).rgb;
vec2 cabinetPatternMG = mix(cabinetPatternAttribute.rg, cabinetPatternAttribute.bg, cabinetUseORM);
vec2 cabinetMG = mix(vec2(cabinetMetal, cabinetGloss), cabinetPatternMG, cabinetPattern.a * cabinetBlend.w);
cabinetMetal = cabinetMG.x;
cabinetRough = 1.0 - cabinetMG.y;
vec4 cabinetEmissionSample = texture2D(cabinetT, vCabinetUV01.xy);
vec4 cabinetPatternEmissionSample = texture2D(cabinetT1, cabinetPatternCoords);
cabinetEmission = cabinetEmissionSample.rgb * cabinetEmissionSample.a * cabinetEmissionTint + cabinetPatternEmissionSample.rgb * cabinetPatternEmissionSample.a * cabinetPatternEmissionTint;
${
	profile.second
		? `
vec2 cabinetSecondCoords = cabinetUV(cabinetSecondUV, cabinetSecondTransform);
cabinetSecond = texture2D(cabinetD2, cabinetSecondCoords);
vec3 cabinetSecondWeights = clamp(cabinetSecond.a * cabinetSecondBlend.xyz, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, cabinetSecond.rgb, cabinetSecondWeights.x);
// Exact eab4a66 ASM277-279 cross-target operands; authored Gloss/Metallic names
// do not justify swapping the native output coefficients.
vec2 cabinetSecondMG = mix(vec2(cabinetMetal, cabinetRough), cabinetSecondProperties.xy, cabinetSecondWeights.y);
cabinetMetal = cabinetSecondMG.x;
cabinetRough = cabinetSecondMG.y;
cabinetEmission = mix(cabinetSecond.rgb * cabinetSecondProperties.z, cabinetEmission, cabinetSecondBlend.w);`
		: ''
}
diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 1.0);
diffuseColor.a = 1.0;
cabinetMetal = clamp(cabinetMetal, 0.0, 1.0);
cabinetRough = clamp(cabinetRough, 0.0, 1.0);`,
			)
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = cabinetRough;')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = cabinetMetal;')
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
#ifdef USE_NORMALMAP_TANGENTSPACE
cabinetNormal = cabinetDecode(texture2D(cabinetN, vCabinetUV01.xy).rg, cabinetNormalIntensity, false);
vec2 cabinetDetailCoords = mix(vCabinetUV01.xy, vCabinetUV01.zw, cabinetDetail.x) * cabinetDetail.yz;
vec3 cabinetDetailN = cabinetDecode(texture2D(cabinetN1, cabinetDetailCoords).rg, cabinetDetail.w, true);
cabinetNormal = cabinetRNM(cabinetNormal, cabinetDetailN);
vec3 cabinetPatternBaseN = mix(vec3(0.0,0.0,1.0), cabinetNormal, cabinetBlend.z);
vec3 cabinetPatternN = cabinetDecode(texture2D(cabinetN2, cabinetPatternCoords).rg, cabinetPatternNormalIntensity, true);
cabinetNormal = mix(cabinetNormal, cabinetRNM(cabinetPatternBaseN, cabinetPatternN), cabinetPattern.a);
${
	profile.second
		? `vec3 cabinetSecondN = cabinetDecode(texture2D(cabinetB, cabinetSecondCoords).rg, 1.0, false);
cabinetNormal = mix(cabinetNormal, cabinetSecondN, cabinetSecondWeights.z);`
		: ''
}
cabinetNormal.xy *= normalScale;
normal = normalize(tbn * normalize(cabinetNormal));
#endif`,
			)
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = cabinetEmission;')
			.replace(
				'#include <aomap_fragment>',
				'reflectedLight.indirectDiffuse *= clamp(cabinetAO, 0.0, 1.0);',
			);
	};
	material.customProgramCacheKey = () => `cabinet-static-2:${profile.pixelShader}:${profile.requiredUV.join(',')}`;
	return material;
}
