import type { WebGLRenderer } from 'three';

interface ArrayValue {
	length: number
	[index: number]:
		| number
		| {
			elements?: ArrayLike<number>
			x?: number
			y?: number
			z?: number
			w?: number
			r?: number
			g?: number
			b?: number
		}
}

interface Uniform {
	type?: number
	size?: number
	seq?: Uniform[]
	setValue(gl: WebGLRenderingContext, value: ArrayValue, textures?: unknown): void
}

interface Program {
	isReady(): boolean
	getUniforms(): { seq: Uniform[] }
}

const prepared = new WeakSet<Program>();
// Cache numeric WebGL types. Other types retain Three's setter.
const widths: Record<number, number> = {
	0x1406: 1,
	0x8b50: 2,
	0x8b51: 3,
	0x8b52: 4, // FLOAT, FLOAT_VEC2/3/4
	0x8b5a: 4,
	0x8b5b: 9,
	0x8b5c: 16, // FLOAT_MAT2/3/4
	0x1404: 1,
	0x8b53: 2,
	0x8b54: 3,
	0x8b55: 4, // INT, INT_VEC2/3/4
	0x8b56: 1,
	0x8b57: 2,
	0x8b58: 3,
	0x8b59: 4, // BOOL, BOOL_VEC2/3/4
	0x1405: 1,
	0x8dc6: 2,
	0x8dc7: 3,
	0x8dc8: 4, // UNSIGNED_INT, UNSIGNED_INT_VEC2/3/4
};

const axes = ['x', 'y', 'z', 'w'] as const;
const colors = ['r', 'g', 'b'] as const;

/** Three r183 caches scalar uniforms, but its numeric array setters always flatten/upload. */
export function cacheArrayUniform(uniform: Uniform): void {
	const width = widths[uniform.type ?? 0];
	if (uniform.size === undefined || !width) return;

	const original = uniform.setValue;
	const cache: number[] = [];
	uniform.setValue = function (gl, value, textures) {
		const flat = typeof value[0] === 'number';
		const length = flat ? value.length : uniform.size! * width;
		let changed = cache.length !== length;
		if (flat) {
			for (let i = 0; i < length; i++) {
				const next = value[i] as number;
				if (cache[i] !== next) {
					changed = true;
					cache[i] = next;
				}
			}
		} else {
			for (let i = 0; i < uniform.size!; i++) {
				const item = value[i];
				if (
					!item ||
					typeof item === 'number' ||
					(!item.elements && item.x === undefined && item.r === undefined)
				) {
					cache.length = 0;
					return original.call(this, gl, value, textures);
				}

				for (let j = 0; j < width; j++) {
					const next = item.elements
						? item.elements[j]!
						: item.x !== undefined
							? item[axes[j]!]!
							: item[colors[j]!]!;
					const index = i * width + j;
					if (cache[index] !== next) {
						changed = true;
						cache[index] = next;
					}
				}
			}
		}

		if (!changed) return;

		cache.length = length;
		try {
			original.call(this, gl, value, textures);
		} catch (error) {
			cache.length = 0;
			throw error;
		}
	};
}

/** Cache belongs to each program/location, so material switches and in-place edits remain visible. */
export function prepareUniformArrayCache(renderer: WebGLRenderer): void {
	for (const program of (renderer.info.programs ?? []) as unknown as Program[]) {
		if (prepared.has(program) || !program.isReady()) continue;

		const visit = (uniforms: Uniform[]) => {
			for (const uniform of uniforms) {
				if (uniform.seq) visit(uniform.seq);
				else cacheArrayUniform(uniform);
			}
		};

		visit(program.getUniforms().seq);
		prepared.add(program);
	}
}
