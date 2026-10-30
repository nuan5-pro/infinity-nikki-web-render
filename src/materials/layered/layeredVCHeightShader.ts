import {
	Color,
	MeshStandardMaterial,
	NoColorSpace,
	SRGBColorSpace,
	RepeatWrapping,
	ClampToEdgeWrapping,
	MirroredRepeatWrapping,
	NearestFilter,
	LinearFilter,
	LinearMipmapLinearFilter,
	ShaderChunk,
	Vector2,
	Vector3,
	Vector4,
	type Material,
	type Texture,
	type BufferGeometry,
} from 'three';
import type { FurnitureLayered, LayeredRole } from './layeredShader.js';

export interface LayeredVCHeight {
	pixelShader: '07385a259233546134b62ca90e44aa6ba38dbbd6';
	edgeTiling: number;
	edgeContrast: number;
	edgeIntensity: number;
	aoRange: [[number, number], [number, number]];
	baseColorAO: [number, number];
	aoChannels: [number, number, number, number];
	aoAtlas: [number, number, number];
	specular: [number, number];
}

const nativeRoles: LayeredRole[] = ['D', 'N', 'O', 'D1', 'N1', 'O1', 'B', 'C'];

const finite = (value: unknown, length: number) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

export function validLayeredVCHeight(config: FurnitureLayered) {
	const p = config.vcHeight;
	return (
		!!p &&
		p.pixelShader === '07385a259233546134b62ca90e44aa6ba38dbbd6' &&
		[p.edgeTiling, p.edgeContrast, p.edgeIntensity].every(Number.isFinite) &&
		Array.isArray(p.aoRange) &&
		p.aoRange.length === 2 &&
		p.aoRange.every((value) => finite(value, 2)) &&
		finite(p.baseColorAO, 2) &&
		finite(p.aoChannels, 4) &&
		finite(p.aoAtlas, 3) &&
		finite(p.specular, 2) &&
		config.colorMask &&
		config.uvFallback === 'none' &&
		config.requiredUv.includes(1) &&
		nativeRoles.every((role) => !!config.textures[role])
	);
}

export function assertLayeredVCHeightGeometry(geometry: BufferGeometry, config: FurnitureLayered) {
	const count = geometry.getAttribute('position')?.count;
	for (const [name, size] of [
		['normal', 3],
		['tangent', 4],
		['ueLayerColor', 4],
		...config.requiredUv.map((channel) => [channel === 0 ? 'uv' : `uv${channel}`, 2]),
	] as Array<[string, number]>) {
		const attribute = geometry.getAttribute(name);
		if (
			!count ||
			!attribute ||
			attribute.itemSize !== size ||
			attribute.count !== count ||
			(name === 'ueLayerColor' &&
				(attribute.normalized || !(attribute.array instanceof Float32Array)))
		) throw new Error(`[VCHeight] requires original native ${name}`);
	}
}

export function createLayeredVCHeightMaterial(
	config: FurnitureLayered,
	inputs: Partial<Record<LayeredRole, Texture | null>>,
	source: Material,
) {
	if (!validLayeredVCHeight(config)) throw new Error('[VCHeight] invalid native consumer');

	const original = source as MeshStandardMaterial;
	if (!original.isMeshStandardMaterial || !original.normalScale.x || !original.normalScale.y) throw new Error('[VCHeight] source tangent phase required');

	for (const role of nativeRoles)
		if (!inputs[role]) throw new Error(`[VCHeight] missing native ${role}`);

	const p = config.vcHeight!;
	const textures: Partial<Record<LayeredRole, Texture>> = {};
	const owned: Texture[] = [];
	for (const role of nativeRoles) {
		const texture = inputs[role]!.clone();
		const input = config.textures[role]!;
		texture.colorSpace = input.srgb ? SRGBColorSpace : NoColorSpace;

		const wrap = (value: string) =>
			value === 'TA_Clamp'
				? ClampToEdgeWrapping
				: value === 'TA_Mirror'
					? MirroredRepeatWrapping
					: RepeatWrapping;

		texture.wrapS = wrap(input.addressX);
		texture.wrapT = wrap(input.addressY);
		texture.flipY = false;
		texture.generateMipmaps = input.mipmaps;
		texture.minFilter =
			input.filter === 'TF_Nearest'
				? NearestFilter
				: input.mipmaps
					? LinearMipmapLinearFilter
					: LinearFilter;
		texture.magFilter = input.filter === 'TF_Nearest' ? NearestFilter : LinearFilter;
		texture.needsUpdate = true;
		textures[role] = texture;
		owned.push(texture);
	}

	const material = new MeshStandardMaterial({
		color: new Color(1, 1, 1),
		normalMap: textures.N,
		opacity: 1,
		transparent: false,
		alphaTest: 0,
		depthWrite: true,
		vertexColors: false,
		side: source.side,
	});
	material.name = source.name;
	material.userData = { ...source.userData, layered: config };
	material.depthTest = source.depthTest;
	material.colorWrite = source.colorWrite;
	material.toneMapped = source.toneMapped;
	material.visible = source.visible;
	material.flatShading = original.flatShading;
	material.normalScale.set(original.normalScale.x < 0 ? -1 : 1, original.normalScale.y < 0 ? 1 : -1);
	material.addEventListener('dispose', () => owned.forEach((texture) => texture.dispose()));
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => assertLayeredVCHeightGeometry(geometry, config);
	material.onBeforeCompile = (shader) => {
		for (const role of nativeRoles) shader.uniforms[`vc${role}`] = { value: textures[role] };

		shader.uniforms.vcBlend = { value: new Vector4(...config.blend) };
		shader.uniforms.vcEdge = { value: new Vector3(p.edgeTiling, p.edgeContrast, p.edgeIntensity) };
		shader.uniforms.vcUseORM = { value: config.useOrm };
		shader.uniforms.vcAOChannels = { value: new Vector4(...p.aoChannels) };
		shader.uniforms.vcAOAtlas = { value: new Vector3(...p.aoAtlas) };
		shader.uniforms.vcSpecular = { value: new Vector2(...p.specular) };
		for (const [index, layer] of config.layers.entries()) {
			shader.uniforms[`vcUV${index}`] = { value: new Vector4(...layer.uv) };
			shader.uniforms[`vcTiling${index}`] = { value: layer.transform[0] };
			shader.uniforms[`vcTint${index}`] = { value: new Vector3(...layer.color) };
			shader.uniforms[`vcAlbedo${index}`] = { value: new Vector3(...layer.albedo) };
			shader.uniforms[`vcNormal${index}`] = { value: layer.normalIntensity };
			shader.uniforms[`vcRough${index}`] = { value: new Vector2(...layer.roughness) };
			shader.uniforms[`vcAO${index}`] = { value: new Vector2(...p.aoRange[index]!) };
			shader.uniforms[`vcBaseAO${index}`] = { value: p.baseColorAO[index] };
		}

		const declaration = [1, 2, 3]
			.filter((channel) => config.requiredUv.includes(channel))
			.map((channel) => `#ifndef USE_UV${channel}\nattribute vec2 uv${channel};\n#endif`)
			.join('\n');

		const uv = (channel: number) => config.requiredUv.includes(channel) ? `uv${channel}` : 'vec2(0.0)';

		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>\n${declaration}\nattribute vec4 ueLayerColor;\nvarying vec4 vVCUV01, vVCUV23;\nvarying float vVCColorR;`,
			)
			.replace(
				'#include <uv_vertex>',
				`#include <uv_vertex>\nvVCUV01 = vec4(uv,${uv(1)});\nvVCUV23 = vec4(${uv(2)},${uv(3)});\nvVCColorR=ueLayerColor.r;`,
			);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			`#include <common>
varying vec4 vVCUV01, vVCUV23;
varying float vVCColorR;
${nativeRoles.map((role) => `uniform sampler2D vc${role};`).join('\n')}
uniform vec4 vcBlend, vcAOChannels, vcUV0, vcUV1;
uniform vec3 vcEdge, vcAOAtlas, vcTint0, vcTint1, vcAlbedo0, vcAlbedo1;
uniform vec2 vcSpecular, vcRough0, vcRough1, vcAO0, vcAO1;
uniform float vcUseORM, vcTiling0, vcTiling1, vcNormal0, vcNormal1, vcBaseAO0, vcBaseAO1;
vec2 vcCoords0, vcCoords1;
float vcWeight, vcAOFactor, vcMetalFactor, vcRoughFactor, vcSpecFactor;
vec2 vcUV(vec4 weights) { return vVCUV01.xy*weights.x+vVCUV01.zw*weights.y+vVCUV23.xy*weights.z+vVCUV23.zw*weights.w; }
vec3 vcAlbedo(vec3 rgb, vec3 tint, vec3 control, float ao, float bakeAO) {
  rgb *= mix(1.0,ao,bakeAO);
  rgb = mix(vec3(dot(rgb,vec3(0.3,0.59,0.11))),rgb,control.x)*control.y*tint;
  return vec3(rgb.x>0.0?pow(rgb.x,control.z):0.0,rgb.y>0.0?pow(rgb.y,control.z):0.0,rgb.z>0.0?pow(rgb.z,control.z):0.0);
}
vec3 vcDecode(vec2 rg,float intensity) {
  vec2 xy=rg*2.0-1.0;
  return vec3(xy*intensity,sqrt(max(1.0-dot(xy,xy),0.0)));
}`,
		);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <map_fragment>',
				`
vcCoords0=vcUV(vcUV0)*vcTiling0;
vcCoords1=vcUV(vcUV1)*vcTiling1;
vec3 vcPacked0=texture2D(vcO,vcCoords0).rgb;
vec3 vcPacked1=texture2D(vcO1,vcCoords1).rgb;
float vcHeight=mix(1.0-clamp(vcPacked0.b,0.0,1.0),vcPacked1.b+(1.0-vcPacked1.b)*vcUseORM,vcBlend.x)*vcBlend.y;
vcHeight=mix(vcHeight,1.0-vcHeight,vcBlend.w);
float vcEdgeMask=clamp(texture2D(vcB,vVCUV01.xy*vcEdge.x).r*(1.0+2.0*vcEdge.y)-vcEdge.y,0.0,1.0)*vcEdge.z;
vcHeight+=vcHeight*vcEdgeMask*0.5;
vcWeight=clamp(vcHeight-1.0+vVCColorR*2.0,0.0,1.0);
vcWeight=clamp(vcWeight*(1.0+2.0*vcBlend.z)-vcBlend.z,0.0,1.0);
float vcAOValue0=mix(vcAO0.x,vcAO0.y,vcPacked0.r);
float vcAOValue1=mix(vcAO1.x,vcAO1.y,vcPacked1.r);
vec3 vcColor0=vcAlbedo(texture2D(vcD,vcCoords0).rgb,vcTint0,vcAlbedo0,vcAOValue0,vcBaseAO0);
vec3 vcColor1=vcAlbedo(texture2D(vcD1,vcCoords1).rgb,vcTint1,vcAlbedo1,vcAOValue1,vcBaseAO1);
diffuseColor.rgb=clamp(mix(vcColor0,vcColor1,vcWeight),0.0,1.0);
diffuseColor.a=1.0;
vcMetalFactor=clamp(vcWeight*vcPacked1.b*vcUseORM,0.0,1.0);
float vcGlossSpec0=((1.0-vcPacked0.g)-0.5)*vcSpecular.x+0.5;
float vcGlossSpec1=((1.0-vcPacked1.g)-0.5)*vcSpecular.x+0.5;
float vcSourceSpec=mix(vcGlossSpec0,vcGlossSpec1,vcWeight);
vcSpecFactor=clamp(mix(vcSourceSpec,clamp(dot(diffuseColor.rgb,vec3(0.5)),0.0,1.0),vcSpecular.y),0.0,1.0);
vcRoughFactor=clamp(mix(mix(vcRough0.x,vcRough0.y,vcPacked0.g),mix(vcRough1.x,vcRough1.y,vcPacked1.g),vcWeight),0.0,1.0);
vec4 vcAOTexture=texture2D(vcC,vVCUV01.zw*vcAOAtlas.x+vcAOAtlas.yz);
vcAOFactor=clamp(mix(mix(1.0,vcAOValue0,1.0-vcBaseAO0),mix(1.0,vcAOValue1,1.0-vcBaseAO1),vcWeight)*dot(vcAOTexture,vcAOChannels),0.0,1.0);`,
			)
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=vcRoughFactor;')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor=vcMetalFactor;')
			.replace(
				'#include <normal_fragment_begin>',
				ShaderChunk.normal_fragment_begin
					.replace('normal *= faceDirection;', '')
					.replace('tbn[0] *= faceDirection;', '')
					.replace('tbn[1] *= faceDirection;', ''),
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#ifdef USE_NORMALMAP_TANGENTSPACE
vec3 vcN0=vcDecode(texture2D(vcN,vcCoords0).rg,vcNormal0);
vec3 vcN1=vcDecode(texture2D(vcN1,vcCoords1).rg,vcNormal1);
vec3 vcNativeNormal=normalize(mix(vcN0,vcN1,vcWeight));
vcNativeNormal.xy*=normalScale;
normal=normalize(tbn*vcNativeNormal);
#endif`,
			)
			.replace(
				'#include <lights_physical_fragment>',
				'#include <lights_physical_fragment>\nmaterial.specularColor=mix(vec3(0.08*vcSpecFactor),diffuseColor.rgb,metalnessFactor);',
			)
			.replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse*=vcAOFactor;')
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=vec3(0.0);');
	};
	material.customProgramCacheKey = () => 'layered-vcheight-2:07385a259233546134b62ca90e44aa6ba38dbbd6';
	return material;
}
