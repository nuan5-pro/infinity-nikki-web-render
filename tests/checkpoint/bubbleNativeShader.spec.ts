import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Camera, Mesh, Scene, Texture, NoColorSpace, SRGBColorSpace, ClampToEdgeWrapping } from 'three';
import { createEffectMaterial, readFurnitureEffect, type FurnitureEffect } from '../../src/materials/effects/effectShader.js';
import { readBubbleNative, type FurnitureBubbleNative } from '../../src/materials/effects/bubbleNativeShader.js';
import { installCharacterJewelPreviewContext } from '../../src/materials/jewel/characterJewelPreview.js';

function fixture(): FurnitureBubbleNative {
	const uniforms: FurnitureBubbleNative['uniforms'] = [
		[-.08,.02,1,1], [1,1,0,0], [10,7.518029,2.890673,.55], [.8,1,0,0], [2.8,1.785001,.7,.05],
		[-.08,-.05,.08,2], [1,0,0,0], [1,5,0,1], [.1,.222579,.767429,1], [0,.6,.024864,.481546],
		[0,0,0,.5], [.25,.1,.1,.1], [4,1,0,0], [.5,.373552,.122396,.6], [1,0,0,0], [2,-1,0,3],
		[.25,0,.01,-.02], [.15,1,0,0], [0,0,0,3], [100,92.88343,83.33334,0], [0,0,0,0],
		[2,.5,3,0], [1,100,0,0], [0,0,0,.8], [-.2,1,.1,.1], [.2,0,70,.01],
	];
	const bindings: Record<string, string> = {
		D: 'T_Bubble_D', O: 'T_BubbleSpec', T: 'T_BubbleWarp', O1: 'T_Parallax_LineRM',
		D1: 'T_Parallax_Line', D2: 'Glint_Texture', O2: 'Glint_Mask', S: 'T_Bubble_HDR',
	};
	return { uniforms, textures: Object.fromEntries(Object.entries(bindings).map(([role, parameter]) => [role, {
		parameter, sRGB: role !== 'S', rgbScale: role === 'S' ? 1.0661852359771729 : 1,
		addressX: 'TA_Wrap', addressY: 'TA_Wrap', mipmaps: true, nearest: false, cube: role === 'S',
	}])) };
}

function effect(native = fixture()): FurnitureEffect {
	return { family: 'bubble', version: 1, vertexMask: 'none', textureSRGB: [false,false,false,false], textureNearest: [false,false,false,false],
		bubble: { mode: 'native', native } } as FurnitureEffect;
}

function sources() {
	return Object.fromEntries(Object.keys(fixture().textures).map((role) => [role, new Texture()]));
}

function material() {
	const textures = sources();
	return createEffectMaterial(effect(), textures.D!, textures.O!, textures.T!, null, null, textures);
}

describe('Bubbles UP1/UEL1 captured native core', () => {
	it('requires the actual parallax, glint, and HDR cube resource contracts', () => {
		expect(readFurnitureEffect(effect())).not.toBeNull();
		for (const role of ['O1','D1','D2','O2','S']) {
			const profile = fixture();
			delete profile.textures[role];
			expect(readBubbleNative(profile)).toBeNull();
		}
		const profile = fixture();
		profile.uniforms[15]![2] = 1;
		expect(readBubbleNative(profile)).toBeNull();
		expect(() => createEffectMaterial(effect(), new Texture(), new Texture(), new Texture())).toThrow('missing native source role O1');
	});

	it('retains all active sample paths and the one-step black-height parallax march', () => {
		const value = material();
		const shader = { uniforms: {} as Record<string, { value: any }>,
			vertexShader: '#include <common>\n#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )\n#endif\n#include <project_vertex>',
			fragmentShader: '#include <common>\n#include <map_fragment>\n#include <alphamap_fragment>' };
		value.onBeforeCompile(shader as never, {} as never);
		expect(shader.fragmentShader).toContain('textureGrad(bubbleO1,lineUv+offset,lineDx,lineDy).r');
		expect(shader.fragmentShader).toContain('float(i)>=floor(steps)+2.0');
		expect(shader.fragmentShader).toContain('texture2D(bubbleD1,lineUv+offset).r');
		expect(shader.fragmentShader).toContain('texture2D(bubbleD2,glintUv+heightOffset+cameraFromOrigin.xy');
		expect(shader.fragmentShader).toContain('texture2D(bubbleO2,vBubbleUv+bubbleTime*maskPanner).r');
		expect(shader.fragmentShader).toContain('bubbleTime*bubbleMaterial[0].xy');
		expect(shader.fragmentShader).toContain('bubbleTime*bubbleMaterial[16].zw*bubbleMaterial[15].w');
		expect(shader.fragmentShader).toContain('bubblePow3(bubbleCube(reflect(-view,normal))');
		expect(shader.fragmentShader).toContain('spec.r*bubbleMaterial[24].w+base.a*bubbleMaterial[23].w');
		expect(shader.vertexShader).toContain('vBubbleOrigin=furnitureNativeWorld((modelMatrix*bubbleOrigin).xyz)');
		expect(shader.uniforms.bubbleD!.value.colorSpace).toBe(SRGBColorSpace);
		expect(shader.uniforms.bubbleS!.value.colorSpace).toBe(NoColorSpace);
		expect(shader.uniforms.bubbleS!.value.wrapT).toBe(ClampToEdgeWrapping);
		expect(shader.uniforms.bubbleS!.value.flipY).toBe(false);
		expect(shader.uniforms.bubbleCubeScale!.value).toBeCloseTo(1.0661852359771729);
		expect(value.transparent && !value.depthWrite && value.forceSinglePass).toBe(true);
		value.dispose();
	});

	it('uses actual light and TOD without scheduling continuous redraws', () => {
		const value = material();
		const renderer = {} as never;
		const scene = new Scene();
		const invalidate = vi.fn();
		const clock = vi.fn(() => 777);
		const uninstall = installCharacterJewelPreviewContext(renderer, scene, { invalidate, clock,
			lighting: () => ({ primaryDirection: [1,2,3], primaryColor: [.4,.5,.6], tod: { minute: 120, sunDirectionWorld: [0,0,1], swapLightFactor: 0 } }) });
		const geometry = new BufferGeometry();
		geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0,0,1]),3));
		geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0,0]),2));
		value.onBeforeRender(renderer, scene, new Camera(), geometry, new Mesh(), null as never);
		const shader = { uniforms: {} as Record<string, { value: any }>, vertexShader: '', fragmentShader: '' };
		value.onBeforeCompile(shader as never, renderer);
		expect(shader.uniforms.bubbleLightDirection!.value.toArray()).toEqual([1,-2,3]);
		expect(shader.uniforms.bubbleLightColor!.value.toArray()).toEqual([.4,.5,.6]);
		expect(shader.uniforms.bubbleTimeOfDay!.value).toBe(2);
		expect(shader.uniforms.bubbleTime!.value).toBe(777);
		expect(clock).toHaveBeenCalledOnce();
		expect(invalidate).not.toHaveBeenCalled();
		uninstall();
		geometry.dispose();
		value.dispose();
	});
});
