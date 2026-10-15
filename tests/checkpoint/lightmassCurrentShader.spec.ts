import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, Texture } from 'three';
import {
	createLightmassCurrentMaterial,
	readLightmassCurrent,
	type LightmassCurrent,
} from '../../src/materials/surface/lightmassCurrentShader.js';

const current: LightmassCurrent = {
	family: 'lightmass-current',
	version: 1,
	tint: [1, 1, 1],
	occColor: [0.025024, 0.024685, 0.026042],
	primitive33: [0, 0, 0, 0],
	diffuseOcc: -0.95,
	specOcc: 0,
	roughBias: 0.1,
	ao: [0, 1],
	roughness: [0, 1],
	metalness: [0, 1],
	materialAO: 1,
	uvScale: 1,
	normalUvScale: 1,
	normalIntensity: 1,
	srgb: [true, false, false],
	mipmaps: [true, true, true],
};

describe('current Lightmass editor component core', () => {
	it('accepts only the explicit initialized component domain', () => {
		expect(readLightmassCurrent(current)).toEqual(current);
		expect(readLightmassCurrent({ ...current, version: 2 })).toBeNull();
		expect(readLightmassCurrent({ ...current, primitive33: [0, 1, 0, 0] })).toBeNull();
		expect(readLightmassCurrent({ ...current, normalIntensity: NaN })).toBeNull();
		expect(readLightmassCurrent({ ...current, srgb: [true, false] })).toBeNull();
	});

	it('retains raw native RG and ORM and declares actual PBR variables', () => {
		const textures = [new Texture(), new Texture(), new Texture()];
		const m = createLightmassCurrentMaterial(current, textures[0]!, textures[1]!, textures[2]!, new MeshStandardMaterial());

		const shader = {
			uniforms: {},
			fragmentShader:
				'#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n#include <aomap_fragment>\n#include <emissivemap_fragment>',
		};

		m.onBeforeCompile(shader as never, {} as never);
		expect(shader.fragmentShader).toContain('float roughnessFactor = bodyPBR.y;');
		expect(shader.fragmentShader).toContain('float metalnessFactor = bodyPBR.z;');
		expect(shader.fragmentShader).toContain('texture2D(normalMap, vNormalMapUv).rg');
		expect(shader.fragmentShader).toContain('bodyPrimitive');
		expect(m.transparent).toBe(false);
		expect(m.userData.lightmassCurrent).toEqual(current);
		expect(m.customProgramCacheKey()).toBe('native_lightmass_current_v1');
		m.dispose();
		textures.forEach((t) => t.dispose());
	});
});
