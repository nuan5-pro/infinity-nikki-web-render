import { describe, expect, it } from 'vitest';
import { ShaderLib, Texture } from 'three';
import {
	createLEDSignPreviewMaterial,
	readFurnitureLEDSignPreview,
	type FurnitureLEDSignPreview,
} from '../../src/materials/effects/ledSignPreviewShader.js';

function fixture(): FurnitureLEDSignPreview {
	const texture = (parameter: string) => ({
		parameter,
		sRGB: true,
		rgbScale: 1,
		addressX: 'TA_Wrap',
		addressY: 'TA_Wrap',
		mipmaps: true,
		nearest: false,
		cube: false,
	});

	return {
		version: 1,
		family: 'led-sign-scroll',
		requiredUv: [0],
		scalars: {
			LogoHueShift: -0.037333,
			'Logo Angle': 0,
			LogoSaturation: 1,
			Min_Scroll: 1.5,
			Max_Scroll: 20,
			'Emissive Amount': 5,
			Opacity: 1,
		},
		colors: {
			'Logo UV': [1, 1, 0.2, 0],
			'Scroll Scale/Speed': [3, 1, 1, 0],
			EmissiveColor: [1, 1, 1, 1],
			Color: [0, 0, 0, 0],
		},
		textures: { D: texture('Logo'), O: texture('Scroll Texture') },
	};
}

describe('LED Sign scroll colour core', () => {
	it('retains Logo, scroll-red, native negative saturation and HDR through production output', () => {
		const config = fixture();
		expect(readFurnitureLEDSignPreview(config)).toBe(config);

		const material = createLEDSignPreviewMaterial(config, { D: new Texture(), O: new Texture() });

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
		};

		material.onBeforeCompile(shader as never, {} as never);
		expect(shader.fragmentShader).toContain('logo-=ledLogoSaturation*(vec3(luminance)-logo)');
		expect(shader.fragmentShader).toContain('texture2D(ledO,vLEDUV*ledScroll_Scale_Speed.xy).r');
		expect(shader.fragmentShader).toContain('ledEmissiveColor.rgb*ledEmissive_Amount');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(material.forceSinglePass).toBe(true);
		material.dispose();
	});

	it('does not invent a missing inherited scroll texture or scene base-lighting term', () => {
		expect(() => createLEDSignPreviewMaterial(fixture(), { D: new Texture() })).toThrow('missing O');

		const value = fixture();
		value.colors.Color = [1, 1, 1, 0];
		expect(readFurnitureLEDSignPreview(value)).toBeNull();
	});
});
