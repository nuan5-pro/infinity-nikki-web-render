import { Color, MeshStandardMaterial, ShaderChunk, type Material, type WebGLRenderer } from 'three';
import { outputUniforms } from './lighting.js';

type RGB = readonly [number, number, number];

const states = new WeakMap<
	WebGLRenderer,
	{
		general: { value: Color }
		water: { value: Color }
		diffuseWeight: { value: number }
	}
>();
const configured = new WeakSet<Material>();

function uniforms(renderer: WebGLRenderer) {
	let state = states.get(renderer);
	if (!state) {
		state = {
			general: { value: new Color(1, 1, 1) },
			water: { value: new Color(1, 1, 1) },
			diffuseWeight: { value: 1 },
		};
		states.set(renderer, state);
	}

	return state;
}

export function setEnvironmentReflection(renderer: WebGLRenderer, general: RGB, water: RGB, sky: RGB = [1, 1, 1]): void {
	const state = uniforms(renderer);
	state.general.value.setRGB(general[0] * sky[0], general[1] * sky[1], general[2] * sky[2]);
	state.water.value.setRGB(water[0] * sky[0], water[1] * sky[1], water[2] * sky[2]);
}

/** The light rig supplies outdoor diffuse fill. */
export function setEnvironmentDiffuseWeight(renderer: WebGLRenderer, weight: number): void {
	uniforms(renderer).diffuseWeight.value = weight;
}

/** Apply the source SLW tint to environment reflections. */
export function applyEnvironmentLighting<T extends Material>(material: T): T {
	if (!(material instanceof MeshStandardMaterial) || configured.has(material)) return material;

	configured.add(material);

	const compile = material.onBeforeCompile;
	// Capture the source program key before replacing its compile hook.
	const cacheKey = material.customProgramCacheKey();
	const water = material.userData.water?.family === 'single-layer-water';
	material.onBeforeCompile = function (shader, renderer) {
		compile.call(this, shader, renderer);
		Object.assign(shader.uniforms, outputUniforms(renderer));

		const marker = '#include <envmap_physical_pars_fragment>';
		if (!shader.fragmentShader.includes(marker)) return;

		const state = uniforms(renderer);
		shader.uniforms.editorEnvironmentSpecularTint = state[water ? 'water' : 'general'];
		shader.uniforms.editorEnvironmentDiffuseWeight = state.diffuseWeight;
		shader.fragmentShader = shader.fragmentShader.replace(
			marker,
			'uniform vec3 editorEnvironmentSpecularTint;\nuniform float editorEnvironmentDiffuseWeight;\n' +
				ShaderChunk.envmap_physical_pars_fragment
					.replace(
						'return PI * envMapColor.rgb * envMapIntensity;',
						'return PI * envMapColor.rgb * envMapIntensity * editorEnvironmentDiffuseWeight;',
					)
					.replace(
						'return envMapColor.rgb * envMapIntensity;',
						'return envMapColor.rgb * envMapIntensity * editorEnvironmentSpecularTint;',
					),
		);
	};
	material.customProgramCacheKey = () => `${cacheKey}_environment_lighting_${water ? 'slw' : 'general'}_v3`;
	return material;
}
