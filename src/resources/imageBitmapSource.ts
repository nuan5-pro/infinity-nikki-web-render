import { Source } from 'three';

/** Asset bitmaps are immutable. Sampler clones share the pixel revision;
 * replacing the bitmap or falling back to mutable data still invalidates it. */
export class ImageBitmapSource<TData = ImageBitmap> extends Source<TData> {
	private bitmap: ImageBitmap | undefined;
	private ready: boolean | undefined;

	override set needsUpdate(value: boolean) {
		if (!value) return;

		const bitmap = typeof ImageBitmap !== 'undefined' && this.data instanceof ImageBitmap ? this.data : undefined;
		if (!bitmap || bitmap !== this.bitmap || this.dataReady !== this.ready) {
			super.needsUpdate = true;
			this.bitmap = bitmap;
			this.ready = this.dataReady;
		}
	}
}
