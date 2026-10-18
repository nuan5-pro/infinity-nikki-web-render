import { Box3, BufferAttribute, BufferGeometry, Float16BufferAttribute, InterleavedBufferAttribute, Matrix4, Sphere, Vector3 } from 'three';
import { MeshBVH, type SerializedBVH } from 'three-mesh-bvh';

interface AttributeData {
	array: BufferAttribute['array'];
	itemSize: number;
	normalized: boolean;
	gpuType: BufferAttribute['gpuType'];
	float16: boolean;
}

interface GeometryBuffers {
	attributes: Record<string, AttributeData>;
	index?: AttributeData;
	groups: BufferGeometry['groups'];
	drawRange: BufferGeometry['drawRange'];
	box?: number[];
	sphere?: number[];
	tree?: SerializedBVH & { indirectBuffer?: Uint16Array | Uint32Array | null };
}

export interface GeometryWork {
	geometries: GeometryBuffers[];
	matrices: (number[] | null)[];
	boundsTree: boolean;
}

function packAttribute(source: BufferAttribute | InterleavedBufferAttribute): AttributeData {
	let attribute: BufferAttribute;
	if (source instanceof InterleavedBufferAttribute) {
		const array = source.array.slice(0, source.count * source.itemSize);
		for (let vertex = 0; vertex < source.count; vertex++) {
			for (let component = 0; component < source.itemSize; component++)
				array[vertex * source.itemSize + component] = source.array[vertex * source.data.stride + source.offset + component]!;
		}
		attribute = new BufferAttribute(array, source.itemSize, source.normalized);
	} else attribute = source;
	return {
		array: attribute.array, itemSize: attribute.itemSize, normalized: attribute.normalized,
		gpuType: attribute.gpuType, float16: attribute instanceof Float16BufferAttribute,
	};
}

function unpackAttribute(data: AttributeData): BufferAttribute {
	const attribute = data.float16
		? new Float16BufferAttribute(data.array, data.itemSize, data.normalized)
		: new BufferAttribute(data.array, data.itemSize, data.normalized);
	attribute.gpuType = data.gpuType;
	return attribute;
}

/** Callers pass owned geometry clones; source-cache buffers never enter a transfer list. */
export function packGeometryBuffers(geometry: BufferGeometry): GeometryBuffers {
	return {
		attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, packAttribute(attribute)])),
		index: geometry.index ? packAttribute(geometry.index) : undefined,
		groups: geometry.groups,
		drawRange: geometry.drawRange,
		box: geometry.boundingBox ? [...geometry.boundingBox.min.toArray(), ...geometry.boundingBox.max.toArray()] : undefined,
		sphere: geometry.boundingSphere ? [...geometry.boundingSphere.center.toArray(), geometry.boundingSphere.radius] : undefined,
	};
}

export function restoreGeometryBuffers(geometry: BufferGeometry, data: GeometryBuffers): void {
	for (const [name, attribute] of Object.entries(data.attributes)) geometry.setAttribute(name, unpackAttribute(attribute));
	geometry.setIndex(data.index ? unpackAttribute(data.index) : null);
	geometry.groups = data.groups;
	geometry.drawRange = data.drawRange;
	geometry.boundingBox = data.box ? new Box3(new Vector3().fromArray(data.box), new Vector3().fromArray(data.box, 3)) : null;
	geometry.boundingSphere = data.sphere ? new Sphere(new Vector3().fromArray(data.sphere), data.sphere[3]) : null;
	if (data.tree) geometry.boundsTree = MeshBVH.deserialize(data.tree, geometry, { setIndex: false });
}

export function geometryTransfers(geometries: GeometryBuffers[]): ArrayBuffer[] {
	const buffers = new Set<ArrayBuffer>();
	const add = (buffer: ArrayBufferLike | undefined) => {
		if (buffer instanceof ArrayBuffer) buffers.add(buffer);
	};
	for (const geometry of geometries) {
		for (const attribute of Object.values(geometry.attributes)) add(attribute.array.buffer);
		add(geometry.index?.array.buffer);
		for (const root of geometry.tree?.roots ?? []) add(root);
		add(geometry.tree?.index?.buffer);
		add(geometry.tree?.indirectBuffer?.buffer);
	}
	return [...buffers];
}

export function processGeometryBuffers(work: GeometryWork): GeometryBuffers[] {
	return work.geometries.map((data, index) => {
		const geometry = new BufferGeometry();
		restoreGeometryBuffers(geometry, data);
		geometry.boundingBox = null;
		const matrix = work.matrices[index];
		if (matrix) geometry.applyMatrix4(new Matrix4().fromArray(matrix));
		geometry.computeBoundingBox();
		const result = packGeometryBuffers(geometry);
		if (work.boundsTree) result.tree = MeshBVH.serialize(new MeshBVH(geometry, { indirect: true }), { cloneBuffers: false });
		return result;
	});
}
