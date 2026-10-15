import { BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
	CHARACTER_JEWEL_ATTRIBUTES,
	restoreCharacterJewelGeometry,
	transformCharacterJewelGeometry,
} from '../../src/materials/jewel/characterJewelGeometry.js';
import type { FurnitureCharacterJewel } from '../../src/materials/jewel/characterJewelShader.js';

describe('current CharacterJewel native carriers', () => {
	it('packs UV pairs and primitive bounds below WebGL2 limits without changing source coordinates', () => {
		const geometry = new BufferGeometry();

		const add = (name: string, values: number[], size: number) => geometry.setAttribute(name, new Float32BufferAttribute(values, size));

		add('position', [1, 2, 3], 3);
		add('_character_native_tangent', [1, 0, 0, -1], 4);
		add('_character_native_normal', [0, 0.8, 0], 3);
		add('_character_native_uv1', [0, 1], 2);
		add('_character_native_uv2', [0.25, 0.5], 2);
		add('_character_native_uv3', [0, 1], 2);
		add('_character_native_local_cm', [100, 300, 200], 3);
		add('_character_native_origin', [1, 2, 3], 3);
		add('_character_native_pivot', [4, 5, 6], 3);
		add('_character_native_radius', [2], 1);
		restoreCharacterJewelGeometry(geometry, {
			version: 1,
			family: 'character-jewel-current',
		} as FurnitureCharacterJewel);
		expect(CHARACTER_JEWEL_ATTRIBUTES).toHaveLength(7);
		expect(Array.from(geometry.getAttribute('characterUV23').array)).toEqual([0.25, 0.5, 0, 1]);
		expect(geometry.hasAttribute('characterPrimitiveRadius')).toBe(false);
		transformCharacterJewelGeometry(geometry, new Matrix4().makeScale(-2, 3, 4));
		expect(Array.from(geometry.getAttribute('characterPrimitiveBounds').array)).toEqual([
			-2, 6, 12, 8,
		]);
		expect(Array.from(geometry.getAttribute('characterDissolvePivot').array)).toEqual([-8, 15, 24]);
		expect(Array.from(geometry.getAttribute('characterLocalCM').array)).toEqual([100, 300, 200]);
		expect(Array.from(geometry.getAttribute('characterNativeTangent').array)).toEqual([-1, 0, 0, 1]);
		expect(geometry.getAttribute('characterNativeNormal').getY(0)).toBeCloseTo(0.8);
	});
});
