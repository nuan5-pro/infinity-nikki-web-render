import { LessEqualDepth, type Material, type Texture } from 'three';
import {
	createNNClothCompiledMaterial,
	type NNClothCompiledPrograms,
	type NNClothShaderABI,
} from './nnclothCompiledMaterial.js';

/** A diagnostic/editor prepass scheduling adapter. Its coverage is the captured
 * FDepthOnly consumer, but Three's queue/depth state is stated separately and is
 * not claimed to reconstruct the native game pass state or early-Z policy.
 */
export function createNNClothDepthMaterial(
	programs: NNClothCompiledPrograms,
	textures: Record<string, Texture>,
	abi: NNClothShaderABI,
	source: Material,
) {
	const material = createNNClothCompiledMaterial(programs, textures, abi, source);
	const compile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		compile(shader, renderer);

		const main = shader.fragmentShader.lastIndexOf('void main() {');
		if (main < 0) throw new Error('[NNCloth] Three diagnostic depth shader entry missing');

		shader.fragmentShader =
			shader.fragmentShader.slice(0, main) +
			`void main(){
      nnSetupBodyInputs();nnSetupDepthInputs();
      NNClothCoverage mask=nnClothCoverage();
      if(any(greaterThan(mask.rejected,vec3(0.5))))discard;
      #include <logdepthbuf_fragment>
      gl_FragColor=vec4(1.0);
    }`;
	};

	const key = material.customProgramCacheKey.bind(material);
	material.customProgramCacheKey = () => `${key()}:source-depth-preview-prepass-1`;
	material.colorWrite = false;
	material.depthWrite = true;
	material.depthTest = true;
	material.depthFunc = LessEqualDepth;
	material.userData.nnclothCompiled.queue = 'preview-explicit-depth-prepass-not-native-queue';
	return material;
}
