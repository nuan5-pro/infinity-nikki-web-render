import { describe, expect, it } from 'vitest';
import { DataTexture, MeshStandardMaterial, ShaderLib, type WebGLRenderer } from 'three';
import {
	createClothStaticCoreMaterial,
	readFurnitureClothStaticCore,
	type FurnitureClothStaticCore,
} from '../../src/materials/cloth/clothStaticCoreShader.js';

function fixture(): FurnitureClothStaticCore {
	const scalars = Object.fromEntries(
		[
			'Rainbow_Warp_Tiling',
			'Rainbow_Warp',
			'Rainbow_Tiling',
			'Rainbow_D_BlendWeight',
			'Glint_TotalEmissiveControl',
			'Glint_TotalBaseColorControl',
			'Glint_TextureTiling',
			'Glint_HeightRatio',
			'Glint_TextureDepth',
			'Glint_ShiningSpeed',
			'Glint_Size1',
			'Glint_Size2',
			'Glint_NormalFlatten',
			'Glint_FlipSpecRange',
			'Glint_SpecRange',
			'GlintIntensityInShadow',
			'Glint_ViewRange',
			'Glint_InverseViewRange',
			'Glint_NormalWeight',
		].map((key) => [key, 1]),
	);

	const colors: FurnitureClothStaticCore['colors'] = {
		'Rainbow_Color(A:EmissiveIntensity)': [0.2, 0.22, 0.3, 0],
		Glint_Color1: [0.65, 0.36, 1, 10],
		Glint_Color2: [0.91, 1.94, 2, 10],
		Cloth_MaskTintColor: [0, 0, 0, 1],
	};

	const textures: FurnitureClothStaticCore['textures'] = {};
	for (const role of ['D', 'N', 'O', 'N1', 'B', 'C', 'D1', 'O1', 'M', 'T'])
		textures[role] = {
			parameter: role,
			sRGB: !['N', 'N1', 'O', 'T'].includes(role),
			rgbScale: 1,
			addressX: 'TA_Wrap',
			addressY: 'TA_Wrap',
			mipmaps: true,
			nearest: false,
			cube: false,
		};

	return {
		version: 1,
		family: 'cloth-static-colour-core',
		scalars,
		colors,
		textures,
		cloth: {
			family: 'cloth-master',
			version: 2,
			root: 'main',
			mode: 'masked',
			alphaCutoff: 0.3333,
			opacitySource: 'diffuse-alpha',
			opacity: [0.38, 0.68, 1],
			color: [1, 1, 1],
			roughness: [0, 1],
			metalness: [0, 0.5],
			ao: [0, 1],
			uvScale: 1,
			mainUvChannel: 0,
			detailUvScale: 10,
			detailFlatness: 0.5,
			twoSideSign: 0,
			normalFaceSign: true,
			normalOutputFaceSign: true,
			edgeColor: [0.3, 0.15, 0.23, 0.5],
			edgePower: 3,
			diffuseEdge: [0, 0],
			anisoColor: [0.02, 0.01, 0.02, 1],
			anisoTangent: [0, 0, 1],
			anisoBaseMix: 1,
			anisoRoughness: 2,
			anisoScale: [10, 0.1],
			emissive: [0.026, 0.017, 0.125],
			colorInShadow: [0, 0, 0],
			advanced: false,
			reflectBase: [0, 0, 0],
			reflectDark: [0, 0, 0],
			palette: false,
			paletteUvBlend: 0,
			paletteConstant: [0, 0, 0, 0],
			maskColor: [0, 0, 0],
			maskUvChannel: 0,
			maskUvScale: [1, 1],
			fourthRole: 'detail-normal',
			textureActive: [true, true, true, true],
			textureConstant: [
				[0, 0, 0, 0],
				[0, 0, 0, 0],
				[0, 0, 0, 0],
				[0, 0, 0, 0],
			],
			textureSRGB: [true, false, false, false],
			textureMipmaps: [true, true, true, true],
			textureNearest: [false, false, false, false],
			textureWrap: [
				['TA_Wrap', 'TA_Wrap'],
				['TA_Wrap', 'TA_Wrap'],
				['TA_Wrap', 'TA_Wrap'],
				['TA_Wrap', 'TA_Wrap'],
			],
		},
	};
}

describe('Cloth static active colour core', () => {
	it('loads the native translucent glint branch without rainbow resources and releases its owned samplers', () => {
		const p = fixture();
		p.variant = 'translucent-glint';
		p.cloth.mode = 'translucent';
		p.cloth.alphaCutoff = 0;
		for (const role of ['B', 'C', 'M']) delete p.textures[role];
		for (const key of Object.keys(p.scalars)) if (key.startsWith('Rainbow_')) delete p.scalars[key];
		delete p.colors['Rainbow_Color(A:EmissiveIntensity)'];
		expect(readFurnitureClothStaticCore(p)).toBe(p);

		const texture = new DataTexture(new Uint8Array([128, 128, 255, 128]), 1, 1);
		const source = new MeshStandardMaterial();
		const material = createClothStaticCoreMaterial(p, Object.fromEntries(Object.keys(p.textures).map((role) => [role, texture])), source);
		const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as Parameters<typeof material.onBeforeCompile>[0];
		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader).not.toContain('csRainbow');
		expect(shader.fragmentShader).toContain('texture2D(csO1,csUV).r');
		expect(shader.fragmentShader).toContain('clothShadowBase=csAlbedo+clothAniso;');
		expect(shader.fragmentShader).toContain('clothD.a * mix(clothOpacity.x, clothOpacity.y');
		expect(material.transparent).toBe(true);
		expect(material.depthWrite).toBe(false);
		expect(material.alphaTest).toBe(0);
		expect(material.forceSinglePass).toBe(true);
		expect(material.customProgramCacheKey()).toContain('translucent-glint');

		let released = 0;
		for (const role of ['D1', 'O1', 'T']) shader.uniforms[`cs${role}`]!.value.addEventListener('dispose', () => released++);
		material.dispose();
		expect(released).toBe(3);
		texture.dispose();
		source.dispose();
		p.cloth.mode = 'masked';
		expect(readFurnitureClothStaticCore(p)).toBeNull();
	});

	it('retains active HDR glints and rainbow RGB even when rainbow emission is zero', () => {
		const p = fixture();
		expect(readFurnitureClothStaticCore(p)).toBe(p);
		expect(p.colors['Rainbow_Color(A:EmissiveIntensity)']![3]).toBe(0);
		expect(p.colors.Glint_Color2![3]).toBe(10);
		delete p.textures.M;
		expect(readFurnitureClothStaticCore(p)).toBeNull();
	});

	it('extends existing cloth in the same pass without dropping coverage, normal face sign or production output', () => {
		const p = fixture();
		const source = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
		const sourceMaterial = new MeshStandardMaterial();
		const material = createClothStaticCoreMaterial(
			p,
			Object.fromEntries(Object.keys(p.textures).map((role) => [role, source])),
			sourceMaterial,
		);

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		} as Parameters<typeof material.onBeforeCompile>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader).toContain('csGlintFirstRG*csGlintRG');
		expect(shader.fragmentShader).toContain('csRainbowMask*csRainbow_D_BlendWeight');
		expect(shader.fragmentShader).toContain('csGlint*csGlint_TotalEmissiveControl');
		expect(shader.fragmentShader).toContain('texture2D(csO1,vec2(0)).r');
		expect(shader.fragmentShader).toContain('normal *= faceDirection;');
		expect(shader.fragmentShader).toContain('clothD.a * mix(clothOpacity.x, clothOpacity.y');
		expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
		expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
		expect(material.transparent).toBe(false);
		expect(material.alphaTest).toBe(0.3333);
		expect(material.forceSinglePass).toBe(true);
		material.dispose();
		source.dispose();
		sourceMaterial.dispose();
	});
});
