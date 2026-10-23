import { ShaderChunk, Texture, type Material, type IUniform } from 'three';
import { CustomDataBuffer, paperCustomDataVertex, paperCustomDataFragment } from './customData.js';
import { readFurnitureSurface } from '../materials/surface/surfaceShader.js';
import { readFurnitureSurfaceExtra } from '../materials/surface/surfaceExtraShader.js';
import { invalidateMaterialBindings, materialDependencies } from '../runtime/materialPreparation.js';

type Shader = Parameters<Material['onBeforeCompile']>[0];

const owners = new WeakMap<Material, { texture: IUniform; stride: IUniform }>();

function expand(source: string): string {
	return source.replace(/#include <([\w]+)>/g, (_, name: keyof typeof ShaderChunk) => {
		const chunk = ShaderChunk[name];
		if (chunk === undefined) throw new Error(`Unknown Three shader chunk: ${name}`);

		return expand(chunk);
	});
}

/** Rewrites only a declared array consumer, after family hooks and Three chunks. */
export function arraySampler(source: string, name: string, layer: string): string {
	source = source.replace(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?sampler2D\s+([^;]+);/g,
		(declaration, list: string) => {
			const names = list.split(',').map((value) => value.trim());
			if (!names.includes(name)) return declaration;

			const remaining = names.filter((value) => value !== name);
			return `uniform highp sampler2DArray ${name};\n` +
				(remaining.length ? `uniform sampler2D ${remaining.join(',')};` : '');
		});

	const call = new RegExp(`\\b(texture2D|texture|textureLod|textureGrad)\\s*\\(\\s*${name}\\s*,`, 'g');
	let result = '';
	let start = 0;
	for (let match = call.exec(source); match; match = call.exec(source)) {
		let end = call.lastIndex;
		let depth = 0;
		for (; end < source.length; end++) {
			const character = source[end];
			if (character === '(') depth++;
			if (character === ')') {
				if (depth === 0) break;
				depth--;
			}

			if (character === ',' && depth === 0) break;
		}

		if (end === source.length) throw new Error(`Unterminated array sample: ${name}`);

		const operation = match[1] === 'texture2D' ? 'texture' : match[1];
		result += source.slice(start, match.index) +
			`${operation}(${name}, vec3(${source.slice(call.lastIndex, end)}, ${layer})`;
		start = end;
		call.lastIndex = end;
	}

	return result + source.slice(start);
}

function rawConsumers(source: string): string {
	for (const name of ['homeRaw', 'foliageRaw']) {
		source = source.replace(new RegExp(`uniform\\s+float\\s+${name}\\s*;`, 'g'), '')
			.replace(new RegExp(`\\b${name}\\b`, 'g'), 'float(nuanPaperCustomData)');
	}

	return source.replace(/foliageCycleParams\.w/g, 'float(nuanPaperCustomData)');
}

export function installPaperMaterial(material: Material): void {
	if (owners.has(material)) return;

	const inputs = material.userData.textureInputs as Record<string, { paperLayer?: string }> | undefined;
	const surface = readFurnitureSurfaceExtra(material.userData.surfaceExtra)?.core ??
		readFurnitureSurface(material.userData.surface);
	if (!Object.values(inputs ?? {}).some((input) => input.paperLayer) &&
			!surface?.homeUv && !material.userData.foliage?.home && !material.userData.editorPreview?.gradient) return;

	const uniforms = { texture: { value: null }, stride: { value: 0 } };
	owners.set(material, uniforms);

	const compile = material.onBeforeCompile;
	const key = material.customProgramCacheKey();
	material.onBeforeCompile = function (shader: Shader, renderer) {
		compile.call(this, shader, renderer);
		shader.uniforms.nuanCustomData = uniforms.texture;
		shader.uniforms.nuanCustomDataStride = uniforms.stride;
		shader.vertexShader = paperCustomDataVertex + '\n' + rawConsumers(expand(shader.vertexShader))
			.replace(/void\s+main\s*\(\s*\)\s*\{/, `$&
nuanPaperCustomData = nuanReadPaperCustomData();
nuanPaperCustomDataBytes = nuanEncodePaperCustomData(nuanPaperCustomData);`);

		let fragment = rawConsumers(expand(shader.fragmentShader))
			.replace(/void\s+main\s*\(\s*\)\s*\{/, '$&\nnuanPaperCustomData = nuanDecodePaperCustomData(nuanPaperCustomDataBytes);');
		for (const [name, uniform] of Object.entries(shader.uniforms)) {
			// Standard uniforms are populated by Three after onBeforeCompile.
			const value = uniform.value instanceof Texture ? uniform.value :
				(material as unknown as Record<string, unknown>)[name];
			if (!(value instanceof Texture)) continue;
			const recipe = value.userData.paperLayer;
			if (!recipe) continue;
			let layer: string;
			switch (recipe) {
			case 'raw': layer = 'float(nuanPaperCustomData)';
				break;
			case 'raw-mod25': layer = 'float(nuanPaperCustomData % 25u)';
				break;
			case 'raw-div25': layer = 'float(nuanPaperCustomData / 25u)';
				break;
			case 'hbc-decimal': {
				const parameters = surface?.tintDyeParams;
				if (!parameters) throw new Error('HBC array requires native tintDyeParams');

				layer = `nuanHBCLayer(vec2(${Number(parameters[0]).toFixed(8)}, ${Number(parameters[1]).toFixed(8)}), textureSize(${name}, 0).z)`;
				break;
			}
			default: throw new Error(`Unsupported PaperCustomData recipe: ${recipe}`);
			}

			fragment = arraySampler(fragment, name, `clamp(${layer}, 0.0, float(textureSize(${name}, 0).z - 1))`);
		}

		shader.fragmentShader = paperCustomDataFragment + '\n' + fragment;
	};

	const signature = JSON.stringify([Object.entries(inputs ?? {}).map(([role, input]) => [role, input.paperLayer]), surface?.tintDyeParams, !!surface?.homeUv, !!material.userData.foliage?.home]);
	material.customProgramCacheKey = () => `${key}:paper-custom-data-2:${signature}`;
	material.needsUpdate = true;
}

export function bindPaperMaterial(material: Material, buffer: CustomDataBuffer): void {
	for (const dependency of materialDependencies(material)) bindPaperMaterial(dependency, buffer);

	installPaperMaterial(material);

	const owner = owners.get(material);
	if (!owner) return;

	if (owner.texture.value !== buffer.texture) {
		owner.texture.value = buffer.texture;
		invalidateMaterialBindings(material);
	}
	owner.stride.value = buffer.stride;
}
