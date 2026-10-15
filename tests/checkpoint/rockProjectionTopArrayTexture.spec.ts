import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoColorSpace, Texture, type WebGLRenderer } from 'three';
import {
	assertRockProjectionTopInputs,
	createRockProjectionTopArray,
	packRockProjectionTopPixels,
} from '../../src/materials/layered/rockProjectionTopArrayTexture.js';
import type {
	FurnitureLayered,
	LayeredRole,
} from '../../src/materials/layered/layeredShader.js';

const root = process.env.ROCK_PROJECTION_EDITOR_TEST_ROOT;
afterEach(() => vi.unstubAllGlobals());

describe.skipIf(!root)('RockProjection Top lightweight preview array', () => {
	function fixture() {
		const data = JSON.parse(readFileSync(`${root}/top-array-recovery-v3/original-2d-mips.json`, 'utf8'));

		const config = {
			projection: { editor: { contentSHA256: data.editorContentSHA256 } },
			textures: {},
		} as FurnitureLayered;

		const inputs: Partial<Record<LayeredRole, Texture>> = {};
		const userData: Record<string, unknown> = { textureInputs: {} };
		for (const row of data.rows) {
			const role = row.role as LayeredRole;
			config.textures[role] = row.descriptor
			;
			(userData.textureInputs as Record<string, unknown>)[role] = row.input;

			const texture = new Texture({ width: 256, height: 256 });
			texture.colorSpace = NoColorSpace;
			inputs[role] = texture;
		}

		return { config, inputs, userData };
	}

	function cpuCanvas() {
		const draws = vi.fn();
		const reads = vi.fn(() => ({ data: new Uint8ClampedArray(256 * 256 * 4) }));
		vi.stubGlobal('document', {
			createElement: () => ({
				width: 0,
				height: 0,

				getContext: () => ({ drawImage: draws, getImageData: reads }),
			}),
		});
		return { draws, reads };
	}

	it('keeps three ordered role layers and flips ordinary image rows without touching channel values', () => {
		const layers = [1, 2, 3].map((value) => ({
			width: 1,
			height: 2,
			flipY: false,
			data: new Uint8Array([value, 128, 255, 255, value + 10, 129, 254, 255]),
		}));
		layers[1]!.flipY = true;
		expect(Array.from(packRockProjectionTopPixels(layers))).toEqual([
			1, 128, 255, 255, 11, 129, 254, 255, 12, 129, 254, 255, 2, 128, 255, 255, 3, 128, 255, 255,
			13, 129, 254, 255,
		]);
	});

	it('rejects missing/repeated layers, invalid dimensions/format and swapped descriptors', () => {
		const mutations = [
			(f: ReturnType<typeof fixture>) => {
				delete f.inputs.N2;
			},
			(f: ReturnType<typeof fixture>) => {
				f.inputs.N2 = f.inputs.D2;
			},
			(f: ReturnType<typeof fixture>) => {
				f.config.textures.O2!.slice = 0;
			},
			(f: ReturnType<typeof fixture>) => {
				f.inputs.O2!.image = null;
			},
			(f: ReturnType<typeof fixture>) => {
				f.inputs.O2!.image = { width: '256', height: 256 };
			},
			(f: ReturnType<typeof fixture>) => {
				f.inputs.O2!.image = { width: 128, height: 256 };
			},
			(f: ReturnType<typeof fixture>) => {
				f.inputs.O2!.premultiplyAlpha = true;
			},
		];

		for (const mutate of mutations) {
			const f = fixture();
			mutate(f);
			expect(() => assertRockProjectionTopInputs(f.config, f.inputs, f.userData)).toThrow();
		}

		expect(() => packRockProjectionTopPixels([])).toThrow();
		expect(() => packRockProjectionTopPixels([1, 2, 3].map(() => ({ width: 1, height: 1, flipY: false, data: new Uint8Array(3) })))).toThrow();
	});

	it('uses no pixel hash/content-pin admission in the lightweight preview', () => {
		const f = fixture();
		f.config.projection!.editor!.contentSHA256 = 'different preview content';
		expect(assertRockProjectionTopInputs(f.config, f.inputs, f.userData)).toHaveLength(3);
	});

	it('converts images once, leaves all GL upload/context restoration to Three and never reads GPU pixels', () => {
		const f = fixture();
		const canvas = cpuCanvas();
		const resource = createRockProjectionTopArray(f.config, f.inputs, f.userData);

		const renderer = {
			capabilities: { maxTextures: 16 },

			getContext: () => {
				throw new Error('Custom GL access forbidden');
			},
		} as unknown as WebGLRenderer;

		resource.ensure(renderer);
		for (let draw = 0; draw < 20; draw++) resource.ensure(renderer);

		resource.ensure({ capabilities: { maxTextures: 16 } } as unknown as WebGLRenderer);
		expect(canvas.draws).toHaveBeenCalledTimes(3);
		expect(canvas.reads).toHaveBeenCalledTimes(3);
		expect(resource.stats).toMatchObject({
			initializations: 1,
			imageConversions: 3,
			readbacks: 0,
			readbackBytes: 0,
			allocatedBytes: 786432,
		});
		expect(resource.texture.generateMipmaps).toBe(true);
		expect(resource.texture.mipmaps).toHaveLength(0);
		expect(resource.texture.image.data?.byteLength).toBe(786432);
		resource.dispose();
	});

	it('disposes only its array once on normal or failed initialization, never shared inputs', () => {
		const f = fixture();
		const canvas = cpuCanvas();
		const resource = createRockProjectionTopArray(f.config, f.inputs, f.userData);
		let shared = 0;
		let own = 0;
		Object.values(f.inputs).forEach((texture) => texture.addEventListener('dispose', () => shared++));
		resource.texture.addEventListener('dispose', () => own++);
		canvas.reads.mockImplementation(() => {
			throw new Error('Image unavailable');
		});
		expect(() => resource.ensure({ capabilities: { maxTextures: 16 } } as unknown as WebGLRenderer)).toThrow(/Image unavailable/);
		resource.dispose();
		resource.dispose();
		expect(own).toBe(1);
		expect(shared).toBe(0);
		expect(() => resource.ensure({} as WebGLRenderer)).toThrow(/disposed/);

		const normal = createRockProjectionTopArray(f.config, f.inputs, f.userData);
		normal.dispose();
		normal.dispose();
		expect(shared).toBe(0);
	});
});
