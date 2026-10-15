import {
	Box3,
	BufferAttribute,
	BufferGeometry,
	MeshPhysicalMaterial,
	MeshStandardMaterial,
	Sphere,
	Vector3,
	type Material,
} from 'three';
import type { FurnitureAssetSelection, FurnitureDB, FurnitureModelConfig } from './types.js';
import {
	cloneSourceMaterialForItem,
	createPlainMaterialBuilder,
	resolveMaterialBaseName,
	type MaterialRegistry,
} from '../materials/factory.js';
import type { GeometryData, GeometryPreparationSnapshot } from './geometry.js';
import type { MaterialAssetData } from './assets.js';

// Bump when geometry preparation or material-source transport changes.
const contract = 'nuan5-render-prepared-geometry-1';
const magic = 0x31474d42;
const alignment = 8;

const arrayTypes = {
	Float32Array,
	Float64Array,
	Uint32Array,
	Uint16Array,
	Uint8Array,
	Int32Array,
	Int16Array,
	Int8Array,
	Uint8ClampedArray,
};

type ArrayName = keyof typeof arrayTypes;

interface StoredAttribute {
	type: ArrayName;
	offset: number;
	length: number;
	itemSize: number;
	normalized: boolean;
	gpuType: number;
}

interface MaterialSource {
	id: string;
	extra: Record<string, unknown>;
	vertexColors: boolean;
	flatShading?: boolean;
	normalScale?: number[];
	clearcoatNormalScale?: number[];
}

interface Header {
	contract: typeof contract;
	input: string;
	attributes: Record<string, StoredAttribute>;
	index?: StoredAttribute;
	groups: BufferGeometry['groups'];
	drawRange: [number, number | null];
	bounds: number[][];
	sphere: number[] | null;
	userData: Record<string, unknown>;
	sources: MaterialSource[];
	meshBaseNames: (string | null)[];
	slotMeshIndices: number[];
	meshMaterialCounts: number[];
}

function align(value: number) {
	return Math.ceil(value / alignment) * alignment;
}

/** Bind prepared geometry to its source assembly and inline material contracts. */
export async function preparedGeometryInput(
	config: FurnitureModelConfig,
	selection: FurnitureAssetSelection,
	catalog: Pick<FurnitureDB, 'materials'>,
): Promise<string> {
	const ids = [...new Set(config.meshes.flatMap((mesh) => mesh.slots))].sort();
	const data = JSON.stringify([
		contract,
		config.id,
		config.root_offset,
		config.meshes,
		selection,
		ids.map((id) => [id, catalog.materials[id]]),
	]);
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Binary arrays keep their exact element type and bits; only small descriptors
 * and existing JSON-compatible geometry proofs are stored as JSON. */
export function encodePreparedGeometry(
	snapshot: GeometryPreparationSnapshot,
	input: string,
	ids: string[],
	catalog: Pick<FurnitureDB, 'materials'>,
): ArrayBuffer {
	const geometry = snapshot.geometry;
	if (ids.length !== snapshot.sourceMaterials.length || !geometry.boundingBox) throw new Error('[Prepared geometry] Incomplete source bindings/bounds');

	const chunks: Uint8Array[] = [];
	let bytes = 0;

	const store = (attribute: BufferAttribute): StoredAttribute => {
		if ('isInterleavedBufferAttribute' in attribute) throw new Error(
			'[Prepared geometry] Interleaved attributes must be resolved before compilation',
		);

		const type = attribute.array.constructor.name as ArrayName;
		if (!(type in arrayTypes)) throw new Error(`[Prepared geometry] Unsupported array ${type}`);

		bytes = align(bytes);

		const offset = bytes;
		const chunk = new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
		chunks.push(chunk.slice());
		bytes += chunk.byteLength;
		return {
			type,
			offset,
			length: attribute.array.length,
			itemSize: attribute.itemSize,
			normalized: attribute.normalized,
			gpuType: attribute.gpuType,
		};
	};

	const attributes = Object.fromEntries(
		Object.entries(geometry.attributes).map(([name, attribute]) => [
			name,
			store(attribute as BufferAttribute),
		]),
	);
	const index = geometry.index ? store(geometry.index) : undefined;
	const sources = snapshot.sourceMaterials.map((material, slot): MaterialSource => {
		const id = ids[slot]!;
		const definition = catalog.materials[id];
		if (!definition) throw new Error(`[Prepared geometry] Missing source material ${id}`);

		const extra = Object.fromEntries(
			Object.entries(material.userData).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(definition.extras?.[key])),
		);
		return {
			id,
			extra,
			vertexColors: material.vertexColors,
			...(material instanceof MeshStandardMaterial
				? { flatShading: material.flatShading, normalScale: material.normalScale.toArray() }
				: {}),
			...(material instanceof MeshPhysicalMaterial
				? { clearcoatNormalScale: material.clearcoatNormalScale.toArray() }
				: {}),
		};
	});

	const header: Header = {
		contract,
		input,
		attributes,
		index,
		groups: geometry.groups.map((group) => ({ ...group })),
		drawRange: [
			geometry.drawRange.start,
			Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : null,
		],
		bounds: [geometry.boundingBox.min.toArray(), geometry.boundingBox.max.toArray()],
		sphere: geometry.boundingSphere
			? [...geometry.boundingSphere.center.toArray(), geometry.boundingSphere.radius]
			: null,
		userData: geometry.userData,
		sources,
		meshBaseNames: snapshot.meshBaseNames,
		slotMeshIndices: snapshot.slotMeshIndices,
		meshMaterialCounts: snapshot.meshMaterialCounts,
	};

	const json = new TextEncoder().encode(JSON.stringify(header));
	const start = align(8 + json.length);
	const buffer = new ArrayBuffer(start + bytes);
	const view = new DataView(buffer);
	view.setUint32(0, magic, true);
	view.setUint32(4, json.length, true);
	new Uint8Array(buffer, 8, json.length).set(json);

	let cursor = 0;
	for (const chunk of chunks) {
		cursor = align(cursor);
		new Uint8Array(buffer, start + cursor, chunk.length).set(chunk);
		cursor += chunk.length;
	}

	return buffer;
}

export function decodePreparedGeometry(buffer: ArrayBuffer, input: string): { geometry: BufferGeometry; header: Header } {
	if (buffer.byteLength < 8) throw new Error('[Prepared geometry] Truncated header');

	const view = new DataView(buffer);
	const length = view.getUint32(4, true);
	if (view.getUint32(0, true) !== magic || length > buffer.byteLength - 8) throw new Error('[Prepared geometry] Invalid header');

	const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length))) as Header;
	if (header.contract !== contract || header.input !== input) throw new Error('[Prepared geometry] Stale compiler contract/source inputs');

	const slots = header.sources?.length;
	if (
		!slots ||
		!Array.isArray(header.meshBaseNames) ||
		header.meshBaseNames.length !== slots ||
		!Array.isArray(header.slotMeshIndices) ||
		header.slotMeshIndices.length !== slots ||
		!Array.isArray(header.meshMaterialCounts) ||
		header.meshMaterialCounts.reduce((sum, count) => sum + count, 0) !== slots ||
		!Array.isArray(header.bounds) ||
		header.bounds.length !== 2 ||
		header.bounds.some((values) => values.length !== 3 || !values.every(Number.isFinite))
	) throw new Error('[Prepared geometry] Invalid material slots/bounds');

	const start = align(8 + length);

	const read = (stored: StoredAttribute) => {
		const Type = arrayTypes[stored.type];
		if (
			!Object.prototype.hasOwnProperty.call(arrayTypes, stored.type) ||
			!Number.isSafeInteger(stored.offset) ||
			stored.offset < 0 ||
			stored.offset % alignment !== 0 ||
			!Number.isSafeInteger(stored.length) ||
			stored.length <= 0 ||
			!Number.isInteger(stored.itemSize) ||
			stored.itemSize < 1 ||
			stored.itemSize > 4 ||
			stored.length % stored.itemSize !== 0 ||
			start + stored.offset + stored.length * Type.BYTES_PER_ELEMENT > buffer.byteLength
		) throw new Error('[Prepared geometry] Invalid attribute range/type');

		const attribute = new BufferAttribute(new Type(buffer, start + stored.offset, stored.length), stored.itemSize, stored.normalized);
		attribute.gpuType = stored.gpuType as BufferAttribute['gpuType'];
		return attribute;
	};

	const geometry = new BufferGeometry();
	try {
		for (const [name, attribute] of Object.entries(header.attributes))
			geometry.setAttribute(name, read(attribute));
		// BVH construction reorders triangle indices. Keep the globally cached
		// artifact immutable while vertex streams remain shared read-only views.
		if (header.index) geometry.setIndex(read(header.index).clone());
		const position = geometry.getAttribute('position');
		if (!position || position.itemSize !== 3) throw new Error('[Prepared geometry] Missing positions');
		if (Object.values(geometry.attributes).some((attribute) => attribute.count !== position.count)) throw new Error('[Prepared geometry] Attribute count mismatch');

		const count = geometry.index?.count ?? position.count;
		for (const group of header.groups) {
			if (
				![group.start, group.count, group.materialIndex].every(Number.isSafeInteger) ||
				group.start < 0 ||
				group.count < 0 ||
				group.start + group.count > count ||
				group.materialIndex! < 0 ||
				group.materialIndex! >= slots
			) throw new Error('[Prepared geometry] Invalid draw group');

			geometry.addGroup(group.start, group.count, group.materialIndex);
		}

		geometry.setDrawRange(header.drawRange[0], header.drawRange[1] ?? Infinity);
		geometry.boundingBox = new Box3(new Vector3().fromArray(header.bounds[0]!), new Vector3().fromArray(header.bounds[1]!));
		if (header.sphere)
			geometry.boundingSphere = new Sphere(new Vector3().fromArray(header.sphere), header.sphere[3]);

		geometry.userData = header.userData;
		return { geometry, header };
	} catch (error) {
		geometry.dispose();
		throw error;
	}
}

export async function restorePreparedGeometry(buffer: ArrayBuffer, input: string, getMaterial: (id: string) => Promise<MaterialAssetData>): Promise<GeometryData> {
	const { geometry, header } = decodePreparedGeometry(buffer, input);
	const sources: Material[] = [];
	const plainMaterials: Material[] = [];
	const materialRegistry: MaterialRegistry = new Map();
	try {
		const assets = await Promise.all(header.sources.map((source) => getMaterial(source.id)));
		for (let slot = 0; slot < header.sources.length; slot++) {
			const recipe = header.sources[slot]!;
			const asset = assets[slot]!;
			const source = cloneSourceMaterialForItem(asset.material);
			sources.push(source);
			Object.assign(source.userData, recipe.extra);
			source.vertexColors = recipe.vertexColors;
			if (source instanceof MeshStandardMaterial) {
				source.flatShading = recipe.flatShading!;
				source.normalScale.fromArray(recipe.normalScale!);
			}

			if (source instanceof MeshPhysicalMaterial)
				source.clearcoatNormalScale.fromArray(recipe.clearcoatNormalScale!);

			const base = resolveMaterialBaseName(source);
			const expected = base ? `${recipe.id}:${base}` : null;
			if (header.meshBaseNames[slot] !== expected) throw new Error('[Prepared geometry] Material slot identity changed');

			if (base && expected) {
				const registry = asset.materialRegistry.get(base);
				if (registry) materialRegistry.set(expected, registry);
			}
		}

		const buildPlainMaterial = createPlainMaterialBuilder(materialRegistry);
		for (let slot = 0; slot < sources.length; slot++)
			plainMaterials.push(await buildPlainMaterial(sources[slot]!, header.meshBaseNames[slot] ?? null));

		return {
			geometry,
			plainMaterials,
			meshBaseNames: header.meshBaseNames,
			slotMeshIndices: header.slotMeshIndices,
			meshMaterialCounts: header.meshMaterialCounts,
			materialRegistry,
			boundingBox: geometry.boundingBox!.clone(),
			mergedMaterial: plainMaterials.length > 1 ? plainMaterials : plainMaterials[0]!,
		};
	} catch (error) {
		geometry.dispose();
		for (const material of new Set(plainMaterials)) material.dispose();

		throw error;
	} finally {
		for (const material of sources) material.dispose();
	}
}
