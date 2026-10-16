import { describe, expect, it } from 'vitest';
import { BoxGeometry } from 'three';
import { geometryRevision, getDrawBounds, writeGeometryRevision } from '../../src/runtime/geometryCache.js';

describe('draw bounds cache', () => {
	it('appends the same revision into reusable snapshots without overwriting their prefix', () => {
		const geometry = new BoxGeometry();
		const expected = geometryRevision(geometry);
		const target: unknown[] = ['mesh'];
		expect(writeGeometryRevision(geometry, target, 1)).toBe(expected.length + 1);
		expect(target).toEqual(['mesh', ...expected]);
		geometry.getAttribute('position').needsUpdate = true;
		writeGeometryRevision(geometry, target, 1);
		expect(target).toEqual(['mesh', ...geometryRevision(geometry)]);
		expect(target.slice(1)).not.toEqual(expected);
	});

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
