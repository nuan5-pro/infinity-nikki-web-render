import {
	CompressedArrayTexture,
	MeshPhysicalMaterial,
	type Material,
	type Texture,
	type IUniform,
} from 'three';
import { canShareNNCloth2DSampler, canShareNNClothNormalSampler } from './nnclothSamplerState.js';

export interface NNClothCompiledPrograms {
	body: string;
	depthCoverage: string;
	bodySHA256: string;
	depthSHA256: string;
	cacheDomain: string;
	applyCoverage?: boolean;
}

export interface NNClothShaderABI {
	/** Uniform bindings for the compiled shader programs. */
	uniforms: Record<string, IUniform>;
	primitiveGLSL: string;
	coverageInputGLSL: string;
	mode: 'uniforms' | 'geometry';
	vertexDeclarations?: string;
	vertexSetupGLSL?: string;
	fragmentDeclarations?: string;
	bodySetupGLSL?: string;
	beforeRender?: Material['onBeforeRender'];
}

/** Combine the material body and coverage mask with editor physical lighting. */
export function createNNClothCompiledMaterial(
	programs: NNClothCompiledPrograms,
	textures: Record<string, Texture>,
	abi: NNClothShaderABI,
	source: Material,
) {
	if (
		!/^[a-f0-9]{64}$/.test(programs.bodySHA256) ||
		!/^[a-f0-9]{64}$/.test(programs.depthSHA256) ||
		!programs.cacheDomain
	) throw new Error('[NNCloth] compiled source/cache proof missing');

	const normal = textures.t17;
	const far = textures.t17Far;
	if (
		!(normal instanceof CompressedArrayTexture) ||
		!(far instanceof CompressedArrayTexture) ||
		!canShareNNClothNormalSampler(normal, far)
	) throw new Error('[NNCloth] near/far original array storage or sampler state differs');

	const noise = textures.noise7;
	const sharedNoise = textures.noise7Shared;
	if (!noise || !sharedNoise || !canShareNNCloth2DSampler(noise, sharedNoise)) throw new Error('[NNCloth] original asset/shared coverage-noise state differs');

	const names: Record<string, string> = {
		nn_t3_s0: 't3',
		nn_t4_s3: 't4',
		nn_t5_s0: 't5',
		nn_t6_s0: 't6',
		nn_t7_s0: 't7',
		nn_t11_s1: 't11',
		nn_t12_s0: 't12',
		nn_t13_s0: 't13',
		nn_t14_s0: 't14',
		nn_t15_s0: 't15',
		nn_t17_s0: 't17',
		nn_t18_s5: 't18',
		nnCoverageNoise: 'noise7',
	};

	for (const [uniform, resource] of Object.entries(names)) {
		if (!textures[resource]) throw new Error(`[NNCloth] original native input ${resource} missing`);

		abi.uniforms[uniform] = { value: textures[resource] };
	}

	let body = programs.body
		.replace(/uniform sampler2DArray nn_t17_s6;\r?\n/, '')
		.split('nn_t17_s6')
		.join('nn_t17_s0');
	if (abi.mode === 'geometry') {
		if (
			!abi.vertexDeclarations ||
			!abi.vertexSetupGLSL ||
			!abi.fragmentDeclarations ||
			!abi.bodySetupGLSL ||
			!abi.beforeRender
		) throw new Error('[NNCloth] actual source geometry/runtime ABI incomplete');

		body = body.replace('uniform vec4 nnInput[11];', 'vec4 nnInput[11];');
	}

	const coverageBindings: Record<string, string> = {
		nn_t2_s2: 'nn_t4_s3',
		nn_t3_s0: 'nn_t5_s0',
		nn_t5_s0: 'nn_t7_s0',
		nn_t1_s0: 'nn_t3_s0',
		nn_t11_s0: 'nn_t13_s0',
		nn_t12_s0: 'nnCoverageNoise',
		nn_t12_s3: 'nnCoverageNoise',
		nn_t13_s0: 'nn_t17_s0',
		nn_t13_s4: 'nn_t17_s0',
	};

	let coverage = programs.depthCoverage.replace(/uniform sampler(?:2DArray|2D) \w+;\r?\n/g, '');
	coverage = coverage.replace(/\bnn_t\d+_s\d+\b/g, (name) => {
		const binding = coverageBindings[name];
		if (!binding) throw new Error(`[NNCloth] unproved source coverage sampler ${name}`);

		return binding;
	});
	coverage = coverage
		.replace(/uniform vec4 nnCB\d+\[\d+\];\r?\n/g, '')
		.replace(/uniform vec4 nnInput\[\d+\];\r?\n/g, '')
		.split('nnInput')
		.join('nnDepthInput')
		.split('nnCB0[0]')
		.join('nnDepthFade')
		.split('nnCB1')
		.join('nnView')
		.split('nnCB2')
		.join('nnTOD')
		.split('nnCB3')
		.join('nnWeather');
	if (coverage.includes('nnProbeValue')) throw new Error('[NNCloth] material consumer requires production coverage');

	const outputIndex = { value: -1 };
	const material = new MeshPhysicalMaterial({
		color: 0xffffff,
		roughness: 1,
		metalness: 0,
		transparent: false,
		opacity: 1,
	});
	material.name = source.name;
	material.side = source.side;
	material.depthTest = source.depthTest;
	material.depthWrite = source.depthWrite;
	material.toneMapped = source.toneMapped;

	const applyCoverage = programs.applyCoverage ?? true;
	material.userData = {
		...source.userData,
		nnclothOutputIndex: outputIndex,
	};
	material.customProgramCacheKey = () => `nncloth-native-body-1:${programs.bodySHA256}:${programs.depthSHA256}:${programs.cacheDomain}:${abi.mode}:${applyCoverage}`;
	if (abi.beforeRender) material.onBeforeRender = abi.beforeRender;
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, abi.uniforms, { nnOutputIndex: outputIndex });
		if (abi.vertexDeclarations)
			shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${abi.vertexDeclarations}`);

		if (abi.vertexSetupGLSL)
			shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${abi.vertexSetupGLSL}`);

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
precision highp sampler2DArray;
${abi.fragmentDeclarations ?? ''}
${body}
uniform sampler2D nnCoverageNoise;
${abi.primitiveGLSL}
${abi.bodySetupGLSL ?? ''}
${abi.coverageInputGLSL}
${coverage}
uniform int nnOutputIndex;
NNClothNativeOutputs nnSurface;`,
			)
			.replace(
				'#include <map_fragment>',
				`
${abi.bodySetupGLSL ? 'nnSetupBodyInputs();' : ''}
nnSetupDepthInputs();
NNClothCoverage nnMask=nnClothCoverage();
${applyCoverage ? 'if(any(greaterThan(nnMask.rejected,vec3(0.5))))discard;' : ''}
nnSurface=nnClothNativeBody();
diffuseColor.rgb=nnSurface.baseColor;
diffuseColor.a=1.0;`,
			)
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=nnSurface.roughness;')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor=nnSurface.metalness;')
			.replace(
				'#include <normal_fragment_maps>',
				'normal=normalize(mat3(viewMatrix)*vec3(nnSurface.worldNormal.y,-nnSurface.worldNormal.x,nnSurface.worldNormal.z));',
			)
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance=nnSurface.emission;')
			.replace(
				'#include <lights_physical_fragment>',
				`#include <lights_physical_fragment>
material.specularColor=mix(vec3(0.08*nnSurface.specular),diffuseColor.rgb,metalnessFactor);`,
			)
		// The body supplies the native SSS colour/opacity. The preview uses the
		// already evaluated, shadowed diffuse-light field; it does not pretend to
		// implement UE's deferred subsurface lighting/pass scheduling.
			.replace(
				'#include <lights_fragment_end>',
				`#include <lights_fragment_end>
reflectedLight.directDiffuse+=nnSurface.subsurfaceColor*nnSurface.subsurfaceOpacity*reflectedLight.directDiffuse;`,
			)
			.replace(
				'#include <opaque_fragment>',
				`#include <opaque_fragment>
if(nnOutputIndex==0)gl_FragColor=vec4(nnSurface.baseColor,0.0);
else if(nnOutputIndex==1)gl_FragColor=vec4(nnSurface.roughness,0.,0.,0.);
else if(nnOutputIndex==2)gl_FragColor=vec4(nnSurface.metalness,0.,0.,0.);
else if(nnOutputIndex==3)gl_FragColor=vec4(nnSurface.specular,0.,0.,0.);
else if(nnOutputIndex==4)gl_FragColor=vec4(nnSurface.worldNormal,0.);
else if(nnOutputIndex==5)gl_FragColor=vec4(nnSurface.emission,0.);
else if(nnOutputIndex==6)gl_FragColor=vec4(nnSurface.subsurfaceColor,0.);
else if(nnOutputIndex==7)gl_FragColor=vec4(nnSurface.subsurfaceOpacity,0.,0.,0.);`,
			);
		// Disable tone/display transfer only for explicit offscreen term readback;
		// the ordinary negative-index physical draw retains both pipeline stages.
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <tonemapping_fragment>',
				'if(nnOutputIndex<0){\n#include <tonemapping_fragment>\n}',
			)
			.replace(
				'#include <colorspace_fragment>',
				'if(nnOutputIndex<0){\n#include <colorspace_fragment>\n}',
			);
	};
	return material;
}
