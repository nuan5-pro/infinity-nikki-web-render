import { describe, expect, it } from 'vitest';
import {
	absFxCurrentClock,
	absFxCurrentCoverage,
	absFxCurrentCoverageBinding,
} from '../../src/materials/effects/absFxCurrentSource.js';

describe('current native ABSFX runtime domains', () => {
	it('preserves both source clock selectors', () => {
		expect(absFxCurrentClock(0, 3, 7)).toBe(3);
		expect(absFxCurrentClock(-1, 3, 7)).toBe(3);
		expect(absFxCurrentClock(1, 3, 7)).toBe(7);
	});
	it('allows only actual exact zero coverage to remain unbound', () => {
		expect(absFxCurrentCoverageBinding(0)).toEqual({ bound: false });
		expect(absFxCurrentCoverage(2, 0)).toBe(0);
		for (const alpha of [1, 1e-10, -1])
			expect(() => absFxCurrentCoverageBinding(alpha)).toThrow('binding unresolved');

		expect(() => absFxCurrentCoverageBinding(0, NaN)).toThrow('finite');
	});
	it('keeps the complete native multiplicative binding, never init-only fallback', () => {
		expect(absFxCurrentCoverage(2, 0.5, 0.25)).toBe(0.75);
		expect(absFxCurrentCoverage(2, 1, 2)).toBe(0);
		expect(absFxCurrentCoverage(2, 1, -2)).toBe(2);
		expect(() => absFxCurrentCoverage(2, 1)).toThrow('binding unresolved');
	});
});
