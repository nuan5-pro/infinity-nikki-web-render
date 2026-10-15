import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	BufferGeometry,
	DataTexture,
	Float32BufferAttribute,
	MeshStandardMaterial,
	ShaderLib,
} from 'three';
import { readFurnitureLayered } from '../../src/materials/layered/layeredShader.js';
import {
	assertLayeredVCHeightGeometry,
	createLayeredVCHeightMaterial,
} from '../../src/materials/layered/layeredVCHeightShader.js';

test(
	'actual captured VCHeight contract preserves native blend and dynamic specular',
	{ skip: !process.env.CABINET_NATIVE_TEST_ROOT },
	() => {
		const config = readFurnitureLayered(JSON.parse(readFileSync(`${process.env.CABINET_NATIVE_TEST_ROOT}/vcheight-profile.json`, 'utf8')));
		assert.ok(config);

		const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
		const inputs = Object.fromEntries(Object.keys(config.textures).map((role) => [role, texture]));
		const source = new MeshStandardMaterial();
		source.userData.sourceProof = 'preserve';

		const material = createLayeredVCHeightMaterial(config, inputs, source);

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		} as any;

		material.onBeforeCompile(shader, {} as any);
		assert.match(shader.vertexShader, /vVCColorR=ueLayerColor.r/);
		assert.match(shader.fragmentShader, /1.0-clamp\(vcPacked0.b,0.0,1.0\)/);
		assert.match(shader.fragmentShader, /material.specularColor=mix\(vec3\(0.08\*vcSpecFactor\)/);
		assert.equal(shader.uniforms.vcSpecular.value.y, 2);
		assert.equal(material.userData.sourceProof, 'preserve');
		assert.equal(material.alphaTest, 0);

		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
		geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1], 3));
		geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1], 4));
		geometry.setAttribute('uv', new Float32BufferAttribute([0, 0], 2));
		geometry.setAttribute('uv1', new Float32BufferAttribute([0, 0], 2));
		assert.throws(() => assertLayeredVCHeightGeometry(geometry, config), /original native ueLayerColor/);
		assert.equal(
			readFurnitureLayered({
				...config,
				vcHeight: { ...config.vcHeight, pixelShader: 'unproved' },
			}),
			null,
		);
		material.dispose();
		source.dispose();
		texture.dispose();
		geometry.dispose();
	},
);
