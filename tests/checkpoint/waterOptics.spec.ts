import { describe, expect, it } from 'vitest';
import { ShaderChunk } from 'three';
import { waterVolumeLights } from '../../src/materials/water/waterOptics.js';

describe('single-layer water illumination transport', () => {
	it('uses the existing shadowed directional irradiance without duplicating shadow samples', () => {
		const original = ShaderChunk.lights_fragment_begin;
		const actual = waterVolumeLights(original);
		const shadow = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap';
		expect(actual.indexOf('waterDirectionalScatter +=')).toBeGreaterThan(actual.indexOf(shadow));
		expect(actual.split('getShadow(').length).toBe(original.split('getShadow(').length);
		expect(actual.split('RE_Direct(').length).toBe(original.split('RE_Direct(').length);
		expect(actual.split('waterDirectionalScatter +=').length).toBe(2);
	});

	it('leaves point, spot, area and indirect light sampling intact', () => {
		const original = ShaderChunk.lights_fragment_begin;
		const actual = waterVolumeLights(original);
		const directionalStart = original.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
		const areaStart = original.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
		expect(actual).toContain(original.slice(0, directionalStart));
		expect(actual.endsWith(original.slice(areaStart))).toBe(true);
	});

	it('rejects a changed light-chunk layout rather than silently losing volume lighting', () => {
		expect(() => waterVolumeLights('')).toThrow();
		expect(() =>
			waterVolumeLights(
				ShaderChunk.lights_fragment_begin.replace(
					'DirectionalLight directionalLight;',
					'DirectionalLight directionalLight;\nRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
				),
			),
		).toThrow();
	});
});
