import {
	BufferAttribute,
	Float32BufferAttribute,
	InterleavedBufferAttribute,
	type BufferGeometry,
	type Vector3,
} from 'three';
import { type WaterFX } from './waterFx.js';
import { bindWaterFxNativeColor, type WaterFxColorProof } from './waterFxResources.js';

interface WaterFxStreamProof {
	sha256: string;
	bytes: number;
	count: number;
	type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';
	componentType: 5121 | 5123 | 5125 | 5126;
}

interface WaterFxGeometryProof {
	domain: 'x6fx-source-streams-lossless-v1';
	sourceModelSha256: string;
	shader: string;
	streams: Record<string, WaterFxStreamProof>;
}

export interface WaterFxMergedDomain {
	color: WaterFxColorProof;
	source: WaterFxGeometryProof;
	vertexStart: number;
	checkedVertices: number;
	objectCenter: [number, number, number];
}

/** Runs on original section streams before cfg/node transforms or merge padding.
 * Source proof labels alone are insufficient; hash all consumed original lanes,
 * native IDs and topology, including the real float32 VM colour carrier. */
export async function restoreWaterFxGeometry(geometry: BufferGeometry, config: WaterFX): Promise<void> {
	const proof = geometry.userData.waterFxGeometry as WaterFxGeometryProof | undefined;
	const color = geometry.userData.virtualColorSource as WaterFxColorProof | undefined;
	if (
		!proof ||
		proof.domain !== 'x6fx-source-streams-lossless-v1' ||
		proof.shader !== config.shader ||
		!/^[a-f0-9]{64}$/.test(proof.sourceModelSha256) ||
		!color?.projectionBasisVerified
	) throw new Error('X6FX protected native source streams and TBN admission missing');

	const semantics: Array<[string, string]> = [
		['POSITION', 'position'],
		['NORMAL', 'normal'],
		['TANGENT', 'tangent'],
		['TEXCOORD_0', 'uv'],
		['_LAYER_COLOR', '_layer_color'],
		['_UE_VERTEX_INDEX', '_ue_vertex_index'],
		['indices', 'indices'],
	];

	if (config.material[13]![1] !== 0) semantics.push(['TEXCOORD_1', 'uv1']);
	for (const [semantic, name] of semantics) {
		const stream = proof.streams[semantic];
		const attribute =
			name === 'indices'
				? geometry.index
				: name === '_ue_vertex_index'
					? (geometry.getAttribute('_water_fx_vertex_index') ?? geometry.getAttribute(name))
					: geometry.getAttribute(name);
		const lanes = stream ? { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[stream.type] : 0;
		const bytes = stream ? { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[stream.componentType] : 0;
		if (
			!stream ||
			!attribute ||
			!lanes ||
			!bytes ||
			attribute.normalized ||
			attribute.itemSize !== lanes ||
			attribute.count !== stream.count ||
			stream.bytes !== stream.count * lanes * bytes
		) throw new Error(`X6FX protected native ${semantic} format changed`);

		const data = new ArrayBuffer(stream.bytes);
		const view = new DataView(data);
		for (let i = 0; i < attribute.count; i++) {
			const values = [
				attribute.getX(i),
				attribute.itemSize > 1 ? attribute.getY(i) : 0,
				attribute.itemSize > 2 ? attribute.getZ(i) : 0,
				attribute.itemSize > 3 ? attribute.getW(i) : 0,
			];

			for (let lane = 0; lane < lanes; lane++) {
				const offset = (i * lanes + lane) * bytes;
				const value = values[lane]!;
				switch (stream.componentType) {
				case 5126:
					view.setFloat32(offset, value, true);
					break;
				case 5125:
					view.setUint32(offset, value, true);
					break;
				case 5123:
					view.setUint16(offset, value, true);
					break;
				case 5121:
					view.setUint8(offset, value);
					break;
				}
			}
		}

		const digest = await crypto.subtle.digest('SHA-256', data);
		const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
		if (hash !== stream.sha256) throw new Error(`X6FX protected native ${semantic} bytes changed`);
	}

	await bindWaterFxNativeColor(geometry, color);
	// Original native GLB POSITION/NORMAL/TANGENT/UV may share an interleaved
	// buffer. Three's mergeGeometries accepts only ordinary BufferAttributes;
	// detach exact float32 values after their source-byte verification, not by
	// dropping the stream or rebuilding normals/tangents.
	for (const name of [
		'position',
		'normal',
		'tangent',
		'uv',
		...(config.material[13]![1] !== 0 ? ['uv1'] : []),
	]) {
		const attribute = geometry.getAttribute(name);
		if (!('isInterleavedBufferAttribute' in attribute) || !attribute.isInterleavedBufferAttribute)
			continue;

		const values = new Float32Array(attribute.count * attribute.itemSize);
		for (let i = 0; i < attribute.count; i++) {
			values[i * attribute.itemSize] = attribute.getX(i);
			if (attribute.itemSize > 1) values[i * attribute.itemSize + 1] = attribute.getY(i);
			if (attribute.itemSize > 2) values[i * attribute.itemSize + 2] = attribute.getZ(i);
			if (attribute.itemSize > 3) values[i * attribute.itemSize + 3] = attribute.getW(i);
		}

		geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize));
	}
	// The proof witness has already been consumed. It is not a shader attribute
	// and must not constrain unrelated material streams during merge.
	geometry.deleteAttribute('_layer_color');
	geometry.deleteAttribute('_ue_vertex_index');
	geometry.deleteAttribute('_water_fx_vertex_index');
}

/** Zero padding belongs exclusively to non-FX slots. No source colour proof is
 * assigned to these lanes, and native FX admission must happen before this. */
export function padWaterFxMergeAttributes(geometries: BufferGeometry[]): void {
	if (!geometries.some((geometry) => geometry.hasAttribute('ueWaterFxColor'))) return;

	for (const geometry of geometries) {
		for (const [name, attribute] of Object.entries(geometry.attributes)) {
			if (!(attribute instanceof InterleavedBufferAttribute)) continue;
			const data = attribute.data.array.slice(0, attribute.count * attribute.itemSize);
			for (let i = 0; i < attribute.count; i++)
				for (let lane = 0; lane < attribute.itemSize; lane++) {
					data[i * attribute.itemSize + lane] = attribute.data.array[i * attribute.data.stride + attribute.offset + lane]!;
				}

			geometry.setAttribute(name, new BufferAttribute(data, attribute.itemSize, attribute.normalized));
		}

		if (geometry.hasAttribute('ueWaterFxColor')) continue;
		if (geometry.userData.waterFxGeometry) throw new Error('X6FX native RGBA carrier required before merge padding');

		const count = geometry.getAttribute('position')?.count;
		if (!count) throw new Error('X6FX merge padding needs valid non-FX positions');

		geometry.setAttribute('ueWaterFxColor', new Float32BufferAttribute(new Float32Array(count * 4), 4));
	}
}

/** Called after unchanged cfg/root transforms. Retain per-material ownership:
 * a merged vertex count is not the native section's checkedVertices count. */
export function mergeWaterFxDomains(merged: BufferGeometry, sections: BufferGeometry[], centers: Map<number, Vector3>): void {
	const domains: Record<number, WaterFxMergedDomain> = {};
	let vertexStart = 0;
	sections.forEach((section, slot) => {
		const source = section.userData.waterFxGeometry as WaterFxGeometryProof | undefined;
		if (source) {
			const color = section.userData.waterFxColorProof as WaterFxColorProof | undefined;
			const center = centers.get(slot);
			if (
				!color?.projectionBasisVerified ||
				!center ||
				![center.x, center.y, center.z].every(Number.isFinite)
			) throw new Error('X6FX merged slot requires proven original source RGBA/TBN and component center');

			domains[slot] = {
				color,
				source,
				vertexStart,
				checkedVertices: color.checkedVertices,
				objectCenter: center.toArray(),
			};
		}

		vertexStart += section.getAttribute('position').count;
	});
	if (Object.keys(domains).length) merged.userData.waterFxDomains = domains;
}
