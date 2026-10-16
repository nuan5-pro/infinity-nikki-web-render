import { expect, it } from 'vitest';
import {
	Box3,
	BoxGeometry,
	DataArrayTexture,
	MeshBasicMaterial,
	PerspectiveCamera,
	ShaderLib,
	Texture,
	UniformsUtils,
} from 'three';
import { FurnitureBatch } from '../src/furniture/batch.js';
import type { LoadedFurniture } from '../src/furniture/assetStore.js';

it.each(['depth', 'distance'])('keeps Paper uniforms available when %s shadow programs are reused across groups', (kind) => {
	const geometry = new BoxGeometry();
	geometry.computeBoundingBox();
	const plain = new MeshBasicMaterial({ map: new Texture() });
	const dyed = new MeshBasicMaterial({ map: new DataArrayTexture() });
	dyed.map!.userData.paperLayer = 'raw';
	dyed.userData.textureInputs = { map: { paperLayer: 'raw' } };
	const asset = {
		config: { id: 1, componentCount: 1, customData: [0], colorings: {}, meshes: [] },
		data: { geometry, mergedMaterial: [dyed, plain], plainMaterials: [dyed, plain], boundingBox: geometry.boundingBox as Box3 },
		dispose() {},
	} as unknown as LoadedFurniture;
	const batch = new FurnitureBatch(asset, 32, 4096);
	const camera = new PerspectiveCamera();

	function compileGroup(index: number) {
		const mesh = batch.mesh;
		const depth = (kind === 'depth' ? mesh.customDepthMaterial : mesh.customDistanceMaterial)!;
		Reflect.apply(mesh.onBeforeShadow, mesh, [{}, mesh, camera, camera, geometry, depth, { materialIndex: index }]);
		const source = kind === 'depth' ? ShaderLib.depth : ShaderLib.distance;
		const shader = {
			uniforms: UniformsUtils.clone(source.uniforms),
			vertexShader: source.vertexShader,
			fragmentShader: source.fragmentShader,
		};
		Reflect.apply(depth.onBeforeCompile, depth, [shader, {}]);
		return shader;
	}

	try {
		const paper = compileGroup(0);
		expect(paper.vertexShader).toContain('uniform highp usampler2D nuanCustomData');
		expect(paper.uniforms.nuanCustomData!.value).toBe(batch.data.texture);
		const plainShader = compileGroup(1);
		// Three retains the most recently compiled uniform dictionary per material,
		// even when the next group reuses an older Paper shader program.
		expect(plainShader.uniforms.nuanCustomData?.value).toBe(batch.data.texture);
		expect(plainShader.uniforms.nuanCustomDataStride?.value).toBe(batch.data.stride);

		const previous = batch.data.texture;
		batch.reserve(64);
		expect(batch.data.texture).not.toBe(previous);
		expect(compileGroup(1).uniforms.nuanCustomData?.value).toBe(batch.data.texture);
	} finally {
		batch.dispose();
		geometry.dispose();
		for (const material of [plain, dyed]) material.dispose();
		plain.map!.dispose();
		dyed.map!.dispose();
	}
});
