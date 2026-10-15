import { describe, expect, it } from 'vitest';
import { BoxGeometry } from 'three';
import { getDrawBounds } from '../../src/runtime/geometryCache.js';

describe('draw bounds cache', () => {
	it('reuses immutable bounds and invalidates attribute uploads, index and group edits', () => {
		const geometry = new BoxGeometry(2, 2, 2);
		const first = getDrawBounds(geometry, 0);
		expect(getDrawBounds(geometry, 0)).toBe(first);

		const position = geometry.getAttribute('position');
		position.setX(0, 10);
		position.needsUpdate = true;

		const updated = getDrawBounds(geometry, 0);
		expect(updated).not.toBe(first);
		expect(updated.max.x).toBe(10);
		geometry.clearGroups();
		expect(getDrawBounds(geometry, 0).isEmpty()).toBe(true);
		expect(getDrawBounds(geometry, -1).isEmpty()).toBe(false);
		geometry.setDrawRange(0, 0);
		expect(getDrawBounds(geometry, -1).isEmpty()).toBe(true);
	});
});
