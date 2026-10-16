import type { ImagePixels } from './imagePixels.js';

async function readOpaque(bytes: ArrayBuffer): Promise<ImagePixels> {
	const image = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), {
		premultiplyAlpha: 'none',
		colorSpaceConversion: 'none',
	});

	try {
		const { width, height } = image;
		if (!width || !height || width * height * 4 > 512 * 1024 * 1024) throw new Error('Split image dimensions exceed decoder limits');

		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
		if (!context) throw new Error('Split image pixel decoder unavailable');

		context.drawImage(image, 0, 0);
		const rgba = context.getImageData(0, 0, width, height).data;
		for (let i = 3; i < rgba.length; i += 4) {
			if (rgba[i] !== 255) throw new Error('Split transport image must be opaque');
		}

		canvas.width = canvas.height = 1;
		return { width, height, data: new Uint8Array(rgba.buffer) };
	} finally {
		image.close();
	}
}

export async function decodeOpaqueImages(rgb: ArrayBuffer, alpha?: ArrayBuffer): Promise<ImagePixels> {
	const image = await readOpaque(rgb);
	if (alpha) {
		const mask = await readOpaque(alpha);
		if (mask.width !== image.width || mask.height !== image.height) throw new Error('Split alpha dimensions differ');

		for (let i = 0; i < image.data.length; i += 4) {
			if (mask.data[i] !== mask.data[i + 1] || mask.data[i] !== mask.data[i + 2]) throw new Error('Split alpha image must be grayscale');

			image.data[i + 3] = mask.data[i]!;
		}
	}

	return image;
}
