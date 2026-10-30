import { describe, expect, it } from 'vitest';
import {
	BoxGeometry, Float32BufferAttribute, Matrix4, Mesh, PerspectiveCamera, Scene, ShaderLib, Texture,
	type MeshPhysicalMaterial, type WebGLRenderer,
} from 'three';
import {
	createIceStaticMaterial, iceStaticRoles, readFurnitureIceStatic, setStaticGlassCoordinates,
	transformStaticGlassCoordinates, type FurnitureStaticGlass,
} from '../src/materials/glass/iceShader.js';
import {
	createStainedGlassStaticMaterial, readFurnitureStainedGlassStatic, stainedGlassStaticRoles,
} from '../src/materials/glass/stainedGlassShader.js';
import { installCharacterJewelPreviewContext } from '../src/materials/jewel/characterJewelPreview.js';

function fixture(family: FurnitureStaticGlass['family']): FurnitureStaticGlass {
	const roles = family === 'ice-static' ? iceStaticRoles : stainedGlassStaticRoles;
	const uniforms: [number, number, number, number][] = Array.from({ length: family === 'ice-static' ? 37 : 34 }, () => [0, 0, 0, 0]);
	if (family === 'stained-glass-static') uniforms[2] = [0, -250, 0, -.5];
	return { version: 1, family, uniforms, requiredUV: [0], textures: Object.fromEntries(roles.map((role) => [role,
		{ parameter: role, sRGB: false, rgbScale: role === 'S' ? 3.6741507053375244 : 1,
			addressX: 'TA_Wrap', addressY: 'TA_Wrap', mipmaps: true, nearest: false, cube: role === 'S' }])) };
}

function compile(material: MeshPhysicalMaterial) {
	const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {} as Record<string, { value: unknown }> };
	material.onBeforeCompile(shader as never, {} as WebGLRenderer);
	return shader;
}

describe('native ice and four-layer stained glass', () => {
	it('requires all captured layers, cube scale and normal metadata', () => {
		const ice = fixture('ice-static'), glass = fixture('stained-glass-static');
		expect(readFurnitureIceStatic(ice)).toBe(ice);
		expect(readFurnitureStainedGlassStatic(glass)).toBe(glass);
		for (const role of stainedGlassStaticRoles) {
			const p = fixture('stained-glass-static');
			delete p.textures[role];
			expect(readFurnitureStainedGlassStatic(p)).toBeNull();
		}
		ice.uniforms[6]![0] = Infinity;
		expect(readFurnitureIceStatic(ice)).toBeNull();
	});

	it('keeps source pivot and vertex-R independent of merged mesh origin/diffuse colour', () => {
		const p = fixture('stained-glass-static'), geometry = new BoxGeometry();
		geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(.25), 3));
		setStaticGlassCoordinates(geometry, p);
		expect(geometry.getAttribute('staticGlassPivot').getZ(0)).toBe(-2.5);
		expect(geometry.getAttribute('staticGlassVertexR').getX(0)).toBe(.25);
		transformStaticGlassCoordinates(geometry, new Matrix4().makeTranslation(1, 2, 3));
		expect(geometry.getAttribute('staticGlassPivot').getX(0)).toBe(1);
		expect(geometry.getAttribute('staticGlassPivot').getZ(0)).toBe(.5);
		geometry.dispose();
	});

	for (const family of ['ice-static', 'stained-glass-static'] as const) {
		it(`${family} injects one opaque core and uses only the host clock`, () => {
			const p = fixture(family), sources = Object.fromEntries(Object.keys(p.textures).map((role) => [role, new Texture()]));
			const material = family === 'ice-static' ? createIceStaticMaterial(p, sources) : createStainedGlassStaticMaterial(p, sources);
			const shader = compile(material);
			expect(material.transparent).toBe(false);
			expect(material.alphaTest).toBe(0);
			expect(shader.fragmentShader).toContain('float roughnessFactor=sgRoughness');
			expect(shader.fragmentShader).toContain('float metalnessFactor=sgMetalness');
			expect(shader.fragmentShader).not.toContain('discard');
			expect(shader.vertexShader).toContain('sgWorld=sgWorld*batchingMatrix');
			expect(shader.fragmentShader).toContain('sgTime');
			const renderer = {} as WebGLRenderer, scene = new Scene(), geometry = new BoxGeometry(), camera = new PerspectiveCamera();
			setStaticGlassCoordinates(geometry, p);
			let time = 12;
			const dispose = installCharacterJewelPreviewContext(renderer, scene, { invalidate: () => {}, clock: () => time,
				lighting: () => ({ primaryDirection: [0, 1, 1], primaryColor: [2, 1, .5], tod: {} as never }) });
			const mesh = new Mesh(geometry, material);
			material.onBeforeRender(renderer, scene, camera, geometry, mesh, null as never);
			expect(shader.uniforms.sgTime!.value).toBe(12);
			material.onBeforeRender(renderer, scene, camera, geometry, mesh, null as never);
			expect(shader.uniforms.sgTime!.value).toBe(12);
			time = 13;
			material.onBeforeRender(renderer, scene, camera, geometry, mesh, null as never);
			expect(shader.uniforms.sgTime!.value).toBe(13);
			dispose(); material.dispose(); geometry.dispose(); Object.values(sources).forEach((t) => t.dispose());
		});
	}

	it('retains distinct Dirt/thickness and four-layer alpha-composite equations', () => {
		const ice = fixture('ice-static'), glass = fixture('stained-glass-static');
		const sources = (p: FurnitureStaticGlass) => Object.fromEntries(Object.keys(p.textures).map((role) => [role, new Texture()]));
		const a = createIceStaticMaterial(ice, sources(ice)), b = createStainedGlassStaticMaterial(glass, sources(glass));
		const ai = compile(a).fragmentShader, bi = compile(b).fragmentShader;
		expect(ai).toContain('transmitted=mix(transmitted,dirt,opacity)');
		expect(ai).toContain('sgCube(relative+ray*distance)');
		expect(bi).toContain('color=mix(color,nearLayer.rgb,nearLayer.a)');
		expect(bi).toContain('color=mix(color,fore.rgb,fore.a)');
		expect(bi).toContain('sgDecodeNormal(texture2D(sgM,bgUV).rg)');
		a.dispose(); b.dispose();
	});
});
