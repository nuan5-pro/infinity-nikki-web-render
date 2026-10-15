import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	BufferGeometry,
	DataTexture,
	Float32BufferAttribute,
	MeshStandardMaterial,
	ShaderLib,
} from 'three';
import {
	createLayeredMaterial,
	readFurnitureLayered,
	type FurnitureLayered,
	type LayeredRole,
} from '../../src/materials/layered/layeredShader.js';

const root = process.env.ROCK_HOME_STAGED_FULL;

function actualConfig(model: string): FurnitureLayered {
	const bytes = readFileSync(`${root}/${model}`);
	const length = bytes.readUInt32LE(12);
	const doc = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
	const config = readFurnitureLayered(doc.materials.find((m: { extras?: { layered?: unknown } }) => m.extras?.layered)?.extras.layered);
	expect(config).not.toBeNull();
	return config!;
}

describe.skipIf(!root)('captured Rock Home Full consumers', () => {
	for (const name of [
		'S_NHBldg_Platform_12.glb',
		'S_NHBldg_Platform_12a.glb',
		'S_NHBldg_Platform_13.glb',
	]) {
		it(`${name}: saved array transfer/samplers and strict frame`, () => {
			const config = actualConfig(name);
			expect(config.mode).toBe('rock-home');

			const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
			const inputs = Object.fromEntries(Object.keys(config.textures).map((role) => [role, texture]));
			const source = new MeshStandardMaterial();
			source.userData.sourceProof = 'retain';

			const material = createLayeredMaterial(config, inputs, source);

			const shader = {
				vertexShader: ShaderLib.standard.vertexShader,
				fragmentShader: ShaderLib.standard.fragmentShader,
				uniforms: {},
			} as any;

			material.onBeforeCompile(shader, {} as any);
			expect(shader.fragmentShader).toContain('cross(vLayerWorldNormal, homeT) * vLayerNativeHandedness');
			expect(shader.fragmentShader).toContain('abs(vLayerWorldNormal.x)');
			expect(shader.fragmentShader).toContain('homePosition.zy');
			expect(shader.fragmentShader).toContain('homePosition.xz');
			expect(shader.fragmentShader).toContain('float homeTopWeight = vLayerColor.r');
			expect(shader.fragmentShader).toContain('homeArrayLinear(texture2D(layeredD2, homeTopUV).rgb * homeTopColor)');
			expect(shader.vertexShader).toContain('vLayerNativeHandedness = -vLayerWorldParity * tangent.w');
			expect(shader.uniforms.homeDetailScale.value).toBe(config.rockHome!.detailScale);
			expect(material.vertexColors).toBe(false);
			expect(material.alphaTest).toBe(0);
			expect(material.userData.sourceProof).toBe('retain');

			const geometry = new BufferGeometry();
			geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
			geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1], 3));
			geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, -1], 4));
			geometry.setAttribute('uv', new Float32BufferAttribute([0, 0], 2));
			geometry.setAttribute('ueLayerColor', new Float32BufferAttribute([1, 0, 0, 1], 4));
			expect(() => material.onBeforeRender({} as any, {} as any, {} as any, geometry, {} as any, {} as any)).toThrow(/verified native/);
			geometry.userData.ueLayerWorldFrameProof = {
				coordinateTransform: config.rockHome!.worldFrame,
				sourceNativeIndex: '_UE_VERTEX_INDEX',
				positionMatched: true,
				basisMatched: true,
				mismatches: 0,
			};
			expect(() => material.onBeforeRender({} as any, {} as any, {} as any, geometry, {} as any, {} as any)).not.toThrow();
			material.dispose();
			source.dispose();
			texture.dispose();
			geometry.dispose();
		});
	}

	it('rejects malformed transfer/slice/config instead of generic fallback', () => {
		const original = actualConfig('S_NHBldg_Platform_12.glb');
		for (const [role, patch] of [
			['D2', { srgb: true }],
			['N2', { slice: 0 }],
			['O2', { slice: 1 }],
			['D', { sampler: 'view-world-wrap' }],
		] as [LayeredRole, object][]) {
			const config = structuredClone(original);
			Object.assign(config.textures[role]!, patch);
			expect(readFurnitureLayered(config)).toBeNull();
		}

		expect(readFurnitureLayered({ ...original, rockHome: undefined })).toBeNull();
		expect(readFurnitureLayered({ ...original, rockHome: { ...original.rockHome, detailScale: 0 } })).toBeNull();
		expect(readFurnitureLayered({ ...original, coverage: 'diffuse-alpha', cutoff: 0.3333 })).toBeNull();
	});
});
