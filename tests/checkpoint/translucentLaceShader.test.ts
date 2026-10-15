import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	AddEquation,
	DataTexture,
	DoubleSide,
	LessEqualDepth,
	MeshStandardMaterial,
	NoBlending,
	OneFactor,
	OneMinusSrcAlphaFactor,
	ShaderLib,
	SrcAlphaFactor,
	ZeroFactor,
} from 'three';
import {
	createTranslucentLaceDepthMaterial,
	createTranslucentLaceMaterial,
	evaluateTranslucentLace,
	readFurnitureTranslucentLace,
	translucentLaceNormalSigns,
	type FurnitureTranslucentLace,
	type TranslucentLacePass,
} from '../../src/materials/glass/translucentLaceShader.js';
import { translucentLaceDrawGroup } from '../../src/materials/glass/translucentLacePrepass.js';

test('actual draw group narrows structurally and full draw preserves range semantics', () => {
	const group = { start: 9, count: 6, materialIndex: 1 };
	assert.equal(translucentLaceDrawGroup(group), group);
	assert.deepEqual(translucentLaceDrawGroup(null), { start: 0, count: Infinity });
	assert.deepEqual(translucentLaceDrawGroup(undefined), { start: 0, count: Infinity });
	for (const invalid of [
		{ isGroup: true },
		{ start: -1, count: 6 },
		{ start: 0, count: NaN },
		{ start: 0.5, count: 3 },
		{ start: 0, count: 3, materialIndex: '1' },
	]) {
		assert.throws(() => translucentLaceDrawGroup(invalid), /Invalid translucent lace geometry draw group/);
	}
});

function fixture(): FurnitureTranslucentLace {
	const pass = (depth: boolean): TranslucentLacePass => ({
		type: depth ? 'depth-prepass' : 'color',
		queue: depth ? 0 : 1,
		colorWrite: !depth,
		depthWrite: depth,
		depthFunc: 'less-equal',
		cull: 'none',
		blend: 'grey-transmittance',
		blendSrc: 'src-alpha',
		blendDst: 'one-minus-src-alpha',
		blendSrcAlpha: 'zero',
		blendDstAlpha: 'one-minus-src-alpha',
	});

	return {
		family: 'translucent-lace',
		version: 1,
		approximation: 'captured static consumer, editor lighting',
		pixelShader: '7e40987198bd815542a9be4902b8acf3db16500e',
		depthPixelShader: '06500db8834544a89adf16db40895b6831dfe25c',
		depthCutoff: 0.33722156286239624,
		color: [0.3125, 0.3125, 0.3125, 0],
		fuzzy: [3, 0.1, 0.2],
		opacity: [0, 0.4, 1, 0.5],
		uvScale: 1,
		rotation: 0,
		detailUvScale: 30,
		detailFlatness: 0.5,
		roughness: [0, 1],
		metalness: 0,
		specular: 0.5,
		scheduling: 'native-queue-scope-unproved',
		textures: [
			{
				key: 'Albedo Map',
				sRGB: true,
				mipmaps: true,
				nearest: false,
				wrap: ['TA_Wrap', 'TA_Wrap'],
				encoding: 'rgba',
				sampler: 'view-world-wrap',
			},
			{
				key: 'Normal Map(LinearColor)',
				sRGB: false,
				mipmaps: true,
				nearest: false,
				wrap: ['TA_Wrap', 'TA_Wrap'],
				encoding: 'native-rg',
				sampler: 'view-world-wrap',
			},
			{
				key: 'DetailNormalMap',
				sRGB: false,
				mipmaps: true,
				nearest: false,
				wrap: ['TA_Wrap', 'TA_Wrap'],
				encoding: 'native-rg',
				sampler: 'texture-asset',
			},
		],
		passes: [pass(true), pass(false)],
	};
}

test('native fuzzy and edge alpha preserve grey source and independent tint alpha', () => {
	const c = fixture();
	const front = evaluateTranslucentLace(c, [1, 1, 1, 1], 1, 1);
	assert.deepEqual(front.base, [0.25, 0.25, 0.25]);
	assert.ok(Math.abs(front.alpha - 0.20005) < 1e-12);
	assert.equal(front.depthCovered, false);

	const grazing = evaluateTranslucentLace(c, [1, 1, 1, 1], 0, 0);
	assert.deepEqual(grazing.base, [0.34375, 0.34375, 0.34375]);
	assert.equal(grazing.alpha, 0.7);
	assert.equal(grazing.depthCovered, true);

	const back = evaluateTranslucentLace(c, [1, 1, 1, 1], 0, -1);
	assert.deepEqual(back.base, grazing.base);
	assert.equal(back.alpha, grazing.alpha);
	assert.ok(evaluateTranslucentLace(c, [1, 1, 1, 0], 1, 1).alpha > 0);
	assert.deepEqual(c.color, [0.3125, 0.3125, 0.3125, 0]);
});

test('native RG reflection composes loader phase, not normalScale amplitude', () => {
	const source = new MeshStandardMaterial();
	source.normalScale.set(1, 1);
	assert.deepEqual(translucentLaceNormalSigns(source), [1, -1]);
	source.normalScale.set(2, -3);
	assert.deepEqual(translucentLaceNormalSigns(source), [1, 1]);
	source.userData.translucentLaceNormalSigns = [1, -1];
	assert.deepEqual(translucentLaceNormalSigns(source), [1, -1]);
	source.dispose();
});

test('paired draw preserves callback/group and adapts only canvas target alpha', () => {
	const source = new MeshStandardMaterial();
	let previousCalls = 0;
	source.onBeforeRender = () => {
		previousCalls++;
	};

	const images = [new DataTexture(), new DataTexture(), new DataTexture()];
	const color = createTranslucentLaceMaterial(
		fixture(),
		{
			albedo: images[0]!,
			normal: images[1]!,
			detailNormal: images[2]!,
			normalSigns: [1, -1],
			detailNormalSigns: [1, -1],
		},
		source,
	);
	let alpha = true;
	let target: object | null = null;
	const draws: any[][] = [];

	const renderer = {
		getContext: () => ({ getContextAttributes: () => ({ alpha }) }),

		getRenderTarget: () => target,

		renderBufferDirect: (...args: any[]) => draws.push(args),
	} as any;

	const camera = {};
	const scene = {};
	const geometry = {};
	const object = {};
	const group = { start: 9, count: 6 };

	const draw = () => color.onBeforeRender(renderer, scene as any, camera as any, geometry as any, object as any, group);

	draw();
	assert.equal(color.blendSrcAlpha, OneFactor);
	assert.equal(color.blendSrc, SrcAlphaFactor);
	assert.equal(color.blendDst, OneMinusSrcAlphaFactor);
	assert.equal(color.userData.translucentLaceCanvasAlphaAdapter, 'accumulated-canvas-opacity');
	target = {};
	draw();
	assert.equal(color.blendSrcAlpha, ZeroFactor);
	target = null;
	alpha = false;
	draw();
	assert.equal(color.blendSrcAlpha, ZeroFactor);
	assert.equal(previousCalls, 3);
	assert.equal(draws.length, 3);

	const depth = draws[0]![3] as MeshStandardMaterial;
	assert.equal(depth.map, color.map);
	assert.equal(depth.normalMap, color.normalMap);
	assert.equal(draws[0]![0], camera);
	assert.equal(draws[0]![1], scene);
	assert.equal(draws[0]![2], geometry);
	assert.equal(draws[0]![4], object);
	assert.equal(draws[0]![5], group);

	let disposed = 0;
	depth.addEventListener('dispose', () => {
		disposed++;
	});
	color.dispose();
	assert.equal(disposed, 1);
	source.dispose();
	images.forEach((t) => t.dispose());
});

test('native depth threshold uses precise DXBC float and preserves equality', () => {
	const c = fixture();
	c.opacity = [c.depthCutoff, c.depthCutoff, 1, 0];
	assert.equal(evaluateTranslucentLace(c, [1, 1, 1, 1], 1, 1).depthCovered, true);

	const f32 = new Float32Array([c.depthCutoff]);
	const bits = new Uint32Array(f32.buffer);
	bits[0] = bits[0]! - 1;
	c.opacity = [f32[0]!, f32[0]!, 1, 0];
	assert.equal(evaluateTranslucentLace(c, [1, 1, 1, 1], 1, 1).depthCovered, false);
	assert.equal(readFurnitureTranslucentLace({ ...c, depthCutoff: 0.3333 }), null);
	assert.equal(readFurnitureTranslucentLace({ ...c, scheduling: 'global-prepass' }), null);
});

test('color and native-coverage depth share RNM without automatic face duplication', () => {
	const c = fixture();
	assert.equal(readFurnitureTranslucentLace(c), c);

	const images = [new DataTexture(), new DataTexture(), new DataTexture()];
	const source = new MeshStandardMaterial();
	source.name = 'native-exact-lace';
	source.userData.clothNormalSigns = [1, -1];

	const color = createTranslucentLaceMaterial(
		c,
		{
			albedo: images[0]!,
			normal: images[1]!,
			detailNormal: images[2]!,
			normalSigns: [1, -1],
			detailNormalSigns: [1, -1],
		},
		source,
	);
	const depth = createTranslucentLaceDepthMaterial(color);

	const compile = (material: MeshStandardMaterial) => {
		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		} as any;

		material.onBeforeCompile(shader, {} as any);
		return shader;
	};

	const cs = compile(color);
	const ds = compile(depth);
	for (const shader of [cs, ds]) {
		assert.doesNotMatch(shader.fragmentShader, /normal \*= faceDirection;/);
		assert.doesNotMatch(shader.fragmentShader, /tbn\[[01]\] \*= faceDirection;/);
		assert.equal((shader.fragmentShader.match(/normal = laceUnflippedN \* faceDirection;/g) ?? []).length, 1);
		assert.match(shader.fragmentShader, /laceRNM = laceT \* dot\(laceT, laceU\) - laceU \* laceT.z;/);
		assert.match(shader.fragmentShader, /laceFuzzyN = normalize\(tbn \* vec3\(laceRNM.xy, laceRNM.z \* faceDirection\)\);/);
		assert.match(shader.fragmentShader, /dot\(laceView, laceFuzzyN\)/);
		assert.match(shader.fragmentShader, /laceSample.a/);
		assert.deepEqual(shader.uniforms.laceNormalSigns.value.toArray(), [1, -1]);
		assert.equal(shader.uniforms.laceDepthCutoff.value, 0.33722156286239624);
		assert.equal(shader.uniforms.lacePrimitiveFade.value, 1);
	}

	assert.match(ds.fragmentShader, /if \(laceAlpha \* lacePrimitiveFade < laceDepthCutoff\) discard;/);
	assert.doesNotMatch(cs.fragmentShader, /discard;/);
	assert.doesNotMatch(ds.fragmentShader, /PhysicalMaterial material;/);
	assert.equal(color.blendEquation, AddEquation);
	assert.equal(color.blendSrc, SrcAlphaFactor);
	assert.equal(color.blendDst, OneMinusSrcAlphaFactor);
	assert.equal(color.blendSrcAlpha, ZeroFactor);
	assert.equal(color.blendDstAlpha, OneMinusSrcAlphaFactor);
	assert.equal(color.premultipliedAlpha, false);
	assert.equal(color.depthWrite, false);
	assert.equal(depth.depthWrite, true);
	assert.equal(depth.colorWrite, false);
	assert.equal(depth.blending, NoBlending);
	assert.equal(depth.depthFunc, LessEqualDepth);
	assert.equal(depth.side, DoubleSide);
	assert.equal(depth.map, color.map);
	assert.deepEqual(source.userData.clothNormalSigns, [1, -1]);
	assert.equal(color.roughness, 0.5);
	assert.equal(color.metalness, 0);
	depth.dispose();
	color.dispose();
	source.dispose();
	images.forEach((t) => t.dispose());
});
