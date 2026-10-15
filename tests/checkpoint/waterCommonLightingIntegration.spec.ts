import { describe, expect, it } from 'vitest';
import { ShaderLib } from 'three';
import {
	createWaterMaterial,
	type FurnitureWater,
} from '../../src/materials/water/waterShader.js';

function config(core: FurnitureWater['core'] = 'common-trans'): FurnitureWater {
	return {
		core,
		family: 'translucent-water',
		absorption: [1.1165369749069214, 0.7407407164573669, 0.969049870967865],
		scattering: [0, 0, 0],
		proxyDepth: 20,
		transmittance: 0.9900000095367432,
		baseAlpha: 1,
		alphaBlend: 0,
		alphaPower: 1,
		alphaFresnel: [0, 1],
		tint: [1, 1, 1],
		emissive: [0, 0, 0],
		textureSRGB: [false, false, false, true],
		textureMipmaps: [false, true, true, true],
		color: [1.375, 6, 4.612500190734863],
		baseBrightness: 1,
		basePower: 1,
		opacity: [0.94, 0.94],
		coverage: 0.9399999976158142,
		metalness: 0,
		roughness: 0.1,
		f0: 0.020400000736117363,
		normalStrength: 0,
		uv: [1, 1, 0, 0],
		normalUv: [1, 1, 0, 0],
		flow: [0, 0],
		normalFlow: [0, 0],
		ripple: [0, 0],
		opticalDepth: { edgeScale: 10, edgePower: 1, waterTrans: 0.9399999976158142 },
	};
}

function compile(input = config()) {
	const material = createWaterMaterial(input, null, null);

	const shader = {
		uniforms: {} as Record<string, { value: unknown }>,
		vertexShader: ShaderLib.standard.vertexShader,
		fragmentShader: ShaderLib.standard.fragmentShader,
	};

	material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], undefined as never);

	const key = material.customProgramCacheKey();
	material.dispose();
	return { ...shader, key };
}

describe('local CommonTrans surface', () => {
	it('uses white-surface lighting and declared proxy depth without captured scene inputs', () => {
		const { fragmentShader: fragment, uniforms } = compile();
		expect(fragment).not.toMatch(/waterCommonSurface|waterSceneColor|waterSceneDepth|waterOpticalPath/);
		expect(fragment).toContain('#include <lights_physical_fragment>');
		expect(fragment).toContain('material.diffuseContribution = vec3(1.0);');
		expect(fragment).toContain('exp(-max(waterProxyDepth, 0.0) * (waterAbsorption + waterScattering))');
		expect(uniforms.waterAbsorption!.value).toMatchObject({
			r: config().absorption[0],
			g: config().absorption[1],
			b: config().absorption[2],
		});
		expect(uniforms.waterProxyDepth!.value).toBe(config().proxyDepth);
		expect(uniforms.waterTransmittance!.value).toBe(config().transmittance);
		expect(Object.keys(uniforms)).not.toEqual(expect.arrayContaining(['waterSceneColor', 'waterSceneDepth', 'waterHasScene']));
	});

	it('separates body transmission from the already weighted reflection', () => {
		const { fragmentShader: fragment } = compile();
		expect(fragment).toContain('waterEmission = waterNativeAlpha * waterLight * waterIntrinsic;');
		expect(fragment).toContain('waterReflection *= waterNativeAlpha;');
		expect(fragment).toContain('waterCoverage = 1.0 - waterTransmissionScalar;');
		expect(fragment).toContain('waterPremultiplied / waterCoverage');
		expect(fragment).not.toMatch(/waterReflection\s*\*=?\s*waterF/);
		expect(fragment).not.toContain('waterCoverage *= waterL;');
		expect(fragment).toContain('#include <colorspace_fragment>');
		expect(fragment).not.toMatch(/attribute\s+\w+\s+color|varying\s+\w+\s+.*VertexB/);
	});

	it.each([
		[0, 20, 0.6],
		[0.99, 20, 0.6],
		[1, 0, 0.6],
		[0.99, 20, 0],
		[0.99, 20, 1],
	])(
		'reconstructs intrinsic + spectral transport with one linear blend: T=%s depth=%s coverage=%s',
		(t, depth, coverage) => {
			const clamp = (value: number) => Math.max(0, Math.min(1, value));
			const background = [0.3, 0.4, 0.7];
			const raw = [0.2, 0.6, 0.8];
			const light = [0.8, 0.6, 0.9];
			const reflection = [0.02, 0.03, 0.04];
			const transmission = [0, 0.04, 0.1].map((absorption) => Math.exp(-depth * absorption));
			const behind = transmission.map((value, i) => value * background[i]!);
			const loss = 1 - Math.max(...behind);
			const nativeAlpha = clamp(loss * coverage);
			const weight = clamp(loss * t) ** 2;
			const nativeRgb = raw.map((value, i) => clamp(value * (1 - weight) + behind[i]! * weight));
			const transport = transmission.map((value, i) => Math.min(value * weight, nativeRgb[i]! / background[i]!));
			const intrinsic = nativeRgb.map((value, i) => Math.max(value - transport[i]! * background[i]!, 0));
			const destination = transport.map((value) => clamp(1 - nativeAlpha + nativeAlpha * value));
			const scalar = Math.min(...destination);
			const alpha = 1 - scalar;
			expect(alpha).toBeGreaterThanOrEqual(0);
			expect(alpha).toBeLessThanOrEqual(nativeAlpha);
			if (coverage > 0) expect(alpha).toBeLessThan(coverage);
			for (let i = 0; i < 3; i++) {
				const emission = nativeAlpha * light[i]! * intrinsic[i]!;
				const premultiplied = emission + (destination[i]! - scalar) * background[i]! + nativeAlpha * reflection[i]!;
				const rgb = alpha > 0 ? premultiplied / alpha : 0;
				expect(Number.isFinite(rgb)).toBe(true);
				// This is a linear-domain identity, not a claim about tone-mapped pixels.
				expect(rgb * alpha + (1 - alpha) * background[i]!).toBeCloseTo(
					emission + destination[i]! * background[i]! + nativeAlpha * reflection[i]!,
					12,
				);
			}
		},
	);

	it('versions local optics while retaining distinct wave-family programs', () => {
		expect(compile().key).toBe('local_optics_v7_wave_false_caustics_false_furniture_water_common_v9_common-trans_false_true_false');
		for (const core of ['slw', 'nature-pool', 'special-trans', 'default'] as const) {
			const result = compile(config(core));
			expect(result.key).toContain(`furniture_water_v7_${core}`);
			expect(result.fragmentShader).not.toContain('vec4 waterCommonSourceOptics(');
			expect(result.fragmentShader).not.toContain('waterCommonSurface');
		}
	});
});
