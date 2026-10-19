import type { Texture, WebGLRenderer } from 'three';
import { TextureSource, type TexturePixels } from '../resources/textureSource.js';
import { createTaskQueue } from '../resources/taskQueue.js';

/** Pins CPU sources across preparation and restores uploaded samplers after context loss. */
export function createTextureUploads(
	renderer: WebGLRenderer,
	textures: ReadonlyMap<Texture, unknown>,
	invalidate: () => void,
	onRestored?: () => void | Promise<void>,
) {
	const pixels = new Map<TextureSource, { lease: TexturePixels; error?: unknown }>();
	let recovery = new AbortController();
	let blocked = false;
	let disposed = false;
	const render = renderer.render;
	const draw: WebGLRenderer['render'] = function (this: WebGLRenderer, ...args) {
		if (!blocked) render.apply(this, args);
	};
	renderer.render = draw;

	function release() {
		for (const { lease } of pixels.values()) lease.release();
		pixels.clear();
	}

	function ensure(texture: Texture) {
		const source = texture.source;
		if (!(source instanceof TextureSource)) return true;

		const properties = renderer.properties.get(texture) as { __webglTexture?: WebGLTexture; __version?: number };
		if (properties.__webglTexture && properties.__version === texture.version) return true;

		let entry = pixels.get(source);
		if (!entry) {
			entry = { lease: source.retain() };
			pixels.set(source, entry);
			const current = entry;
			const notify = () => { if (!disposed && pixels.get(source) === current) invalidate(); };
			void entry.lease.ready.then(notify, error => {
				current.error = error;
				notify();
			});
		}
		if (entry.error) throw entry.error;
		return source.resident;
	}

	function frame(signal: AbortSignal) {
		return new Promise<void>(resolve => {
			const cancel = () => {
				cancelAnimationFrame(id);
				signal.removeEventListener('abort', cancel);
				resolve();
			};
			const id = requestAnimationFrame(() => {
				signal.removeEventListener('abort', cancel);
				resolve();
			});
			signal.addEventListener('abort', cancel, { once: true });
			if (signal.aborted) cancel();
		});
	}

	return {
		ensure,
		release,
		lost() {
			blocked = true;
			recovery.abort();
			release();
		},
		async restore() {
			recovery.abort();
			recovery = new AbortController();
			const { signal } = recovery;
			blocked = true;
			const groups = new Map<TextureSource, Texture[]>();
			for (const texture of textures.keys()) {
				if (!(texture.source instanceof TextureSource)) continue;
				const group = groups.get(texture.source) ?? [];
				group.push(texture);
				groups.set(texture.source, group);
			}
			const queue = createTaskQueue(4);
			const results = await Promise.allSettled([...groups].map(([source, group]) => queue(async () => {
				signal.throwIfAborted();
				if (!group.some(texture => textures.has(texture))) return;

				const lease = source.retain();
				const abort = () => lease.release();
				signal.addEventListener('abort', abort, { once: true });
				try {
					await lease.ready;
					signal.throwIfAborted();
					for (const texture of group) {
						// A material can be disposed while decoding another source in this group.
						if (!textures.has(texture)) continue;
						renderer.initTexture(texture);
					}
					await frame(signal);
				} catch (error) {
					if (group.some(texture => textures.has(texture))) throw error;
				} finally {
					signal.removeEventListener('abort', abort);
					lease.release();
				}
			})));
			if (disposed || signal.aborted) return;
			const failure = results.find(result => result.status === 'rejected');
			if (failure?.status === 'rejected') throw failure.reason;
			blocked = false;
			await onRestored?.();
			if (disposed || signal.aborted) return;
			invalidate();
		},
		dispose() {
			disposed = true;
			recovery.abort();
			release();
			if (renderer.render === draw) renderer.render = render;
		},
	};
}
