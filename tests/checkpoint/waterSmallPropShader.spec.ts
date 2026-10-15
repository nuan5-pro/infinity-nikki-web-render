import { describe, expect, it } from 'vitest';
import { ShaderLib, Texture } from 'three';
import {
	createWaterSmallPropMaterial,
	readFurnitureWaterSmallProp,
	type FurnitureWaterSmallProp,
} from '../../src/materials/water/waterSmallPropShader.js';

function fixture(): FurnitureWaterSmallProp {
	const texture = (parameter: string, cube: boolean) => ({
		parameter,
		cube,
		sRGB: false,
		rgbScale: 1,
		addressX: 'TA_Wrap',
		addressY: 'TA_Wrap',
		mipmaps: true,
		nearest: false,
	});

	return {
		version: 1,
		family: 'water-small-prop',
		requiredUv: [0],
		proxyDepth: 1.25,
		scalars: {
			DeepDepthScale: 1.7,
			DepthDeepHardness: 1,
			CubeMap_Contrast: 2,
			LocalUV: 0,
			NormalScale: 3000,
			NormalIntensity: 0.1,
			CubeMap_Fresnel: 2.5,
			'Brightness-Day': 1,
			EdgeDepthScale: 130,
			EdgeHardness: 0.4,
			Opacity: 2,
			UseMultiplyBlend: 0,
			WPO: 0,
		},
		colors: {
			Color_Shallow: [0.270833, 0.802792, 1, 1],
			Color_Deep: [0, 0.297491, 0.4, 1],
			NormalFlowDirection: [-0.005, 0.005, -0.001, -0.001],
			CubeMap_Tint: [0.361816, 0.516046, 0.609375, 1.5],
		},
		textures: { N: texture('NormalTex', false), O: texture('CubeMap', true) },
	};
}

describe('WaterSmallProp retained native colour core', () => {
	it('keeps two normal reads and R-only cube in one production-tone-mapped pass', () => {
		const config = fixture();
		expect(readFurnitureWaterSmallProp(config)).toBe(config);

		const material = createWaterSmallPropMaterial(config, { N: new Texture(), O: new Texture() });

		const shader = {
			uniforms: {},
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader,
		};

		material.onBeforeCompile(shader as never, {} as never);
		expect(material.forceSinglePass).toBe(true);
		expect(material.depthWrite).toBe(false);
		expect(shader.vertexShader).toContain('vWSPWorld=vec3(wspWorld.x,-wspWorld.y,wspWorld.z)');
		expect(shader.fragmentShader).toContain('wspDecode(baseUV+wspNormalFlowDirection.xy*wspTime)');
		expect(shader.fragmentShader).toContain('wspDecode(baseUV+wspNormalFlowDirection.zw*wspTime)');
		expect(shader.fragmentShader).toContain('texture2D(wspCube,cubeUV).r*wspCubeScale');
		expect(shader.fragmentShader).toContain('(1.0+2.0*wspCubeMap_Contrast)-wspCubeMap_Contrast');
		expect(shader.fragmentShader).toContain('diffuseColor.rgb=body*wspBrightness_Day*edge');
		expect(shader.fragmentShader).toContain('diffuseColor.a=clamp(edge*wspOpacity,0.0,1.0)');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
		material.dispose();
	});

	it('rejects absent cube and unsupported multiply/WPO instead of silently going flat', () => {
		const p = fixture();
		delete p.textures.O;
		expect(readFurnitureWaterSmallProp(p)).toBeNull();

		const multiply = fixture();
		multiply.scalars.UseMultiplyBlend = 1;
		expect(readFurnitureWaterSmallProp(multiply)).toBeNull();
		expect(() => createWaterSmallPropMaterial(fixture(), { N: new Texture() })).toThrow('missing O');
	});
});
