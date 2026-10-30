import { afterEach, expect, it, vi } from 'vitest';
import { DataTexture, RedFormat, Texture } from 'three';
import { textureChannelVaries } from '../src/runtime/textureChannels.js';

afterEach(() => { vi.unstubAllGlobals(); });

it('distinguishes a constant sampled channel from changes in unused channels', () => {
	const texture = new DataTexture(new Uint8Array([255, 20, 40, 0, 255, 80, 90, 255]), 2, 1);
	expect(textureChannelVaries(texture, 0)).toBe(false);
	expect(textureChannelVaries(texture, 1)).toBe(true);
	expect(textureChannelVaries(texture, 3)).toBe(true);
	const clone = texture.clone();
	expect(clone.source).toBe(texture.source);
	expect(textureChannelVaries(clone, 0)).toBe(false);
	clone.dispose();
	texture.dispose();
});

it('refreshes channel evidence after the source pixel revision changes', () => {
	const texture = new DataTexture(new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]), 2, 1);
	expect(textureChannelVaries(texture, 0)).toBe(false);
	texture.image.data[4] = 0;
	texture.needsUpdate = true;
	expect(textureChannelVaries(texture, 0)).toBe(true);
	texture.dispose();
});

it('keeps unknown, retired and unsupported-format sources potentially animated', () => {
	const texture = new Texture();
	expect(textureChannelVaries(texture, 0)).toBe(true);
	expect(textureChannelVaries(undefined, 0)).toBe(true);
	const red = new DataTexture(new Uint8Array([255, 255]), 2, 1, RedFormat);
	expect(textureChannelVaries(red, 0)).toBe(true);
	const mipmapped = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
	mipmapped.mipmaps = [{ data: new Uint8Array([0, 0, 0, 255]), width: 1, height: 1 }];
	expect(textureChannelVaries(mipmapped, 0)).toBe(true);
	texture.dispose();
	red.dispose();
	mipmapped.dispose();
});

it('does not infer constant RGB from a transparent bitmap canvas readback', () => {
	class Bitmap { width = 2; height = 1; }
	let data = new Uint8ClampedArray([255, 0, 0, 8, 255, 0, 0, 218]);
	vi.stubGlobal('ImageBitmap', Bitmap);
	vi.stubGlobal('OffscreenCanvas', class {
		width = 2;
		height = 1;
		getContext() { return { drawImage() {}, getImageData: () => ({ data }) }; }
	});
	const transparent = new Texture(new Bitmap() as unknown as ImageBitmap);
	expect(textureChannelVaries(transparent, 0)).toBe(true);
	data = new Uint8ClampedArray([255, 0, 0, 255, 255, 1, 1, 255]);
	const opaque = new Texture(new Bitmap() as unknown as ImageBitmap);
	expect(textureChannelVaries(opaque, 0)).toBe(false);
	expect(textureChannelVaries(opaque, 1)).toBe(true);
	transparent.dispose();
	opaque.dispose();
});
