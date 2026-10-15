import { describe, expect, it } from 'vitest';
import {
	createStaticEffectCarrierMaterial,
	readFurnitureStaticEffectCarrier,
} from '../../src/materials/effects/staticEffectCarrier.js';

describe('static effect carrier', () => {
	it('omits the additive carrier without a draw or opaque fallback', () => {
		const p = {
			version: 1,
			family: 'static-effect-carrier',
		} as const;

		const material = createStaticEffectCarrierMaterial(p);
		expect(material.visible).toBe(false);
		expect(material.transparent).toBe(true);
		expect(material.opacity).toBe(0);
		expect(material.depthWrite).toBe(false);
		expect(material.colorWrite).toBe(false);
		expect(material.userData.staticEffectCarrier).toBe(p);
		material.dispose();
	});

	it('rejects unsupported versions and unrelated material families', () => {
		expect(readFurnitureStaticEffectCarrier({ version: 2, family: 'static-effect-carrier' })).toBeNull();
		expect(
			readFurnitureStaticEffectCarrier({
				version: 1,
				family: 'other',
			}),
		).toBeNull();
	});
});
