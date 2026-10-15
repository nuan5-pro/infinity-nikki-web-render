import { describe, expect, it } from 'vitest';
import { DataArrayTexture, DataTexture, ShaderLib, type WebGLRenderer } from 'three';
import {
	createNNClothUA2PreviewMaterial,
	readFurnitureNNClothUA2Preview,
	type FurnitureNNClothUA2Preview,
} from '../../src/materials/nncloth/nnclothUA2PreviewShader.js';

function fixture(): FurnitureNNClothUA2Preview {
	const scalars: Record<string, number> = {};
	for (const key of [
		'DIY_OverridePatternA',
		'Pattern_Second_Mask_Sel',
		'Pattern_Normal_Intensity',
		'Pattern_M_Blend',
		'IsApplyingDIYColor',
		'DIY_DesaturateMainDColor',
		'DIY_DesaturatePatternDColor',
		'Main_Emissive',
		'Matcap_Mask',
		'Matcap_Desaturation',
		'Matcap_Affect_Pattern_Intensity',
		'Matcap_Use_Pattern_Mask',
		'Matcap_Emissive',
		'Matcap_Night_Emissive',
		'Matcap_Rain_Emissive',
		'PC_Brightness_Tint',
	])
		scalars[key] = 0;

	const colors: FurnitureNNClothUA2Preview['colors'] = {};
	for (const key of [
		'Main_Attr',
		'Fabric_Attr',
		'Pattern_UV',
		'Pattern_Tiling&Offsets',
		'Pattern_Blend',
		'Pattern_M_Attr',
		'DIY_PatternColorTint',
		'Fabric_Emissive_Brightness',
		'Fabric_Emissive_Attr',
		'Main_Emissiver_Color',
		'Fabric_Tint',
		'ReflectColor_Darkness',
		'ReflectColor_Brightness',
		'Anisotropy2_Attr',
		'Anisotropy2_Color',
		'Global_Attr',
		'Fabric_Normal_Far_Attr',
	])
		colors[key] = [1, 1, 1, 1];

	colors.Fabric_Attr = [2, 3, 0, 0];
	colors.Pattern_UV = [0, 0, 1, 0];

	const textures: FurnitureNNClothUA2Preview['textures'] = {};
	for (const role of ['D', 'N', 'O', 'D1', 'N1', 'O1', 'D2', 'B', 'C'])
		textures[role] = {
			parameter: role,
			path: `/Game/T_${role}.T_${role}`,
			depth: role === 'B' ? 5 : role === 'C' ? 48 : 1,
			sRGB: ['D', 'D1', 'D2', 'C'].includes(role),
			mipmaps: true,
			nearest: false,
			address: ['TA_Wrap', 'TA_Wrap'],
			sampler: 'SSM_FromTextureAsset',
			encoding: ['N', 'N1', 'B'].includes(role) ? 'native-rg' : 'rgba',
		};

	const rgba = Array.from({ length: 252 }, () => 0);
	rgba[0] = 1.02;
	rgba[1] = 200;
	rgba[2] = 200;
	rgba[3] = 0.6;
	rgba[4 * 9 * 4] = 25;
	return {
		version: 1,
		family: 'nncloth-ua2-pattern-preview',
		requiredUv: [0, 1, 2],
		scalars,
		colors,
		textures,
		mpt: { sourcePath: '/Game/MPT.MPT', sha256: 'a'.repeat(64), width: 9, height: 7, rgba },
	};
}

describe('NNCloth UA2 Pattern native inputs', () => {
	it('preserves float MPT values above one and checks UV and all layer bounds', () => {
		const p = fixture();
		expect(readFurnitureNNClothUA2Preview(p)).toBe(p);
		expect(p.mpt.rgba[1]).toBe(200);
		p.requiredUv = [0, 1];
		expect(readFurnitureNNClothUA2Preview(p)).toBeNull();
		p.requiredUv = [0, 1, 2];
		p.mpt.rgba[0] = 5;
		expect(readFurnitureNNClothUA2Preview(p)).toBeNull();
	});

	it('rejects slice-zero 2D substitutes and retains actual array/MPT samplers and production output', () => {
		const p = fixture();
		const source = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
		const textures = Object.fromEntries(Object.keys(p.textures).map((role) => [role, source]));
		expect(() => createNNClothUA2PreviewMaterial(p, textures)).toThrow('native array');
		textures.B = new DataArrayTexture(new Uint8Array(5 * 4), 1, 1, 5) as unknown as DataTexture;
		textures.C = new DataArrayTexture(new Uint8Array(48 * 4), 1, 1, 48) as unknown as DataTexture;

		const material = createNNClothUA2PreviewMaterial(p, textures);

		const shader = {
			vertexShader: ShaderLib.physical.vertexShader,
			fragmentShader: ShaderLib.physical.fragmentShader,
			uniforms: {},
		} as Parameters<typeof material.onBeforeCompile>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader).toContain('highp sampler2DArray ua2B');
		expect(shader.fragmentShader).toContain('vUA2UV1*ua2Fabric.yz,round(ua2Fabric.x)');
		expect(shader.fragmentShader).toContain('round(ua2Matcap.x)');
		expect(shader.fragmentShader).toContain('ua2RNM(ua2MainNormal,ua2FabricNormal)');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
		expect(shader.uniforms.ua2MPT!.value.image.data[1]).toBe(200);
		expect(shader.uniforms.ua2MPT!.value.flipY).toBe(false);
		expect(material.transparent).toBe(false);
		material.dispose();
		source.dispose();
		textures.B!.dispose();
		textures.C!.dispose();
	});

	it('keeps the separate three-region source UV branch and original selector outside every region', () => {
		const p = fixture();
		p.patternTextureSize = 2048;
		p.patternRegions = [
			{ position: [512, 512, 1024, 1024], transform: [16, 16, 0, 0] },
			{ position: [1536, 512, 1024, 1024], transform: [30, 30, 2.754026, 0] },
			{ position: [512, 1536, 1024, 1024], transform: [25, 25, 0, 0] },
		];
		expect(readFurnitureNNClothUA2Preview(p)).toBe(p);

		const source = new DataTexture(new Uint8Array(4), 1, 1);
		const textures = Object.fromEntries(Object.keys(p.textures).map((role) => [role, source]));
		textures.B = new DataArrayTexture(new Uint8Array(5 * 4), 1, 1, 5) as unknown as DataTexture;
		textures.C = new DataArrayTexture(new Uint8Array(48 * 4), 1, 1, 48) as unknown as DataTexture;

		const material = createNNClothUA2PreviewMaterial(p, textures);

		const shader = {
			vertexShader: ShaderLib.physical.vertexShader,
			fragmentShader: ShaderLib.physical.fragmentShader,
			uniforms: {},
		} as Parameters<typeof material.onBeforeCompile>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(material.defines).toHaveProperty('UA2_POSITION_PATTERN');
		expect(shader.uniforms.ua2PatternTransforms!.value[1].z).toBe(2.754026);
		expect(shader.fragmentShader).toContain('vec2 result=originalUV');
		expect(shader.fragmentShader).toContain('lessThanEqual(abs(originalUV-center),size*.5)');
		expect(shader.fragmentShader).toContain('fract(originalUV*tiling.xy+tiling.zw)*size+center-size*.5');
		material.dispose();
		source.dispose();
		textures.B!.dispose();
		textures.C!.dispose();
		p.patternRegions.pop();
		expect(readFurnitureNNClothUA2Preview(p)).toBeNull();
	});
});
