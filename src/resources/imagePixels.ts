import { createTaskQueue } from './taskQueue.js';

export interface ImagePixels {
	data: Uint8Array<ArrayBuffer>;
	width: number;
	height: number;
}

/** Native image decoding and canvas readback stay off the render thread. */
export class ImagePixelDecoder {
	private worker?: Worker;
	private sequence = 0;
	private disposed = false;
	private queue = createTaskQueue(2);
	private pending = new Map<number, {
		resolve(value: ImagePixels): void;
		reject(reason: Error): void;
	}>();

	async decode(rgb: Uint8Array, alpha: Uint8Array | undefined, signal: AbortSignal): Promise<ImagePixels> {
		return this.queue(async () => {
			signal.throwIfAborted();
			if (this.disposed) throw new Error('Image decoder disposed');

			if (!this.worker) {
				const worker = new Worker(new URL('./imagePixels.worker.ts', import.meta.url), { type: 'module' });
				worker.onmessage = ({ data }) => {
					const job = this.pending.get(data.id);
					if (!job) return;

					this.pending.delete(data.id);
					if (data.error) job.reject(new Error(data.error));
					else job.resolve(data.image);
				};

				worker.onerror = (event) => {
					for (const job of this.pending.values()) {
						job.reject(new Error(event.message || 'Image decoder worker failed'));
					}

					this.pending.clear();
					worker.terminate();
					this.worker = undefined;
				};

				this.worker = worker;
			}

			// Packed resources share a bundle buffer; transfer only owned copies.
			const colorBytes = rgb.slice().buffer;
			const alphaBytes = alpha?.slice().buffer;
			const id = ++this.sequence;
			const image = await new Promise<ImagePixels>((resolve, reject) => {
				this.pending.set(id, { resolve, reject });

				try {
					this.worker!.postMessage(
						{ id, rgb: colorBytes, alpha: alphaBytes },
						alphaBytes ? [colorBytes, alphaBytes] : [colorBytes],
					);
				} catch (error) {
					this.pending.delete(id);
					reject(error);
				}
			});
			signal.throwIfAborted();

			return image;
		});
	}

	dispose(): void {
		this.disposed = true;
		this.worker?.terminate();
		this.worker = undefined;

		for (const job of this.pending.values()) job.reject(new Error('Image decoder disposed'));

		this.pending.clear();
	}
}
