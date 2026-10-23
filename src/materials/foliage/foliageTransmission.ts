import { MeshStandardMaterial, ShaderChunk, Vector3, Vector4, type Material, type Texture } from 'three';

interface TransmissionBase {
	colorA: [number, number, number];
	colorB: [number, number, number];
	baseColorInfluence: number;
	albedo?: { role: 'D1'; uvScale: number };
}

export interface FoliageMaskStepTransmission extends TransmissionBase {
	model: 'mask-step';
	stepMask: number;
	threshold: number;
	singleSided: number;
	mask?: { role: 'O' | 'O1'; uvScale: number };
}

export interface FoliageFaceMaskTransmission extends TransmissionBase {
	model: 'face-mask';
	mask: { role: 'O' | 'O1'; uvScale: number; channel?: 'g' | 'b' };
	vertex?: { base: [number, number, number]; min: number; max: number; power: number };
	cycle?: true;
}

export type FoliageTransmission = FoliageMaskStepTransmission | FoliageFaceMaskTransmission;

const configured = new WeakSet<Material>();

/** Static two-sided foliage scattering, using the scene's shadowed lights and
 * reverse-normal diffuse irradiance. Source color is linear, not emissive. */
export function applyFoliageTransmission<T extends Material>(material: T, mask?: Texture, albedo?: Texture): T {
	const transmission = material.userData.render?.foliageTransmission as FoliageTransmission | undefined;
	if (!transmission || configured.has(material)) return material;
	if (transmission.model !== 'mask-step' && transmission.model !== 'face-mask') throw new Error('[Furniture] Unsupported foliage transmission model');
	if (!(material instanceof MeshStandardMaterial)) throw new Error('[Furniture] Foliage transmission requires PBR');
	if (transmission.mask && !mask) throw new Error('[Furniture] Foliage transmission requires its source mask');
	if (transmission.albedo && !albedo) throw new Error('[Furniture] Foliage transmission requires its source albedo');
	const hasUv = !!transmission.mask || !!transmission.albedo;
	const albedoFactor = transmission.baseColorInfluence === 0 ? 'vec3(1.0)' : 'mix(vec3(1.0),foliageTransmissionAlbedo,foliageTransmissionBaseColor)';
	const vertex = transmission.model === 'face-mask' ? transmission.vertex : undefined;
	const maskChannel = transmission.model === 'face-mask' ? transmission.mask.channel ?? 'g' : 'g';
	const cycle = transmission.model === 'face-mask' && transmission.cycle;
	if (cycle && !material.userData.foliage?.home?.cycle) throw new Error('[Furniture] Foliage transmission requires its native cycle atlas');
	configured.add(material);
	if (vertex) {
		const render = material.onBeforeRender;
		const checked = new WeakSet<object>();
		material.onBeforeRender = function (...args) {
			render.apply(this, args);
			const geometry = args[3];
			if (checked.has(geometry)) return;
			const red = geometry.getAttribute('foliageRed');
			if (!red || red.itemSize !== 1 || red.count !== geometry.getAttribute('position').count) throw new Error('[Furniture] Foliage transmission requires source red');
			checked.add(geometry);
		};
	}
	const compile = material.onBeforeCompile;
	const key = material.customProgramCacheKey();
	material.onBeforeCompile = function (shader, renderer) {
		compile.call(this, shader, renderer);
		shader.uniforms.foliageTransmissionColorA = { value: new Vector3(...transmission.colorA) };
		shader.uniforms.foliageTransmissionColorB = { value: new Vector3(...transmission.colorB) };
		shader.uniforms.foliageTransmissionBaseColor = { value: transmission.baseColorInfluence };
		shader.uniforms.foliageTransmissionParams = { value: new Vector4(transmission.model === 'mask-step' ? transmission.stepMask : 0, transmission.model === 'mask-step' ? transmission.threshold : 0, transmission.model === 'mask-step' ? transmission.singleSided : 0, transmission.mask?.uvScale ?? 1) };
		if (transmission.mask) shader.uniforms.foliageTransmissionMask = { value: mask };
		if (transmission.albedo) {
			shader.uniforms.foliageTransmissionAlbedoMap = { value: albedo };
			shader.uniforms.foliageTransmissionAlbedoScale = { value: transmission.albedo.uvScale };
		}
		if (hasUv) {
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nvarying vec2 vFoliageTransmissionUv;')
				.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFoliageTransmissionUv=uv;');
		}
		if (vertex) {
			shader.uniforms.foliageTransmissionVertexBase = { value: new Vector3(...vertex.base) };
			shader.uniforms.foliageTransmissionVertexParams = { value: new Vector3(vertex.min, vertex.max, vertex.power) };
			const attribute = shader.vertexShader.includes('attribute float foliageRed;') ? '' : 'attribute float foliageRed;';
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', `#include <common>\n${attribute}\nvarying float vFoliageTransmissionRed;`)
				.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoliageTransmissionRed=foliageRed;');
		}
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 foliageTransmissionColorA, foliageTransmissionColorB;
uniform float foliageTransmissionBaseColor;
uniform vec4 foliageTransmissionParams;
${hasUv ? 'varying vec2 vFoliageTransmissionUv;' : ''}
${transmission.mask ? 'uniform sampler2D foliageTransmissionMask;' : ''}
${transmission.albedo ? 'uniform sampler2D foliageTransmissionAlbedoMap; uniform float foliageTransmissionAlbedoScale;' : ''}
${vertex ? 'uniform vec3 foliageTransmissionVertexBase, foliageTransmissionVertexParams; varying float vFoliageTransmissionRed;' : ''}
vec3 foliageTransmissionAlbedo;
vec3 foliageTransmission;
vec3 foliageBackIrradiance;
// UE TwoSidedBxDF uses wrap=.5 and a GGX scattering lobe of roughness .6.
vec3 foliageDirectTransmission(vec3 lightColor, vec3 L, vec3 N, vec3 V) {
  float wrapNoL=clamp((-dot(N,L)+0.5)/2.25,0.0,1.0);
  float cosTheta=clamp(-dot(V,L),0.0,1.0);
  float a2=0.36;
  float d=(cosTheta*a2-cosTheta)*cosTheta+1.0;
  float scatter=a2/(PI*d*d);
  return lightColor*wrapNoL*scatter*foliageTransmission;
}`);
		// All three consumers use the selected source D sample here, before their
		// tint, gradient, instance highlight or standard material color factors.
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <map_fragment>', ShaderChunk.map_fragment)
			.replace('diffuseColor *= sampledDiffuseColor;', `${transmission.baseColorInfluence !== 0 && !transmission.albedo ? 'foliageTransmissionAlbedo=sampledDiffuseColor.rgb;' : ''}\ndiffuseColor *= sampledDiffuseColor;`)
			.replace('void main() {', `void main() {
foliageTransmissionAlbedo=vec3(1.0);
${transmission.mask ? 'vec2 foliageSssUv=vFoliageTransmissionUv*foliageTransmissionParams.w;\nvec2 foliageSssDx=dFdx(foliageSssUv), foliageSssDy=dFdy(foliageSssUv);' : ''}
${transmission.albedo ? 'vec2 foliageSssAlbedoUv=vFoliageTransmissionUv*foliageTransmissionAlbedoScale;\nvec2 foliageSssAlbedoDx=dFdx(foliageSssAlbedoUv), foliageSssAlbedoDy=dFdy(foliageSssAlbedoUv);' : ''}`);
		const direct = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
		const begin = ShaderChunk.lights_fragment_begin
			.split(direct).join(`${direct}\nreflectedLight.directDiffuse += foliageDirectTransmission(directLight.color, directLight.direction, geometryNormal, geometryViewDir);`)
			.replace('vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );', 'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );\nfoliageBackIrradiance = irradiance;')
			.replace('irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );', 'irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );\nfoliageBackIrradiance += getLightProbeIrradiance(lightProbe, -geometryNormal);')
			.replace('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );\nfoliageBackIrradiance += getHemisphereLightIrradiance(hemisphereLights[i], -geometryNormal);');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <lights_fragment_begin>', `
// Match the GBuffer subsurface color range after the authored extrapolation.
float foliageSssSign=gl_FrontFacing?1.0:-1.0;
${transmission.albedo ? 'foliageTransmissionAlbedo=textureGrad(foliageTransmissionAlbedoMap,foliageSssAlbedoUv,foliageSssAlbedoDx,foliageSssAlbedoDy).rgb;' : ''}
${transmission.mask ? 'vec4 foliageSssMask=textureGrad(foliageTransmissionMask,foliageSssUv,foliageSssDx,foliageSssDy);' : ''}
${transmission.model === 'mask-step' ? `
${transmission.mask ? `float foliageSssWeight=mix(foliageSssMask.g,step(foliageSssMask.g,foliageTransmissionParams.y),foliageTransmissionParams.x);
vec3 foliageSssColor=mix(foliageTransmissionColorA,foliageTransmissionColorB,foliageSssWeight);` : 'vec3 foliageSssColor=foliageTransmissionColorA;'}
foliageTransmission=foliageSssColor*${albedoFactor}*(1.0-foliageSssSign*foliageTransmissionParams.z);` : `
foliageTransmission=foliageSssMask.${transmission.mask.channel ?? 'g'}*mix(foliageTransmissionColorB,foliageTransmissionColorA,clamp(foliageSssSign,0.0,1.0))*${albedoFactor};
${vertex ? `float foliageSssQ=mix(foliageTransmissionVertexParams.x,foliageTransmissionVertexParams.y,vFoliageTransmissionRed);
float foliageSssW=foliageSssQ>0.0?min(pow(foliageSssQ,foliageTransmissionVertexParams.z),1.0):0.0;
foliageTransmission=mix(foliageTransmissionVertexBase,foliageTransmission,foliageSssW);` : ''}
${cycle ? 'foliageTransmission*=mix(vec3(1.0),foliageCycleColor,foliageSssMask.a);' : ''}`}
foliageTransmission=clamp(foliageTransmission,0.0,1.0);
${begin}`)
			.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
foliageBackIrradiance += getIBLIrradiance(-geometryNormal);
#endif
reflectedLight.indirectDiffuse += max(foliageBackIrradiance,vec3(0.0))*foliageTransmission*RECIPROCAL_PI;`);
	};
	material.customProgramCacheKey = () => `${key}:foliage-transmission-v4:${transmission.model}:${maskChannel}:${!!transmission.mask}:${!!transmission.albedo}:${transmission.baseColorInfluence === 0}:${!!vertex}:${!!cycle}`;
	return material;
}
