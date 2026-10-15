import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DoubleSide, MeshStandardMaterial, ShaderLib } from 'three';
import {
	createClothMaterial,
	readFurnitureCloth,
	type FurnitureCloth,
} from '../../src/materials/cloth/clothShader.js';

function fixture(): FurnitureCloth {
	return {
		family: 'cloth-master',
		version: 2,
		root: 'main',
		mode: 'masked',
		alphaCutoff: 0.3333,
		opacitySource: 'diffuse-alpha',
		opacity: [1, 1, 5],
		color: [1, 1, 1],
		roughness: [0, 1],
		metalness: [0, 1],
		ao: [0, 1],
		uvScale: 1,
		mainUvChannel: 0,
		detailUvScale: 1,
		detailFlatness: 0,
		twoSideSign: 1,
		edgeColor: [0, 0, 0, 0],
		edgePower: 1,
		diffuseEdge: [0, 0],
		anisoColor: [0, 0, 0, 0],
		anisoTangent: [1, 0, 0],
		anisoBaseMix: 0,
		anisoRoughness: 0.5,
		anisoScale: [1, 1],
		emissive: [0, 0, 0],
		colorInShadow: [1, 1, 1],
		advanced: false,
		reflectBase: [1, 1, 1],
		reflectDark: [0, 0, 0],
		palette: false,
		paletteUvBlend: 0,
		paletteConstant: [1, 1, 1, 1],
		maskColor: [1, 1, 1],
		maskUvChannel: 0,
		maskUvScale: [1, 1],
		fourthRole: 'none',
		resourceKeys: ['', '', '', ''],
		textureActive: [false, false, false, false],
		textureConstant: [
			[1, 1, 1, 1],
			[0.5, 0.5, 1, 1],
			[1, 1, 0, 1],
			[0.5, 0.5, 1, 1],
		],
		textureSRGB: [false, false, false, false],
		textureMipmaps: [false, false, false, false],
		textureNearest: [false, false, false, false],
		textureWrap: [
			['TA_Wrap', 'TA_Wrap'],
			['TA_Wrap', 'TA_Wrap'],
			['TA_Wrap', 'TA_Wrap'],
			['TA_Wrap', 'TA_Wrap'],
		],
	};
}

for (const face of [false, true]) {
	test(`native face ownership ${face} preserves scalar and decoder signs`, () => {
		const cloth = { ...fixture(), normalFaceSign: face };
		assert.equal(readFurnitureCloth(cloth), cloth);

		const source = new MeshStandardMaterial({ side: DoubleSide });
		source.userData.clothNormalSigns = [1, -1];

		const material = createClothMaterial(cloth, null, null, null, null, source);

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		} as any;

		material.onBeforeCompile(shader, {} as any);
		assert.equal(shader.uniforms.clothTwoSideSign.value, 1);
		assert.deepEqual(material.normalScale.toArray(), [1, -1]);
		assert.deepEqual(source.userData.clothNormalSigns, [1, -1]);
		assert.doesNotMatch(shader.fragmentShader, /normal \*= faceDirection;/);
		assert.doesNotMatch(shader.fragmentShader, /tbn\[[01]\] \*= faceDirection;/);

		const factors = shader.fragmentShader.match(/mapN \*= 1\.0 \+ \(faceDirection - 1\.0\) \* clothTwoSideSign;/g) ?? [];
		assert.equal(factors.length, face ? 1 : 0);
		assert.match(material.customProgramCacheKey(), new RegExp(`_${face}$`));
		material.dispose();
		source.dispose();
	});
}

test('old v2 stays explicitly unproved and invalid proof rejects', () => {
	const cloth = fixture();
	assert.equal(readFurnitureCloth(cloth), cloth);
	assert.equal(readFurnitureCloth({ ...cloth, normalFaceSign: 1 }), null);

	const source = new MeshStandardMaterial({ side: DoubleSide });
	const material = createClothMaterial(cloth, null, null, null, null, source);
	assert.match(material.customProgramCacheKey(), /_unproved$/);
	material.dispose();
	source.dispose();
});

test('source single-pass preserves both native face factors and one physical draw', () => {
	const cloth = {
		...fixture(),
		mode: 'translucent' as const,
		normalFaceSign: true,
		normalOutputFaceSign: true,
		opacity: [1.3, 1, 5] as [number, number, number],
	};

	assert.equal(readFurnitureCloth(cloth), cloth);
	assert.equal(readFurnitureCloth({ ...cloth, normalOutputFaceSign: 1 }), null);

	const source = new MeshStandardMaterial({ side: DoubleSide });
	const material = createClothMaterial(cloth, null, null, null, null, source);

	const shader = {
		vertexShader: ShaderLib.standard.vertexShader,
		fragmentShader: ShaderLib.standard.fragmentShader,
		uniforms: {},
	} as any;

	material.onBeforeCompile(shader, {} as any);
	assert.equal(material.forceSinglePass, true);
	assert.equal(material.transparent, true);
	assert.equal(material.depthWrite, false);
	assert.equal((shader.fragmentShader.match(/normal \*= faceDirection;/g) ?? []).length, 1);
	assert.equal(
		(
			shader.fragmentShader.match(/mapN \*= 1\.0 \+ \(faceDirection - 1\.0\) \* clothTwoSideSign;/g) ?? []
		).length,
		1,
	);
	assert.doesNotMatch(shader.fragmentShader, /tbn\[[01]\] \*= faceDirection;/);
	assert.deepEqual(shader.uniforms.clothOpacity.value.toArray(), [1.3, 1, 5]);
	assert.match(material.customProgramCacheKey(), /_output-face$/);
	assert.ok(
		shader.fragmentShader.indexOf('normal *= faceDirection;') <
			shader.fragmentShader.indexOf('float clothNV'),
	);
	material.dispose();
	source.dispose();
});
