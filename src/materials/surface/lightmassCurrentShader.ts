import type { MeshStandardMaterial, Texture } from 'three';
import { createLightmassBodyMaterial, type LightmassBody } from './lightmassBodyShader.js';

export interface LightmassCurrent extends Omit<LightmassBody, 'family'> {
	family: 'lightmass-current';
}

/** NoLightmap material using the Body DNO equations with zeroed component data. */
export function createLightmassCurrentMaterial(c: LightmassCurrent, d: Texture, n: Texture, o: Texture, source: MeshStandardMaterial): MeshStandardMaterial {
	const material = createLightmassBodyMaterial({ ...c, family: 'lightmass-body' }, d, n, o, source);
	delete material.userData.lightmassBody;
	material.userData.lightmassCurrent = c;
	material.customProgramCacheKey = () => 'native_lightmass_current_v1';
	return material;
}

export function readLightmassCurrent(value: unknown): LightmassCurrent | null {
	if (!value || typeof value !== 'object') return null;

	const c = value as LightmassCurrent;
	if (
		c.family !== 'lightmass-current' ||
		c.version !== 1
	) return null;

	for (const [field, width] of [
		['tint', 3],
		['occColor', 3],
		['primitive33', 4],
		['ao', 2],
		['roughness', 2],
		['metalness', 2],
	] as const) {
		const values = c[field];
		if (
			!Array.isArray(values) ||
			values.length !== width ||
			values.some((x) => !Number.isFinite(x))
		) return null;
	}

	if (c.primitive33.some((x) => x !== 0)) return null;

	for (const field of [
		'diffuseOcc',
		'specOcc',
		'roughBias',
		'materialAO',
		'uvScale',
		'normalUvScale',
		'normalIntensity',
	] as const) {
		if (!Number.isFinite(c[field])) return null;
	}

	for (const field of ['srgb', 'mipmaps'] as const) {
		if (
			!Array.isArray(c[field]) ||
			c[field].length !== 3 ||
			c[field].some((x) => typeof x !== 'boolean')
		) return null;
	}

	if (Math.min(1, Math.max(0, 1 - c.specOcc)) !== 1) return null;

	return c;
}
