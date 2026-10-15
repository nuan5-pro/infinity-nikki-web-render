import { describe, expect, it } from 'vitest';
import {
	BufferGeometry,
	DataTexture,
	Float32BufferAttribute,
	ShaderLib,
	type WebGLRenderer,
} from 'three';
import {
	createOpalPreviewMaterial,
	OPAL_PREVIEW_HEIGHT,
	readFurnitureOpalPreview,
	setOpalPreviewCoordinates,
	type FurnitureOpalPreview,
} from '../../src/materials/jewel/opalPreviewShader.js';

function fixture(): FurnitureOpalPreview {
	const scalars: Record<string, number> = {};
	for (const key of [
		'Top Layer Normal Intensity',
		'Diffuse Color Bleed Fresnel Side',
		'Diffuse Color Bleed Fresnel Offset',
		'UV Tile',
		'Depth',
		'EmissiveMapExp',
		'EmissiveMapIntensity',
		'Holo Distortion Intensity',
		'Holo Pattern Tiling',
		'Holo Mask Edge Softness',
		'MeshHeight',
		'Vertical Gradient Power',
		'Vertical Gradient Mult',
		'Eimssive Overall Intensity Day',
		'Eimssive Overall Intensity Night',
		'AO Min',
		'AO Max',
		'Emissive Mask Power',
		'HomeEmissiveToggle',
		'BaseColor Edge Alpha',
		'Metallic for Top Layer',
		'Metallic for Holo',
		'Specular',
		'Roughness Min',
		'Roughness Max',
	])
		scalars[key] = 1;

	const colors: Record<string, [number, number, number, number]> = {};
	for (const key of [
		'Base Emissive Color',
		'Gradient_Color_High',
		'Gradient_Color_Low',
		'Curvature Emissive Color',
		'Base Background Color',
		'BaseColor Edge',
	])
		colors[key] = [1, 1, 1, 1];

	const textures: FurnitureOpalPreview['textures'] = {};
	for (const role of ['D', 'N', 'O', 'T', 'B', 'C', 'D1'])
		textures[role] = {
			parameter: role,
			sRGB: role === 'T' || role === 'D1',
			rgbScale: 1,
			addressX: 'TA_Wrap',
			addressY: 'TA_Wrap',
			mipmaps: true,
			nearest: false,
			cube: false,
		};

	return {
		version: 1,
		family: 'opal14-preview',
		requiredUv: [0],
		heightSpace: 'source-gltf-y-centimetres-before-bake',
		scalars,
		colors,
		textures,
	};
}

describe('current Opal14 preview', () => {
	it('retains source height before component baking instead of merged/world bounds', () => {
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute([0, 2, 0, 0, 3, 0], 3));
		setOpalPreviewCoordinates(geometry);
		geometry.translate(0, 100, 0);
		setOpalPreviewCoordinates(geometry);
		expect(Array.from(geometry.getAttribute(OPAL_PREVIEW_HEIGHT).array)).toEqual([200, 300]);
		geometry.dispose();
	});

	it('keeps the exact RG 8+8 POM and independent HDR emission/physical base', () => {
		const p = fixture();
		expect(readFurnitureOpalPreview(p)).toBe(p);

		const source = new DataTexture(new Uint8Array([128, 128, 64, 255]), 1, 1);
		const material = createOpalPreviewMaterial(p, Object.fromEntries(Object.keys(p.textures).map((role) => [role, source])));

		const shader = {
			vertexShader: ShaderLib.physical.vertexShader,
			fragmentShader: ShaderLib.physical.fragmentShader,
			uniforms: {},
		} as Parameters<typeof material.onBeforeCompile>[0];

		material.onBeforeCompile(shader, {} as WebGLRenderer);
		expect(shader.fragmentShader.match(/for\(int i=0;i<8;i\+\+\)/g)).toHaveLength(2);
		expect(shader.fragmentShader).toContain('textureGrad(opalD1,march.xy,dx,dy).rg');
		expect(shader.fragmentShader).toContain('textureGrad(opalD1,point.xy,dx,dy).g');
		expect(shader.fragmentShader).toContain('totalEmissiveRadiance=opalEmission');
		expect(shader.fragmentShader).toContain('float metalnessFactor=opalMetalness');
		expect(shader.fragmentShader).toContain('texture2D(opalB,vOpalUV).r');
		expect(shader.fragmentShader).not.toContain('body.a;');
		expect(material.transparent).toBe(false);
		delete p.textures.D1;
		expect(readFurnitureOpalPreview(p)).toBeNull();
		material.dispose();
		source.dispose();
	});
});
