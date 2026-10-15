import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepeatWrapping, Texture } from 'three';
import { ImageBitmapSource } from '../../src/resources/imageBitmapSource.js';

class Bitmap {}

afterEach(() => vi.unstubAllGlobals());

describe('immutable asset image revisions', () => {
	it('keeps sampler clones independent without marking identical bitmap pixels dirty', () => {
		vi.stubGlobal('ImageBitmap', Bitmap);

		const texture = new Texture();
		texture.source = new ImageBitmapSource(new Bitmap());
		texture.needsUpdate = true;

		const version = texture.source.version;
		const clone = texture.clone();
		clone.wrapS = RepeatWrapping;
		clone.needsUpdate = true;
		expect(clone.source).toBe(texture.source);
		expect(clone.version).toBeGreaterThan(0);
		expect(clone.source.version).toBe(version);
		expect(texture.wrapS).not.toBe(clone.wrapS);
	});

	it('invalidates a replacement bitmap and allocation/readiness transitions', () => {
		vi.stubGlobal('ImageBitmap', Bitmap);

		const source = new ImageBitmapSource(new Bitmap());
		source.needsUpdate = true;

		const version = source.version;
		source.data = new Bitmap();
		source.needsUpdate = true;
		expect(source.version).toBe(version + 1);
		source.dataReady = false;
		source.needsUpdate = true;
		source.dataReady = true;
		source.needsUpdate = true;
		expect(source.version).toBe(version + 3);
	});

	it('preserves every explicit update when data becomes mutable', () => {
		vi.stubGlobal('ImageBitmap', Bitmap);

		const source = new ImageBitmapSource(new Bitmap());
		source.needsUpdate = true;
		source.data = { data: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1 };
		source.needsUpdate = true;

		const version = source.version;
		source.data.data[0] = 5;
		source.needsUpdate = true;
		expect(source.version).toBe(version + 1);
		source.needsUpdate = false;
		expect(source.version).toBe(version + 1);
	});
});
