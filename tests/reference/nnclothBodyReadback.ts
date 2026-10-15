import {
	createNNClothCompiledMaterial,
	type NNClothCompiledPrograms,
	type NNClothShaderABI,
} from '../../src/materials/nncloth/nnclothCompiledMaterial.js';
import type { Material, Texture } from 'three';

/** All eight body outputs remain live in one actual program. Removing preview
 * lighting/depth coverage sinks lets the original 16-sampler body be compared
 * on source geometry without pretending it fits the final IBL/shadow program.
 */
export function createNNClothBodyReadback(
	programs: NNClothCompiledPrograms,
	textures: Record<string, Texture>,
	abi: NNClothShaderABI,
	source: Material,
) {
	for (const resource of ['t8', 't9', 't10', 't16']) {
		if (textures[resource])
			abi.uniforms[`nn_${resource}_s${resource === 't16' ? 4 : 0}`] = { value: textures[resource] };
	}

	const material = createNNClothCompiledMaterial(programs, textures, abi, source);
	const proofLine = { value: -1 };
	const instrumented = programs.body.includes('nnSourceProofValue');
	const compile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		compile(shader, renderer);
		if (instrumented) shader.uniforms.nnSourceProofLine = proofLine;
		const main = shader.fragmentShader.lastIndexOf('void main() {');
		if (main < 0) throw new Error('[NNCloth] body readback shader entry missing');

		shader.fragmentShader =
			shader.fragmentShader.slice(0, main) +
			`void main(){
      nnSetupBodyInputs();nnSurface=nnClothNativeBody();
      #include <logdepthbuf_fragment>
      ${instrumented ? 'if(nnOutputIndex==8){gl_FragColor=nnSourceProofValue;return;}' : ''}
      if(nnOutputIndex==0)gl_FragColor=vec4(nnSurface.baseColor,1.0);
      else if(nnOutputIndex==1)gl_FragColor=vec4(nnSurface.roughness,0.,0.,1.);
      else if(nnOutputIndex==2)gl_FragColor=vec4(nnSurface.metalness,0.,0.,1.);
      else if(nnOutputIndex==3)gl_FragColor=vec4(nnSurface.specular,0.,0.,1.);
      else if(nnOutputIndex==4)gl_FragColor=vec4(nnSurface.worldNormal,1.);
      else if(nnOutputIndex==5)gl_FragColor=vec4(nnSurface.emission,1.);
      else if(nnOutputIndex==6)gl_FragColor=vec4(nnSurface.subsurfaceColor,1.);
      else gl_FragColor=vec4(nnSurface.subsurfaceOpacity,0.,0.,1.);
    }`;
	};

	const key = material.customProgramCacheKey.bind(material);
	material.customProgramCacheKey = () => `${key()}:source-body-eight-only-readback-1`;
	material.userData.nnclothSourceProofLine = proofLine;
	return material;
}
