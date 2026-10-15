import { describe, expect, it } from 'vitest';
import { Texture, type WebGLRenderer, type WebGLProgramParametersWithUniforms } from 'three';
import {
	createIntStaticMeshCurrentMaterial,
	type FurnitureIntStaticMeshCurrent,
	type IntStaticMeshCurrentRuntime,
} from '../../src/materials/surface/intStaticMeshCurrentShader.js';

const roles = ['N', 'N1', 'N2', 'D', 'D1', 'D2', 'T', 'T1', 'O', 'O1', 'O2', 'M', 'B', 'S'];

function create(sameSampler = true, coating = false) {
	const profile: FurnitureIntStaticMeshCurrent = {
		version: 1,
		family: 'int-static-mesh-current',
		variant: 'pattern-layer-glint',
		uniforms: Array.from({ length: 34 }, () => [0, 0, 0, 0]),
		collection: {
			ready: 0,
			limitedDirection: [0, 0, 1],
			sunColor: [1, 1, 1],
			swapLightFactor: 1,
			globalFactor: 1,
			glintMode: 0,
		},
		requiredUV: [0, 1, 2, 3],
		twoSided: true,
		textures: Object.fromEntries(
			roles.map((role) => [
				role,
				{
					parameter: role,
					sRGB: false,
					rgbScale: 1,
					addressX: 'TA_Wrap',
					addressY: 'TA_Wrap',
					mipmaps: true,
					nearest: false,
					cube: role === 'S',
				},
			]),
		),
	};

	const sources = Object.fromEntries(roles.map((role) => [role, new Texture()]));
	if (coating) {
		profile.variant = 'coating';
		profile.uniforms = profile.uniforms.slice(0, 12);
		profile.requiredUV = [0, 1];
		for (const role of roles)
			if (!['N', 'N1', 'O', 'T', 'D', 'S'].includes(role)) delete profile.textures[role];
	}

	sources.M = sources.N1!.clone();
	sources.B = sources.D1!.clone();
	sources.T1 = sources.D2!.clone();
	if (!sameSampler) profile.textures.M!.sRGB = true;

	const runtime: IntStaticMeshCurrentRuntime = {
		primaryDirection: [0, 0, 1],
		primaryColor: [1, 1, 1],
		ready: 0,
		limitedDirection: [0, 0, 1],
		sunColor: [1, 1, 1],
		normalOverride: [0, 0, 0, 1],
		preExposure: 1,
		nativeCullingSign: 1,
		nativePrimitiveDeterminantSign: 1,
		nativeFrontFaceParity: 1,
		gameTime: 1,
		unpausedTime: 1,
		textureMipBias: 0,
		timeOfDayHours: 12,
		swapLightFactor: 1,
		globalFactor: 1,
		glintMode: 0,
	};

	const material = createIntStaticMeshCurrentMaterial(profile, sources, runtime, () => {});

	const shader = {
		vertexShader: '#include <common>\n#include <project_vertex>',
		fragmentShader: '#include <common>\n#include <map_fragment>',
		uniforms: {},
	} as WebGLProgramParametersWithUniforms;

	material.onBeforeCompile(shader, {} as WebGLRenderer);
	return { material, shader };
}

describe('IntStatic current sampler binding', () => {
	it('shares identical image/sampler bindings without merging UV or channel consumers', () => {
		const { material, shader } = create();
		expect(shader.fragmentShader).toContain('#define isM isN1');
		expect(shader.fragmentShader).toContain('#define isB isD1');
		expect(shader.fragmentShader).toContain('#define isT1 isD2');

		const declaration = shader.fragmentShader.match(/uniform sampler2D ([^;]+);/)![1]!;
		expect(declaration.split(',')).toHaveLength(11);
		expect(shader.fragmentShader).toContain('texture2D(isM,layerUV)');
		expect(shader.fragmentShader).toContain('texture2D(isB,first,isMipBias)');
		expect(shader.fragmentShader).toContain('texture2D(isT1,patternUV)');
		material.dispose();
	});
	it('keeps distinct sampler colour-space semantics and distinct program cache layouts', () => {
		const shared = create();
		const separate = create(false);
		expect(separate.shader.fragmentShader).not.toContain('#define isM isN1');
		expect(separate.shader.fragmentShader.match(/uniform sampler2D ([^;]+);/)![1]!.split(',')).toHaveLength(12);
		expect(separate.material.customProgramCacheKey()).not.toBe(shared.material.customProgramCacheKey());
		shared.material.dispose();
		separate.material.dispose();
	});
	it('accepts coating12 with only its six actual source bindings', () => {
		const { material, shader } = create(true, true);
		expect(shader.fragmentShader).toContain('#define IS_COUNT 12');
		expect(shader.fragmentShader.match(/uniform sampler2D ([^;]+);/)![1]!.split(',')).toHaveLength(6);
		expect(shader.fragmentShader).toContain('mix(isMaterial[10].x,isMaterial[9].w,attr.r)');
		expect(material.customProgramCacheKey()).toContain(':coating:');
		material.dispose();
	});
});
