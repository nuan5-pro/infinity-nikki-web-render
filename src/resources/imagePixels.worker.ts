import { decodeOpaqueImages } from './opaquePixels.js';

self.onmessage = async ({ data }) => {
	try {
		const image = await decodeOpaqueImages(data.rgb, data.alpha);
		self.postMessage({ id: data.id, image }, { transfer: [image.data.buffer] });
	} catch (error) {
		self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
	}
};
