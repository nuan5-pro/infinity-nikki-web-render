import { createHash } from 'node:crypto';
import type { FurnitureAsset, FurniturePackedResource } from '../../src/furniture/types.js';

export function bundleFixture(inputs: Uint8Array[]) {
	let size = 16;
	const offsets = inputs.map((bytes) => {
		size = (size + 3) & ~3;

		const offset = size;
		size += bytes.byteLength;
		return offset;
	});
	const data = new Uint8Array(size);
	data.set(new TextEncoder().encode('N5FB'));

	const header = new DataView(data.buffer);
	header.setUint32(4, 1, true);
	header.setUint32(8, inputs.length, true);
	inputs.forEach((bytes, i) => data.set(bytes, offsets[i]!));

	const hash = createHash('sha256').update(data).digest('hex');
	const id = `b-${hash.slice(0, 16)}`;
	const asset: FurnitureAsset = { path: `textures/${id}.bin`, bytes: size };
	const resources: FurniturePackedResource[] = inputs.map((bytes, i) => ({
		bundle: id,
		byteOffset: offsets[i]!,
		bytes: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	}));
	return { data, asset, bundles: { [id]: size }, resources, resource: resources[0]! };
}
