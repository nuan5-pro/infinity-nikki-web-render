import { Source, type Texture } from 'three';

type Image = { width: number; height: number; depth?: number; data?: ArrayBufferView | null; close?: () => void };

export interface TexturePixels {
	ready: Promise<void>;
	release(): void;
}

/** Immutable pixels can retire independently of their source identity and GPU samplers. */
export class TextureSource extends Source<Image> {
	private load: (signal: AbortSignal) => Promise<Texture>;
	private refs = 0;
	private pending?: { controller: AbortController; ready: Promise<void> };
	private disposed = false;
	resident = true;

	constructor(image: Image, load: (signal: AbortSignal) => Promise<Texture>) {
		super(image);
		this.load = load;
		this.version = 1;
	}

	// Sampler cloning changes Texture.version; the immutable source content stays the same.
	override set needsUpdate(_value: boolean) {}

	retain(): TexturePixels {
		if (this.disposed) throw new Error('Texture source disposed');

		this.refs++;
		if (!this.resident && !this.pending) {
			const controller = new AbortController();
			const ready = Promise.resolve().then(() => {
				controller.signal.throwIfAborted();
				return this.load(controller.signal);
			}).then(texture => {
				const image = texture.source.data as Image;
				texture.dispose();
				if (this.disposed || controller.signal.aborted) {
					image.close?.();
					throw new Error('Texture pixels cancelled');
				}
				this.data = image;
				this.resident = true;
			}).finally(() => {
				if (this.pending?.controller === controller) this.pending = undefined;
			});
			this.pending = { controller, ready };
		}

		let released = false;
		return {
			ready: this.pending?.ready ?? Promise.resolve(),
			release: () => {
				if (released) return;

				released = true;
				if (--this.refs === 0) this.evict();
			},
		};
	}

	private evict() {
		this.pending?.controller.abort();
		this.pending = undefined;
		if (!this.resident) return;

		const { width, height, depth } = this.data;
		this.data.close?.();
		this.data = { width, height, ...(depth === undefined ? {} : { depth }), data: null };
		this.resident = false;
	}

	dispose() {
		this.disposed = true;
		this.evict();
	}
}

export function makeTextureRecoverable(texture: Texture, load: (signal: AbortSignal) => Promise<Texture>) {
	if (!texture.source.data) return texture;

	const source = new TextureSource(texture.source.data as Image, load);
	texture.source = source;
	texture.addEventListener('dispose', () => source.dispose());
	return texture;
}
