import { MeshBasicMaterial } from 'three';

export interface FurnitureStaticEffectCarrier {
	version: 1
	family: 'static-effect-carrier'
	policy: 'omit-dynamic-layered-effect'
	approximation?: string
}

export function readFurnitureStaticEffectCarrier(value: unknown): FurnitureStaticEffectCarrier | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureStaticEffectCarrier;
	return p.version === 1 &&
		p.family === 'static-effect-carrier' &&
		p.policy === 'omit-dynamic-layered-effect'
		? p
		: null;
}

/** Preserve source geometry/identity while omitting an explicitly static VFX carrier. */
export function createStaticEffectCarrierMaterial(p: FurnitureStaticEffectCarrier): MeshBasicMaterial {
	if (!readFurnitureStaticEffectCarrier(p)) throw new Error('StaticEffectCarrier invalid presentation policy');

	const material = new MeshBasicMaterial({
		transparent: true,
		opacity: 0,
		depthWrite: false,
		colorWrite: false,
		visible: false,
	});
	material.userData.staticEffectCarrier = p;
	return material;
}
