import { describe, expect, it } from 'vitest';
import { DataTexture, FrontSide, ShaderLib, type WebGLRenderer } from 'three';
import {
	createAnimalSimpleTransMaterial,
	readFurnitureAnimalSimpleTrans,
	type FurnitureAnimalSimpleTrans,
} from '../../src/materials/effects/animalSimpleTransShader.js';

function fixture(): FurnitureAnimalSimpleTrans {
	const scalars: Record<string, number> = {};
	for (const key of [
		'Main_Tiling',
		'Main_NTiling',
		'Main_NormalIntensity',
		'Emissive_FresnelMask_Range',
		'Emissive_FresnelMask_Power',
		'FresnelMask_Add_ExtraMask',
		'EdgeLight_Range',
		'EdgeLight_UseCoatingMask',
		'Glow_speed_X',
		'Glow_speed_Y',
		'Glow_Tile',
		'Glow_Brightness',
		'Glow_BreathSpeed',
		'Glow_BreathInterval',
		'Glow_BreathEnhance',
		'Rainbow_Warp_Tiling',
		'Rainbow_Warp',
		'Rainbow_Tiling',
		'Rainbow_D_BlendWeight',
		'RainbowEmissiveInShadow',
		'CoatingPower',
		'CoatingBaseReflect',
		'CoatingModeSelect',
		'CoatingEmissiveInShadow',
		'AnimalEmissiveBackSide',
		'AnimalEmissivewithLighting',
		'Opacity_Min',
		'Opacity_Max',
		'Opacity_EdgeRange',
		'Opacity_BlendMode',
		'GlintsEmissiveInShadow',
		'GlintSizeMax',
		'GlintSizeMin',
		'GlintDensity',
		'GlintSpeedbyTime',
		'GlintRoughness',
		'GlintColorRandom',
		'GlintColorbyDiffuse',
		'GlintwithLighting',
	])
		scalars[key] = 1;

	const colors: Record<string, [number, number, number, number]> = {};
	for (const key of [
		'Main_D_ColorTint',
		'Main_EmissiveColorTint',
		'EdgeLight_Color(A:EmissiveIntensity)',
		'Extra_UVSelect',
		'Glow_Color',
		'Rainbow_Warp_Panner',
		'Rainbow_Color(A:EmissiveIntensity)',
		'CoatingColorTint(A:EmissiveIntensity)',
	])
		colors[key] = [1, 1, 1, 1];

	colors.Extra_UVSelect = [1, 0, 0, 0];
	colors.GlintColor = [15, 11.358311, 4.23688, 0];

	const textures: FurnitureAnimalSimpleTrans['textures'] = {};
	for (const role of ['D', 'N', 'T', 'O', 'C', 'B', 'S', 'D1', 'O1'])
		textures[role] = {
			parameter: role,
			sRGB: role === 'D' || role === 'T',
			rgbScale: role === 'S' ? 32 : 1,
			addressX: 'TA_Wrap',
			addressY: 'TA_Clamp',
			mipmaps: true,
			nearest: false,
			cube: role === 'S',
		};

	return {
		version: 1,
		family: 'animal-simple-trans',
		variant: 'glow',
		requiredUv: [0],
		scalars,
		colors,
		textures,
	};
}

describe('AnimalSimpleTrans source colour core', () => {
	it('requires every active emission, glow, rainbow, mask and UV input', () => {
		const p = fixture();
		expect(readFurnitureAnimalSimpleTrans(p)).toBe(p);
		delete p.textures.D1;
		expect(readFurnitureAnimalSimpleTrans(p)).toBeNull();

		const q = fixture();
		q.colors.Extra_UVSelect = [0, 1, 0, 0];
		expect(readFurnitureAnimalSimpleTrans(q)).toBeNull();
	});

	it('preserves native colour roles, HDR emission, alpha and independent source samplers', () => {
		const p = fixture();
		const source = new DataTexture(new Uint8Array([128, 96, 32, 255]), 1, 1);
		const material = createAnimalSimpleTransMaterial(p, Object.fromEntries(Object.keys(p.textures).map((role) => [role, source])));

		const shader = {
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
			uniforms: {},
		} as Parameters<typeof material.onBeforeCompile>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader).toContain('texture2D(animalT,mainUV).rgb*aMain_EmissiveColorTint.rgb');
		expect(shader.fragmentShader).not.toContain('aMain_EmissiveColorTint.a');
		expect(shader.fragmentShader).toContain('texture2D(animalO1,vAnimalUV0).r*glowStrength');
		expect(shader.fragmentShader).toContain('vec2 zRG=rg*clamp(aMain_NormalIntensity,0.0,1.0)');
		expect(shader.fragmentShader).toContain('diffuseColor.rgb*=max(emission,vec3(0))');
		expect(shader.fragmentShader).not.toContain('clamp(base,0.0,1.0)+max(emission,vec3(0))');
		expect(shader.fragmentShader).toContain('mix(aOpacity_Min,aOpacity_Max,body.a)');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(shader.uniforms.animalT!.value).not.toBe(source);
		expect(shader.uniforms.animalN!.value.colorSpace).not.toBe(shader.uniforms.animalT!.value.colorSpace);
		expect(shader.uniforms.animalScaleS!.value).toBe(32);
		expect(shader.uniforms.aGlintColor!.value.x).toBe(15);
		expect(shader.fragmentShader).toContain('uvec3 p=uvec3(cell)*1664525u+1013904223u');
		expect(shader.fragmentShader).toContain('roundEven(extra.a*16.0)/16.0');
		expect(shader.fragmentShader).toContain('pow(max(dot(normal,halfDirection),0.0),6.0)*pow(front,3.0)');
		expect(shader.fragmentShader).toContain('emission+=glints*mix(1.0,glintLight,aGlintwithLighting)');
		expect(shader.vertexShader).toContain('vAnimalLocalPosition=position.xzy*100.0');
		expect(material.transparent).toBe(true);
		expect(material.side).toBe(FrontSide);
		expect(material.depthWrite).toBe(false);
		material.dispose();
		source.dispose();
	});

	it('uses the separate pattern program, UV selector, normal and alpha-weighted E without glow defaults', () => {
		const p = fixture();
		p.variant = 'pattern';
		p.requiredUv = [0, 2];
		Object.assign(p.scalars, {
			PatternHeightRatio: 0,
			Pattern_HueShift: 0,
			'Pattern Emissive': 2.5,
		});
		Object.assign(p.colors, {
			'Pattern UVSelect': [0, 0, 1, 0],
			'Pattern TilingOffset': [1, 1, 0, 0],
			Ani_2U_BlendAttr: [1, 1, 1, 1],
			Pattern_ColorTint: [1, 1, 1, 1],
		});
		p.textures.N1 = { ...p.textures.N!, parameter: 'Pattern Normal' };
		p.textures.D1!.parameter = 'Pattern Text';
		delete p.textures.O1;
		delete p.colors.Glow_Color;
		for (const key of Object.keys(p.scalars)) if (key.startsWith('Glow_')) delete p.scalars[key];

		expect(readFurnitureAnimalSimpleTrans(p)).toBe(p);

		const source = new DataTexture(new Uint8Array([128, 96, 32, 255]), 1, 1);
		const material = createAnimalSimpleTransMaterial(p, Object.fromEntries(Object.keys(p.textures).map((role) => [role, source])));

		const shader = {
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
			uniforms: {},
		} as Parameters<typeof material.onBeforeCompile>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(material.defines).toHaveProperty('ANIMAL_PATTERN');
		expect(shader.uniforms).toHaveProperty('animalN1');
		expect(shader.uniforms).not.toHaveProperty('animalO1');
		expect(shader.uniforms).not.toHaveProperty('aGlintColor');
		expect(shader.fragmentShader).toContain('animalUV(aPattern_UVSelect)');
		expect(shader.fragmentShader).toContain('patternColor*aPattern_Emissive,patternWeights.w');
		expect(shader.fragmentShader).toContain('pow(edgeBase+.01,aOpacity_EdgeRange)');
		expect(shader.fragmentShader).toContain('normal*=gl_FrontFacing?1.0:-1.0');
		expect(material.defines).toHaveProperty('ANIMAL_TWO_SIDED');

		const single = createAnimalSimpleTransMaterial(
			{ ...p, variant: 'pattern-single-sided' },
			Object.fromEntries(Object.keys(p.textures).map((role) => [role, source])),
		);
		expect(single.side).toBe(FrontSide);
		expect(single.defines).toHaveProperty('ANIMAL_PATTERN');
		expect(single.defines).not.toHaveProperty('ANIMAL_TWO_SIDED');
		single.dispose();
		p.requiredUv = [0];
		expect(readFurnitureAnimalSimpleTrans(p)).toBeNull();
		material.dispose();
		source.dispose();
	});
});
