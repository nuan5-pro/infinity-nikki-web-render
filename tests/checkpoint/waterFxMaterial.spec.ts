import { describe, expect, it, vi } from 'vitest';
import {
	AdditiveBlending,
	NormalBlending,
	ShaderLib,
	BufferGeometry,
	CubeTexture,
	DataTexture,
	Float32BufferAttribute,
	PerspectiveCamera,
	Scene,
} from 'three';
import {
	createLightweightWaterFxMaterial,
	type WaterFxMaterialOptions,
} from '../../src/materials/water/waterFxMaterial.js';
import {
	waterFxActiveInputs,
	waterFxTextureKeys,
	type WaterFX,
} from '../../src/materials/water/waterFx.js';

function fixture(): WaterFX {
	const material = Array.from({ length: 35 }, () => [0, 0, 0, 0]);
	material[21] = [0.3, 0.3, 0.3, 1];
	material[22] = [0, 1, 1, 1];
	material[25] = [0, 0, 0, 0];
	material[27] = [0.1, 0, 0.65, 1];
	material[30] = [0, 2, 0.7, 0];
	material[32] = [0, 0, 0, 1];
	material[33] = [1, 0.5, 4, 90];
	material[34] = [200, 0, 1, 0.8];
	return {
		blend: 'additive',
		material,
		textures: Object.fromEntries(waterFxTextureKeys.map((key) => [key, `/native/${key}`])),
		shader: 'cd1d929db9a76a43e10b8bfe42bc8abbf6845982',
		requires: [],
	};
}

const options: WaterFxMaterialOptions = {
	lighting: 'editor-standard-preview',
	lightingEvidence: 'test explicit editor scene',
	basisEvidence: 'test source-native TBN',
	nativeBitangentSign: -1,
	viewEvidence: 'test unpreexposed linear domain',
	emissiveScale: 1,
	preExposure: 1,
	roughness: 0.04,
	metalness: 0,
	primitiveHoldout: 0,
	nativePrimitiveSign: 1,
	objectCenter: [0, 0, 0],
	objectCenterEvidence: 'test source bounds',
	previewTimeOfDay: 0.25,
};

const textures = () =>
	Object.fromEntries(
		waterFxTextureKeys.map((key) => [
			key,
			key === 'Cubemap' ? new CubeTexture() : new DataTexture(),
		]),
	);

describe('native FX actual factory contracts', () => {
	it('builds local straight-alpha flow with source masks and no depth binding', () => {
		for (const blend of ['additive', 'translucent'] as const) {
			const config = { ...fixture(), blend };
			const material = createLightweightWaterFxMaterial(config, textures(), options);

			const shader = {
				uniforms: {},
				vertexShader: ShaderLib.standard.vertexShader,
				fragmentShader: ShaderLib.standard.fragmentShader,
			};

			material.onBeforeCompile(shader as never, undefined as never);
			expect(material.blending).toBe(blend === 'additive' ? AdditiveBlending : NormalBlending);
			expect(material.toneMapped).toBe(true);
			expect(material.depthWrite).toBe(false);
			expect(shader.fragmentShader).not.toMatch(/fxSceneDepth|waterFxDepthDeltaCm|coverage\*=clamp\(depthDeltaCm/);
			expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
			expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
			expect(shader.fragmentShader).toContain('gl_FragColor=vec4(outgoingLight,fxValue.coverage*(1.0-fxHoldout))');

			const geometry = new BufferGeometry();
			geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
			geometry.setAttribute('uv', new Float32BufferAttribute([0, 0], 2));
			geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1], 3));
			geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1], 4));
			geometry.setAttribute('ueWaterFxColor', new Float32BufferAttribute([1, 1, 1, 1], 4));
			geometry.userData.waterFxColorProof = { projectionBasisVerified: true };
			expect(() => material.onBeforeRender({} as never, new Scene(), new PerspectiveCamera(), geometry, {} as never, null as never)).not.toThrow();
			material.dispose();
		}
	});

	it('reuses uniform-only variants but separates source-constant GLSL and native output', () => {
		const a = createLightweightWaterFxMaterial(fixture(), textures(), options);
		const b = createLightweightWaterFxMaterial(fixture(), textures(), {
			...options,
			roughness: 0.5,
			emissiveScale: 2,
		});
		expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());

		const changed = fixture();
		changed.material[30]![2] = 0.26;
		expect(createLightweightWaterFxMaterial(changed, textures(), options).customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
	});
	it('borrows caller textures and rejects an invalid local TOD selection', () => {
		const bindings = textures();
		const disposal = Object.values(bindings).map((texture) => vi.spyOn(texture, 'dispose'));
		createLightweightWaterFxMaterial(fixture(), bindings, options).dispose();
		for (const spy of disposal) expect(spy).not.toHaveBeenCalled();

		expect(() => createLightweightWaterFxMaterial(fixture(), bindings, { ...options, previewTimeOfDay: 2 })).toThrow(/TOD/);
	});
	it('refuses absent source view/basis evidence', () => {
		expect(() => createLightweightWaterFxMaterial(fixture(), textures(), { ...options, basisEvidence: '' })).toThrow('basis/view');
	});
	it('requires native RGBA and TBN admission, not a bare white attribute', () => {
		const material = createLightweightWaterFxMaterial(fixture(), textures(), options);
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
		geometry.setAttribute('uv', new Float32BufferAttribute([0, 0], 2));
		geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1], 3));
		geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1], 4));
		geometry.setAttribute('ueWaterFxColor', new Float32BufferAttribute([1, 1, 1, 1], 4));

		const draw = () => material.onBeforeRender({} as never, new Scene(), new PerspectiveCamera(), geometry, {} as never, null as never);

		expect(draw).toThrow('admission');
		geometry.userData.waterFxColorProof = { projectionBasisVerified: true };
		expect(draw).not.toThrow();
	});
	it('does not share a statically folded shader across differing authored parameters', () => {
		const a = fixture();
		const b = fixture();
		b.material[30]![2] = 0.26;

		const first = createLightweightWaterFxMaterial(a, textures(), options);
		const second = createLightweightWaterFxMaterial(b, textures(), options);
		expect(first.customProgramCacheKey()).not.toBe(second.customProgramCacheKey());
		expect(first.toneMapped).toBe(true);
	});
	it('does not demand dead emission resources in a source-unlit FBlend0 leaf', () => {
		const config = fixture();
		const active = waterFxActiveInputs(config, false);
		expect(active.textures.has('SMaskMap')).toBe(false);
		expect(active.textures.has('OccMap')).toBe(false);
		expect(active.textures.has('Cubemap')).toBe(true);

		const supplied = Object.fromEntries(Object.entries(textures()).filter(([key]) => active.textures.has(key)));
		createLightweightWaterFxMaterial(config, supplied, {
			...options,
			lighting: 'source-unlit-proven',
			lightingEvidence: 'test only; explicit source unlit evidence required',
		});
	});
});
