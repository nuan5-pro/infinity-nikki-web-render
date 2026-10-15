import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	BufferGeometry,
	DataTexture,
	MeshStandardMaterial,
	ShaderLib,
	Float32BufferAttribute,
} from 'three';
import {
	assertCabinetStaticGeometry,
	createCabinetStaticMaterial,
	readFurnitureCabinetStatic,
	validateCabinetStaticProfile,
	type CabinetStaticProfile,
} from '../../src/materials/surface/cabinetStaticShader.js';

function fixture(): CabinetStaticProfile {
	const roles = ['D', 'N', 'O', 'N1', 'D1', 'N2', 'O1', 'D2', 'B', 'T', 'T1'];
	return {
		family: 'int-static-native',
		version: 1,
		pixelShader: 'eab4a66a4e3a0c21d9fc1b2386340fb3bc1fe379',
		color: [1, 1, 1, 1],
		attribute: [0, 1, 0, 1],
		detailNormal: [1, 1, 1, 1],
		patternUV: [0, 0, 1, 0],
		patternTransform: [1, 1, 0, 0],
		patternBlend: [1, 1, 1, 0],
		normalIntensity: 1,
		patternNormalIntensity: 1,
		useORMChannel: 0,
		specular: 0.5,
		ao: 1,
		emissionTint: [1, 1, 1],
		patternEmissionTint: [1, 1, 1],
		requiredUV: [0, 1, 2],
		second: {
			uv: [0, 1, 0, 0],
			transform: [1, 1, 0, 0],
			blend: [1, 1, 1, 1],
			roughness: 0,
			metalness: 0,
			height: 0,
			emission: 0,
		},
		textures: Object.fromEntries(
			roles.map((role) => [
				role,
				{
					parameter: `synthetic-${role}`,
					sRGB: ['D', 'D1', 'D2', 'T', 'T1'].includes(role),
					mipmaps: false,
					nearest: false,
					address: ['TA_Wrap', 'TA_Wrap'],
					encoding: ['N', 'N1', 'N2', 'B'].includes(role) ? 'native-rg' : 'rgba',
					sampler: 'view-world-wrap',
				},
			]),
		) as CabinetStaticProfile['textures'],
	};
}

test('native UV selection, attribute packing and source normal phase survive shader generation', () => {
	const profile = fixture();
	const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
	const inputs = Object.fromEntries(Object.keys(profile.textures).map((role) => [role, texture]));
	const source = new MeshStandardMaterial();
	source.userData.sourceIdentity = 'unchanged';
	source.normalScale.set(1, -1);

	const material = createCabinetStaticMaterial(profile, inputs, source);

	const shader = {
		vertexShader: ShaderLib.standard.vertexShader,
		fragmentShader: ShaderLib.standard.fragmentShader,
		uniforms: {},
	} as any;

	material.onBeforeCompile(shader, {} as any);
	assert.deepEqual(material.normalScale.toArray(), [1, 1]);
	assert.deepEqual(source.normalScale.toArray(), [1, -1]);
	assert.deepEqual(shader.uniforms.cabinetPatternUV.value.toArray(), [0, 0, 1, 0]);
	assert.match(shader.fragmentShader, /cabinetMetal = mix\(cabinetAttribute.x, cabinetAttribute.y, cabinetMask.r\)/);
	assert.match(shader.fragmentShader, /cabinetRough = 1.0 - cabinetMG.y/);
	assert.match(shader.fragmentShader, /cabinetSecondProperties.xy/);
	assert.match(shader.fragmentShader, /cabinetNormal.xy \*= normalScale/);
	assert.doesNotMatch(shader.fragmentShader, /normal \*= faceDirection/);
	assert.equal(material.alphaTest, 0);
	assert.equal(material.transparent, false);
	assert.equal(material.userData.sourceIdentity, 'unchanged');
	assert.equal(texture.colorSpace, '');
	assert.equal(texture.generateMipmaps, false);
	material.dispose();
	source.dispose();
	texture.dispose();
});

test('missing native UV and source roles fail explicitly', () => {
	const profile = fixture();
	const source = new MeshStandardMaterial();
	assert.throws(() => createCabinetStaticMaterial(profile, {}, source), /missing native source role/);

	const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
	const inputs = Object.fromEntries(Object.keys(profile.textures).map((role) => [role, texture]));
	const material = createCabinetStaticMaterial(profile, inputs, source);
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
	geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1], 3));
	geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1], 4));
	geometry.setAttribute('uv', new Float32BufferAttribute([0, 0], 2));
	assert.throws(
		() => material.onBeforeRender({} as any, {} as any, {} as any, geometry, {} as any, null as any),
		/missing native geometry uv1/,
	);
	assert.throws(() => validateCabinetStaticProfile({ ...profile, second: { ...profile.second!, height: 1 } }), /parallax/);
	assert.equal(readFurnitureCabinetStatic({ ...profile, requiredUV: [0] }), null);
	geometry.setAttribute('uv1', new Float32BufferAttribute([0, 0], 2));
	assert.throws(() => assertCabinetStaticGeometry(geometry, profile), /uv2/);
	geometry.setAttribute('uv2', new Float32BufferAttribute([0, 0], 2));
	assert.doesNotThrow(() => assertCabinetStaticGeometry(geometry, profile));
	material.dispose();
	source.dispose();
	texture.dispose();
	geometry.dispose();
});
