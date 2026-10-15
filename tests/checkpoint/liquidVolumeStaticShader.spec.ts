import { describe, expect, it } from 'vitest';
import { DataTexture, ShaderLib, type WebGLRenderer } from 'three';
import {
	createLiquidVolumeStaticMaterial,
	readFurnitureLiquidVolumeStatic,
	type FurnitureLiquidVolumeStatic,
} from '../../src/materials/glass/liquidVolumeStaticShader.js';

function fixture(): FurnitureLiquidVolumeStatic {
	const scalars = Object.fromEntries(
		[
			'Pattern_NIntensity',
			'Global_WorldOpacityMinValue',
			'Global_MobileOpScale',
			'Main_SceneColorIntensity',
			'Fabric_CustomSpecRange',
			'Main_HDRContrast',
			'Main_HDRRange',
			'Global_WorldEmissive',
		].map((key) => [key, 1]),
	);
	scalars.Main_HDRRange = -0.303449;

	const colors: FurnitureLiquidVolumeStatic['colors'] = {};
	for (const key of [
		'Fabric_NInfo',
		'Pattern_NTiling&Panner_01',
		'Main_MGA',
		'Opacity_Attr_02',
		'Fabric_CustomSpec',
		'Main_HDRColorTint(A:Emissive)',
		'Main_ColorTint(A:Emissive)',
		'Pattern_ColorTint(A:Emissive)',
		'Pattern_Tiling&Panner',
		'Fabric_RimColor(A:Emissive)',
	])
		colors[key] = [1, 1, 1, 1];

	const textures: FurnitureLiquidVolumeStatic['textures'] = {};
	for (const role of ['D', 'N', 'O', 'N1', 'N2', 'D1', 'D2', 'S'])
		textures[role] = {
			parameter: role,
			sRGB: ['D', 'O', 'D1', 'D2'].includes(role),
			rgbScale: role === 'S' ? 16 : 1,
			addressX: 'TA_Wrap',
			addressY: 'TA_Wrap',
			mipmaps: true,
			nearest: false,
			cube: role === 'S',
		};

	return {
		version: 1,
		family: 'liquid-volume-static',
		requiredUv: [0, 1, 2],
		scalars,
		colors,
		textures,
	};
}

describe('Liquid volume static source core', () => {
	it('keeps exact HDR range, authored sRGB mask and active UV inputs', () => {
		const p = fixture();
		expect(readFurnitureLiquidVolumeStatic(p)).toBe(p);
		expect(p.scalars.Main_HDRRange).toBeLessThan(0);
		p.requiredUv = [0, 1];
		expect(readFurnitureLiquidVolumeStatic(p)).toBeNull();
		p.requiredUv = [0, 1, 2];
		p.textures.N2!.sRGB = true;
		expect(readFurnitureLiquidVolumeStatic(p)).toBeNull();
	});

	it('uses one alpha pass and production tone/output while retaining eight real source samplers', () => {
		const p = fixture();
		const source = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
		const material = createLiquidVolumeStaticMaterial(p, Object.fromEntries(Object.keys(p.textures).map((role) => [role, source])));

		const shader = {
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
			uniforms: {},
		} as Parameters<typeof material.onBeforeCompile>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader).toContain('pattern*mask.a*lMain_MGA.a');
		expect(shader.fragmentShader).toContain('t*dot(t,u)-u*t.z');
		expect(shader.fragmentShader).toContain('alpha+mask.g*alpha*(lMain_SceneColorIntensity-1.0)');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
		expect(shader.uniforms.liquidScaleS!.value).toBe(16);
		expect(shader.uniforms.liquidO!.value.colorSpace).toBe('srgb');
		expect(shader.fragmentShader).not.toContain('sceneColor');
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);
		expect(material.forceSinglePass).toBe(true);
		material.dispose();
		source.dispose();
	});
});
