import { afterEach, expect, it, vi } from 'vitest';
import { DataTexture, Texture, type WebGLRenderer } from 'three';
import { makeTextureRecoverable, TextureSource } from '../src/resources/textureSource.js';
import { createTextureUploads } from '../src/runtime/textureUploads.js';

afterEach(() => vi.unstubAllGlobals());

it('retains shared pixels until the final construction/upload lease, with stable source identity', async () => {
	const decode = vi.fn(async () => new DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1));
	const texture = makeTextureRecoverable(await decode(), decode);
	const source = texture.source as TextureSource;
	const first = source.retain();
	const second = source.retain();
	const clone = texture.clone();
	clone.needsUpdate = true;
	expect(source.version).toBe(1);
	first.release();
	expect(source.data.data).toEqual(new Uint8Array([1, 2, 3, 4]));
	second.release();
	expect(source.data).toEqual({ width: 1, height: 1, data: null });
	const restored = source.retain();
	const shared = source.retain();
	await Promise.all([restored.ready, shared.ready]);
	expect(decode).toHaveBeenCalledTimes(2);
	expect(clone.source).toBe(source);
	expect(source.data.data).toEqual(new Uint8Array([1, 2, 3, 4]));
	restored.release();
	shared.release();
	texture.dispose();
	expect(() => source.retain()).toThrow('disposed');
});

it('closes late decoded bitmaps after cancellation without reviving a retired source', async () => {
	const initial = { width: 2, height: 2, close: vi.fn() };
	const late = { width: 2, height: 2, close: vi.fn() };
	let complete!: (texture: Texture) => void;
	const texture = makeTextureRecoverable(new Texture(initial), () => new Promise(resolve => { complete = resolve; }));
	const source = texture.source as TextureSource;
	source.retain().release();
	expect(initial.close).toHaveBeenCalledOnce();
	const lease = source.retain();
	await Promise.resolve();
	const rejected = expect(lease.ready).rejects.toThrow('cancelled');
	texture.dispose();
	complete(new Texture(late));
	await rejected;
	lease.release();
	expect(late.close).toHaveBeenCalledOnce();
	expect(source.resident).toBe(false);
});

it('retries a failed decode and cancels an unneeded decode before invoking its loader', async () => {
	const decode = vi.fn().mockRejectedValueOnce(new Error('decode failed')).mockResolvedValueOnce(new DataTexture(new Uint8Array(4), 1, 1));
	const texture = makeTextureRecoverable(new DataTexture(new Uint8Array(4), 1, 1), decode);
	const source = texture.source as TextureSource;
	source.retain().release();
	const cancelled = source.retain();
	cancelled.release();
	await expect(cancelled.ready).rejects.toThrow();
	expect(decode).not.toHaveBeenCalled();
	const failed = source.retain();
	await expect(failed.ready).rejects.toThrow('decode failed');
	failed.release();
	const retry = source.retain();
	await retry.ready;
	expect(source.resident).toBe(true);
	retry.release();
	texture.dispose();
});

it('restores shared sampler variants before resuming drawing, then drops the decoded CPU copy', async () => {
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
	vi.stubGlobal('cancelAnimationFrame', clearTimeout);
	const decode = vi.fn(async () => new DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1));
	const texture = makeTextureRecoverable(await decode(), decode);
	texture.needsUpdate = true;
	const clone = texture.clone();
	const live = new Map([[texture, true], [clone, true]]);
	let properties = new WeakMap();
	const render = vi.fn();
	const renderer = {
		render,
		properties: { get(texture: Texture) {
			if (!properties.has(texture)) properties.set(texture, {});
			return properties.get(texture);
		} },
		initTexture: vi.fn((texture: Texture) => {
			expect(texture.image.data).toEqual(new Uint8Array([1, 2, 3, 4]));
			properties.set(texture, { __version: texture.version, __webglTexture: {} });
		}),
	} as unknown as WebGLRenderer;
	const restored = vi.fn(() => { expect(renderer.initTexture).toHaveBeenCalledTimes(3); });
	const uploads = createTextureUploads(renderer, live, vi.fn(), restored);
	expect(uploads.ensure(texture)).toBe(true);
	renderer.initTexture(texture);
	uploads.release();
	expect(texture.image.data).toBeNull();
	expect(uploads.ensure(texture)).toBe(true);
	expect(decode).toHaveBeenCalledOnce();
	uploads.lost();
	properties = new WeakMap();
	const restoring = uploads.restore();
	renderer.render({} as never, {} as never);
	expect(render).not.toHaveBeenCalled();
	await restoring;
	expect(restored).toHaveBeenCalledOnce();
	expect(decode).toHaveBeenCalledTimes(2);
	expect(renderer.initTexture).toHaveBeenCalledTimes(3);
	expect(texture.image.data).toBeNull();
	renderer.render({} as never, {} as never);
	expect(render).toHaveBeenCalledOnce();
	uploads.dispose();
	expect(renderer.render).toBe(render);
	texture.dispose();
});

it.each([true, false])('handles a failed recovery decode with removed=%s samplers', async removed => {
	let reject!: (error: Error) => void;
	const texture = makeTextureRecoverable(new DataTexture(new Uint8Array(4), 1, 1),
		() => new Promise((_, fail) => { reject = fail; }));
	(texture.source as TextureSource).retain().release();
	const render = vi.fn();
	const renderer = { render, initTexture: vi.fn() } as unknown as WebGLRenderer;
	const live = new Map([[texture, true]]);
	const restored = vi.fn();
	const uploads = createTextureUploads(renderer, live, vi.fn(), restored);
	uploads.lost();
	const pending = uploads.restore();
	await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
	if (removed) {
		live.delete(texture);
		texture.dispose();
	}

	const result = removed ? expect(pending).resolves.toBeUndefined() : expect(pending).rejects.toThrow('decode failed');
	reject(new Error('decode failed'));
	await result;
	renderer.render({} as never, {} as never);
	expect(render).toHaveBeenCalledTimes(removed ? 1 : 0);
	expect(restored).toHaveBeenCalledTimes(removed ? 1 : 0);
	expect(renderer.initTexture).not.toHaveBeenCalled();
	uploads.dispose();
	texture.dispose();
});

it('releases an in-flight restoration when the renderer owner is disposed', async () => {
	let complete!: (texture: Texture) => void;
	const texture = makeTextureRecoverable(new DataTexture(new Uint8Array(4), 1, 1),
		() => new Promise(resolve => { complete = resolve; }));
	(texture.source as TextureSource).retain().release();
	const render = vi.fn();
	const renderer = { render, initTexture: vi.fn() } as unknown as WebGLRenderer;
	const restored = vi.fn();
	const uploads = createTextureUploads(renderer, new Map([[texture, true]]), vi.fn(), restored);
	uploads.lost();
	const pending = uploads.restore();
	await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
	uploads.dispose();
	const late = { width: 1, height: 1, close: vi.fn() };
	complete(new Texture(late));
	await pending;
	expect(renderer.initTexture).not.toHaveBeenCalled();
	expect(restored).not.toHaveBeenCalled();
	expect(late.close).toHaveBeenCalledOnce();
	expect(renderer.render).toBe(render);
	texture.dispose();
});
