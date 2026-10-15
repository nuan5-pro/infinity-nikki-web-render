import {
	CompressedArrayTexture,
	MeshDepthMaterial,
	RGBADepthPacking,
	type Material,
	type Texture,
} from 'three';
import { canShareNNCloth2DSampler, canShareNNClothNormalSampler } from './nnclothSamplerState.js';
import type { NNClothShaderABI } from './nnclothCompiledMaterial.js';

/** The captured shadow discard consumer with its separate native noise8 input.
 * Clip transforms/depth packing belong to Three's preview shadow scheduling;
 * this does not use the UE PS oDepth result as a fabricated game shadow map.
 */
export function createNNClothShadowMaterial(
	coverage: string,
	coverageSHA256: string,
	cacheDomain: string,
	textures: Record<string, Texture>,
	abi: NNClothShaderABI,
	source: Material,
) {
	if (
		abi.mode !== 'source-validated-preview' ||
		!abi.vertexDeclarations ||
		!abi.vertexSetupGLSL ||
		!abi.fragmentDeclarations ||
		!abi.bodySetupGLSL ||
		!abi.beforeRender ||
		!/^[a-f0-9]{64}$/.test(coverageSHA256) ||
		!cacheDomain ||
		coverage.includes('nnProbeValue') ||
		!(textures.t17 instanceof CompressedArrayTexture) ||
		!(textures.t17Far instanceof CompressedArrayTexture) ||
		!textures.noise7 ||
		!textures.noise7Shared ||
		!canShareNNClothNormalSampler(textures.t17, textures.t17Far) ||
		!canShareNNCloth2DSampler(textures.noise7, textures.noise7Shared)
	) throw new Error('[NNCloth] original shadow/geometry/state contract incomplete');

	const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
	const probe = { value: -1 };
	material.name = `${source.name}:native-shadow-preview`;
	material.side = source.side;
	material.onBeforeRender = abi.beforeRender;
	material.customProgramCacheKey = () => `nncloth-source-shadow-1:${coverageSHA256}:${cacheDomain}`;

	const resources: Record<string, string> = {
		nn_t2_s2: 't4',
		nn_t14_s0: 't17',
		nn_t14_s5: 't17',
		nn_t1_s0: 't3',
		nn_t3_s0: 't5',
		nn_t4_s0: 't6',
		nn_t5_s0: 't7',
		nn_t6_s0: 't8',
		nn_t7_s0: 't9',
		nn_t8_s0: 't10',
		nn_t9_s1: 't11',
		nn_t10_s0: 't12',
		nn_t11_s0: 't13',
		nn_t13_s4: 'noise8',
		nn_t12_s3: 'noise7',
		nn_t12_s0: 'noise7',
	};

	let body = coverage
		.replace(/uniform sampler(?:2DArray|2D) \w+;\r?\n/g, '')
		.replace(/uniform vec4 nnCB\d+\[\d+\];\r?\n/g, '')
		.replace(/uniform vec4 nnInput\[\d+\];\r?\n/g, '')
		.split('nnCB0')
		.join('nnView')
		.split('nnCB2')
		.join('nnTOD')
		.split('nnCB3')
		.join('nnWeather')
		.split('nnCB1')
		.join('nnUnusedNativeShadowOutput')
		.split('nnInput')
		.join('nnShadowInput');
	body = body.replace(/\bnn_t\d+_s\d+\b/g, (name) => {
		const resource = resources[name];
		if (!resource || !textures[resource]) throw new Error(`[NNCloth] unproved native shadow sampler ${name}`);

		return `nnShadow_${resource}`;
	});

	const activeResources = [...new Set(Object.values(resources))].filter((resource) => body.includes(`nnShadow_${resource}`));
	const uniformBindings = Object.fromEntries(activeResources.map((resource) => [`nnShadow_${resource}`, { value: textures[resource] }]));
	const samplerDeclarations = activeResources
		.map(
			(resource) => `uniform ${resource === 't17' ? 'sampler2DArray' : 'sampler2D'} nnShadow_${resource};`,
		)
		.join('\n');
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, abi.uniforms, uniformBindings, { nnShadowProbe: probe });
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${abi.vertexDeclarations}`)
			.replace('#include <project_vertex>', `#include <project_vertex>\n${abi.vertexSetupGLSL}`);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
precision highp sampler2DArray;
${abi.fragmentDeclarations}
uniform vec4 nnView[325],nnTOD[31],nnWeather[40];
vec4 nnInput[11],nnShadowInput[11];
// Native PS508/509 depth output is not consumed by this scheduling adapter.
// Its uniform is required to disappear from the actual linked coverage program.
uniform vec4 nnUnusedNativeShadowOutput[16];
uniform int nnShadowProbe;
${samplerDeclarations}
${abi.primitiveGLSL}
${abi.bodySetupGLSL}
${body}`,
			)
			.replace(
				'#include <alphatest_fragment>',
				`#include <alphatest_fragment>
nnSetupBodyInputs();
for(int lane=0;lane<11;lane++)nnShadowInput[lane]=nnInput[lane];
nnShadowInput[8]=vec4(vNNFragmentWorld-nnView[110].xyz,0.0);
nnShadowInput[10]=nnInput[9];
NNClothCoverage nativeCoverage=nnClothCoverage();
#include <logdepthbuf_fragment>
if(nnShadowProbe==0){gl_FragColor=vec4(nativeCoverage.rejected,1.0);return;}
if(any(greaterThan(nativeCoverage.rejected,vec3(0.5))))discard;
if(nnShadowProbe==1){gl_FragColor=vec4(1.0);return;}`,
			);
	};
	material.userData.nnclothShadow = {
		coverageSHA256,
		customDataDomain: 'tracked-preview-component-custom-data',
		depth: 'Three-RGBADepthPacking-not-native-oDepth',
		noiseIndexDomain: 'referenced-textures',
		noise8Retained: true,
	};
	material.userData.nnclothShadowProbe = probe;
	return material;
}
