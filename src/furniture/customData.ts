import { DataTexture, NearestFilter, RGBAIntegerFormat, UnsignedIntType } from 'three';

/** One native PaperCustomData value (HISM slot 0) per source mesh component. */
export type PaperCustomData = readonly number[] | Uint32Array;

export function validatePaperCustomData(values: PaperCustomData, components: number): void {
	if (values.length !== components) throw new RangeError(`Expected ${components} source component values, received ${values.length}`);

	for (const value of values) {
		if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('PaperCustomData must contain unsigned 32-bit integers');
	}
}

/** CPU reference for the native HBC array-coordinate conversion. */
export function hbcLayer(raw: number, floorIndex: number, isWall: number, depth: number): number {
	validatePaperCustomData([raw], 1);
	if (!Number.isInteger(floorIndex) || !Number.isFinite(isWall) || !Number.isInteger(depth) || depth < 1) throw new RangeError('Invalid HBC material parameters or physical array depth');

	const tens = (raw % 100) / 10;
	const ones = raw % 10;
	const coordinate = floorIndex + tens + (ones - tens) * isWall;
	const lower = Math.floor(coordinate);
	const fraction = coordinate - lower;
	const rounded = fraction < 0.5 || (fraction === 0.5 && lower % 2 === 0) ? lower : lower + 1;
	return Math.max(0, Math.min(depth - 1, rounded));
}

/** Batch-owned integer storage. Four components per texel match r183's RGBA update ranges. */
export class CustomDataBuffer {
	readonly stride: number;
	readonly texture: DataTexture;
	readonly capacity: number;
	private readonly data: Uint32Array;
	private readonly defaults: Uint32Array;
	private readonly dirty = new Set<number>();
	private disposed = false;

	constructor(defaults: PaperCustomData, capacity: number, maxTextureSize: number) {
		if (!defaults.length || !Number.isInteger(capacity) || capacity < 1 ||
				!Number.isInteger(maxTextureSize) || maxTextureSize < 1) throw new RangeError('Invalid custom-data storage dimensions');

		validatePaperCustomData(defaults, defaults.length);
		this.capacity = capacity;
		this.defaults = Uint32Array.from(defaults);
		this.stride = Math.ceil(defaults.length / 4) * 4;

		const texels = this.stride / 4 * capacity;
		const width = Math.min(maxTextureSize, Math.ceil(Math.sqrt(texels)));
		const height = Math.ceil(texels / width);
		if (height > maxTextureSize) throw new RangeError('Custom-data batch exceeds MAX_TEXTURE_SIZE');

		this.data = new Uint32Array(width * height * 4);
		for (let slot = 0; slot < capacity; slot++) this.data.set(this.defaults, slot * this.stride);

		this.texture = new DataTexture(this.data, width, height, RGBAIntegerFormat, UnsignedIntType);
		this.texture.name = 'nuan-paper-custom-data';
		this.texture.internalFormat = 'RGBA32UI';
		this.texture.minFilter = this.texture.magFilter = NearestFilter;
		this.texture.generateMipmaps = false;
		this.texture.needsUpdate = true;
	}

	set(slot: number, values: PaperCustomData = this.defaults): boolean {
		this.assertSlot(slot);
		validatePaperCustomData(values, this.defaults.length);

		const offset = slot * this.stride;
		let changed = false;
		for (let i = 0; i < values.length; i++) {
			const value = values[i]!;
			if (this.data[offset + i] === value) continue;
			this.data[offset + i] = value;
			this.dirty.add(Math.floor((offset + i) / 4));
			changed = true;
		}

		return changed;
	}

	copySlot(from: number, to: number): void {
		this.assertSlot(from);
		this.assertSlot(to);
		if (from === to) return;

		const start = from * this.stride;
		this.set(to, this.data.subarray(start, start + this.defaults.length));
	}

	copyTo(target: CustomDataBuffer, count: number): void {
		if (this.disposed || target.disposed || target.stride !== this.stride ||
				target.defaults.length !== this.defaults.length || !Number.isInteger(count) ||
				count < 0 || count > Math.min(this.capacity, target.capacity)) throw new RangeError('Incompatible custom-data storage copy');

		for (let slot = 0; slot < count; slot++) {
			const start = slot * this.stride;
			target.set(slot, this.data.subarray(start, start + this.defaults.length));
		}
	}

	/** Called once before drawing. Each range is texel-aligned and stays within a row. */
	flush(): boolean {
		if (this.disposed || !this.dirty.size) return false;

		const width = this.texture.image.width;
		const texels = [...this.dirty].sort((a, b) => a - b);
		let start = texels[0]!;
		let end = start;
		for (let i = 1; i <= texels.length; i++) {
			const next = texels[i];
			if (next === end + 1 && Math.floor(next / width) === Math.floor(start / width)) {
				end = next;
				continue;
			}

			this.texture.addUpdateRange(start * 4, (end - start + 1) * 4);
			if (next !== undefined) start = end = next;
		}

		this.dirty.clear();
		this.texture.needsUpdate = true;
		return true;
	}

	dispose(): void {
		if (this.disposed) return;

		this.disposed = true;
		this.dirty.clear();
		this.texture.dispose();
	}

	private assertSlot(slot: number): void {
		if (this.disposed) throw new Error('Custom-data owner disposed');
		if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacity) throw new RangeError('Custom-data instance slot out of range');
	}
}

// geometry.ts gives each triangle a single source component. Its constant value
// can use smooth byte lanes, retaining uint32 precision while avoiding the
// measured flat-integer varying cost on ANGLE/D3D11.
export const paperCustomDataVertex = /* glsl */ `
attribute highp float nuanSourceMesh;
uniform highp usampler2D nuanCustomData;
uniform highp int nuanCustomDataStride;
out highp vec4 nuanPaperCustomDataBytes;
highp uint nuanPaperCustomData;
highp vec4 nuanEncodePaperCustomData(highp uint value) {
  return vec4(uvec4(value, value >> 8u, value >> 16u, value >> 24u) & uvec4(255u));
}
highp uint nuanReadPaperCustomData() {
  highp int word = gl_InstanceID * nuanCustomDataStride + int(nuanSourceMesh);
  highp int pixel = word / 4;
  highp int width = textureSize(nuanCustomData, 0).x;
  highp uvec4 packed = texelFetch(nuanCustomData, ivec2(pixel % width, pixel / width), 0);
  return packed[word % 4];
}
`;

export const paperCustomDataFragment = /* glsl */ `
in highp vec4 nuanPaperCustomDataBytes;
highp uint nuanPaperCustomData;
highp uint nuanDecodePaperCustomData(highp vec4 value) {
  highp uvec4 bytes = uvec4(round(value));
  return bytes.x | (bytes.y << 8u) | (bytes.z << 16u) | (bytes.w << 24u);
}
float nuanHBCLayer(vec2 parameters, int depth) {
  float tens = float(nuanPaperCustomData % 100u) / 10.0;
  float ones = float(nuanPaperCustomData % 10u);
  return clamp(roundEven(parameters.x + tens + (ones - tens) * parameters.y), 0.0, float(depth - 1));
}
`;
