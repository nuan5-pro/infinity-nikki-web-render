import { Box3, Vector3, type BufferGeometry } from 'three';

/** Write revisions without truncating a reusable buffer's allocated storage. */
export function writeGeometryRevision(geometry: BufferGeometry, target: unknown[], offset: number): number {
	target[offset++] = geometry.index;
	target[offset++] = geometry.index?.version;
	target[offset++] = geometry.drawRange.start;
	target[offset++] = geometry.drawRange.count;
	for (const name in geometry.attributes) {
		const attribute = geometry.attributes[name]!;
		target[offset++] = name;
		target[offset++] = attribute;
		target[offset++] = 'version' in attribute ? attribute.version : attribute.data.version;
		target[offset++] = attribute.count;
	}
	for (const group of geometry.groups) {
		target[offset++] = group.start;
		target[offset++] = group.count;
		target[offset++] = group.materialIndex;
	}

	return offset;
}

/** Track local geometry through attribute identity and upload versions. */
export function geometryRevision(geometry: BufferGeometry): unknown[] {
	const revision: unknown[] = [];
	writeGeometryRevision(geometry, revision, 0);
	return revision;
}

export function sameGeometryRevision(a: unknown[], b: unknown[]) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

const bounds = new WeakMap<BufferGeometry, { revision: unknown[]; groups: Map<number, Box3> }>();
const point = new Vector3();

/** Returned bounds are shared and must be copied before world transforms. */
export function getDrawBounds(geometry: BufferGeometry, materialIndex: number): Box3 {
	const revision = geometryRevision(geometry);
	let entry = bounds.get(geometry);
	if (!entry || !sameGeometryRevision(entry.revision, revision)) {
		entry = { revision, groups: new Map() };
		bounds.set(geometry, entry);
	}

	const cached = entry.groups.get(materialIndex);
	if (cached) return cached;

	const box = new Box3();
	const position = geometry.getAttribute('position');
	const index = geometry.index;
	if (position) {
		const available = index?.count ?? position.count;
		const groups =
			materialIndex < 0
				? [{ start: 0, count: available }]
				: geometry.groups.filter((group) => group.materialIndex === materialIndex);
		for (const group of groups) {
			const start = Math.max(group.start, geometry.drawRange.start);
			const end = Math.min(group.start + group.count, geometry.drawRange.start + geometry.drawRange.count, available);
			for (let cursor = start; cursor < end; cursor++) {
				point.fromBufferAttribute(position, index ? index.getX(cursor) : cursor);
				box.expandByPoint(point);
			}
		}
	}

	entry.groups.set(materialIndex, box);
	return box;
}
