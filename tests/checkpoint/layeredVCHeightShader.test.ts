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
import { readFurnitureLayered, type FurnitureLayered, type LayeredRole } from '../../src/materials/layered/layeredShader.js';
import { applyShadingQuality } from '../../src/runtime/shadingQuality.js';
import {
	assertLayeredVCHeightGeometry,
	createLayeredVCHeightMaterial,
} from '../../src/materials/layered/layeredVCHeightShader.js';

function fixture(): FurnitureLayered {
	const roles: LayeredRole[] = ['D', 'N', 'O', 'D1', 'N1', 'O1', 'B', 'C'];
	const layer: FurnitureLayered['layers'][number] = {
		uv: [1, 0, 0, 0],
		transform: [1, 1, 0, 0],
		normalUv: [1, 0, 0, 0],
		color: [1, 1, 1],
		albedo: [1, 1, 1],
		normalEncoding: 'rg',
		normalIntensity: 1,
		roughness: [0, 1],
		ao: 1,
	};
	return {
		family: 'layered-static',
		version: 1,
		mode: 'vc-height-2',
		colorMask: true,
		requiredUv: [0, 1],
		uvFallback: 'none',
		layers: [layer, structuredClone(layer)],
		blend: [1, 1, 1, 0],
		edge: [0, 0, 0],
		vertexChannel: [0, 0, 0, 0],
		metalness: [0, 0],
		ao: [0, 0],
		specular: 0.5,
		useOrm: 0,
		emissive: [[0, 0, 0], [0, 0, 0]],
		textures: Object.fromEntries(roles.map(role => [role, {
			key: role,
			slice: -1,
			srgb: role === 'D' || role === 'D1',
			mipmaps: true,
			filter: 'TF_Default',
			addressX: 'TA_Wrap',
			addressY: 'TA_Wrap',
			sampler: 'view-world-wrap',
		}])),
		vcHeight: {
			pixelShader: '07385a259233546134b62ca90e44aa6ba38dbbd6',
			edgeTiling: 1,
			edgeContrast: 1,
			edgeIntensity: 1,
			aoRange: [[0.75, 1], [0.75, 1]],
			baseColorAO: [0, 0],
			aoChannels: [1, 0, 0, 0],
			aoAtlas: [0.25, 0, 0],
			specular: [0, 2],
		},
	};
}

test('VCHeight tangent-space normal consumers follow the active normal macro at every quality', () => {
	const config = fixture();
	const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
	const inputs = Object.fromEntries(Object.keys(config.textures).map(role => [role, texture]));
	for (const flatShading of [false, true]) {
		for (const quality of ['original', 'performance', 'economy'] as const) {
			const source = new MeshStandardMaterial({ flatShading });
			const material = createLayeredVCHeightMaterial(config, inputs, source);
			try {
				applyShadingQuality(material, quality, 'layered');
				const shader = {
					vertexShader: ShaderLib.standard.vertexShader,
					fragmentShader: ShaderLib.standard.fragmentShader,
					uniforms: {},
				} as any;
				material.onBeforeCompile(shader, {} as any);
				assert.match(shader.fragmentShader, /#ifdef USE_NORMALMAP_TANGENTSPACE\s+vec3 vcN0=[\s\S]*?normal=normalize\(tbn\*vcNativeNormal\);\s+#endif/);
				assert.equal(shader.fragmentShader.includes('#undef USE_NORMALMAP_TANGENTSPACE'), quality === 'economy');
				assert.equal(material.flatShading, flatShading);
				assert.ok(material.normalMap);
				assert.match(shader.fragmentShader, /vcWeight=clamp/);
				assert.match(shader.vertexShader, /vVCColorR=ueLayerColor.r/);
			} finally {
				material.dispose();
				source.dispose();
			}
		}
	}
	texture.dispose();
});

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
