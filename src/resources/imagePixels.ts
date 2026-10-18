import { WorkerPool } from './workerPool.js';

export interface ImagePixels {
	data: Uint8Array<ArrayBuffer>;
	width: number;
	height: number;
}

/** Native image decoding and canvas readback stay off the render thread. */
export class ImagePixelDecoder {
	private workers = new WorkerPool<{ rgb: ArrayBuffer; alpha?: ArrayBuffer }, ImagePixels>(
		() => new Worker(new URL('./imagePixels.worker.ts', import.meta.url), { type: 'module' }),
		4,
	);

	async decode(rgb: Uint8Array, alpha: Uint8Array | undefined, signal: AbortSignal): Promise<ImagePixels> {
		return this.workers.run(() => {
			// Packed resources share a bundle buffer; transfer only owned copies.
			const colorBytes = rgb.slice().buffer;
			const alphaBytes = alpha?.slice().buffer;
			return {
				input: { rgb: colorBytes, alpha: alphaBytes },
				transfer: alphaBytes ? [colorBytes, alphaBytes] : [colorBytes],
			};
		}, signal);
	}

	dispose(): void {
		this.workers.dispose();
	}
}
