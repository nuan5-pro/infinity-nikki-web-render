import {
	LinearFilter,
	LinearMipmapLinearFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector4,
	type MeshStandardMaterial,
	type Texture,
} from 'three';

export interface FurnitureWaterGlintDetail {
	version: 1
	family: 'water-glint-detail'
	flowUv: [number, number, number, number]
	detailUv: [number, number, number, number]
	flowIntensity: number
	detailFlow: number
	detailNormal: number
	normal: number
	textures: Record<
		string,
		{ parameter: string; sRGB: boolean; mipmaps: boolean; bc5ZeroB?: boolean }
	>
	approximation?: string
}

export function readFurnitureWaterGlintDetail(value: unknown): FurnitureWaterGlintDetail | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureWaterGlintDetail;
	if (
		p.version !== 1 ||
		p.family !== 'water-glint-detail' ||
		!p.textures ||
		![p.flowUv, p.detailUv].every((uv) => Array.isArray(uv) && uv.length === 4 && uv.every(Number.isFinite)) ||
		![p.flowIntensity, p.detailFlow, p.detailNormal, p.normal].every(Number.isFinite)
	) return null;

	for (const [role, key] of [
		['O', 'DetailTexWaveNormal(Linear)'],
		['T', 'FlowMap'],
	]) {
		const t = p.textures[role!];
		if (!t || t.parameter !== key || typeof t.sRGB !== 'boolean' || typeof t.mipmaps !== 'boolean') return null;
	}

	return p;
}

/** Add the reviewed static four-read flow/RNM core to the existing water pass. */
export function applyWaterGlintDetail(
	material: MeshStandardMaterial,
	p: FurnitureWaterGlintDetail,
	textures: Partial<Record<string, Texture | null>>,
): void {
	if (!readFurnitureWaterGlintDetail(p) || material.userData.water?.core !== 'glint') throw new Error('WaterGlintDetail requires its source water core');

	const bound: Record<string, Texture> = {};
	for (const role of ['O', 'T']) {
		if (!textures[role]) throw new Error(`WaterGlintDetail missing ${role}`);

		const source = p.textures[role]!;
		const texture = textures[role]!.clone();
		texture.colorSpace = source.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = texture.wrapT = RepeatWrapping;
		texture.generateMipmaps = source.mipmaps;
		texture.minFilter = source.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
		texture.magFilter = LinearFilter;
		texture.flipY = false;
		texture.needsUpdate = true;
		bound[role] = texture;
	}

	material.addEventListener('dispose', () => Object.values(bound).forEach((texture) => texture.dispose()));

	const previous = material.onBeforeCompile.bind(material);
	const previousKey = material.customProgramCacheKey.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previous(shader, renderer);
		shader.uniforms.wgdFlow = { value: bound.T };
		shader.uniforms.wgdDetail = { value: bound.O };
		shader.uniforms.wgdFlowUV = { value: new Vector4(...p.flowUv) };
		shader.uniforms.wgdDetailUV = { value: new Vector4(...p.detailUv) };
		shader.uniforms.wgdIntensity = {
			value: new Vector4(p.flowIntensity, p.detailFlow, p.detailNormal, p.normal),
		};
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec2 vWGDuv;')
			.replace('#include <project_vertex>', '#include <project_vertex>\nvWGDuv=uv;');

		const sample = 'vec4 waterSample = vec4(1.0);';
		const normal = 'vec2 waterRG = texture2D(normalMap, vWaterNormalUv).rg * 2.0 - 1.0;';
		if (!shader.fragmentShader.includes(sample) || !shader.fragmentShader.includes(normal)) throw new Error('WaterGlintDetail source hooks changed');

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform sampler2D wgdFlow,wgdDetail;
uniform vec4 wgdFlowUV,wgdDetailUV,wgdIntensity;
varying vec2 vWGDuv;`,
			)
			.replace(
				sample,
				`${sample}
vec2 wgdVector=(texture2D(wgdFlow,vWGDuv*wgdFlowUV.xy+wgdFlowUV.zw).rg-.5)*vec2(-2.0,2.0);
vec2 wgdBaseUV=vWaterUv+wgdVector*.5*wgdIntensity.x;`,
			)
			.replace('texture2D( map, vWaterUv )', 'texture2D( map, wgdBaseUV )')
			.replace(
				normal,
				'vec2 waterRG = texture2D(normalMap, vWaterNormalUv+wgdVector*.5*wgdIntensity.x).rg * 2.0 - 1.0;',
			)
			.replace(
				'mapN.xy *= normalScale;',
				`
mapN.xy*=wgdIntensity.w;
vec3 wgdDetailN=texture2D(wgdDetail,vWGDuv*wgdDetailUV.xy+wgdDetailUV.zw+wgdVector*.5*wgdIntensity.x*wgdIntensity.y).rgb;
${p.textures.O!.bc5ZeroB ? 'wgdDetailN.z=0.0;' : ''}
wgdDetailN.xy*=wgdIntensity.z;
vec3 wgdT=mapN+vec3(0,0,1),wgdU=wgdDetailN*vec3(-1,-1,1);
mapN=normalize(wgdT*dot(wgdT,wgdU)-wgdU*wgdT.z);
mapN.xy*=sign(normalScale);`,
			);
	};
	material.userData.waterGlintDetail = p;
	material.customProgramCacheKey = () => `${previousKey()}_glint-flow-static-rnm-v1_${!!p.textures.O!.bc5ZeroB}`;
	material.needsUpdate = true;
}
