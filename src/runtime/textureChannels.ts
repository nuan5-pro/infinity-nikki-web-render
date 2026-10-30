import { RGBAFormat, type Source, type Texture } from 'three';

const channels = new WeakMap<Source<unknown>, { version: number; varying: boolean[] }>();

/** Constant sampled channels cannot animate when only their UV coordinates move. */
export function textureChannelVaries(texture: Texture | null | undefined, channel: 0 | 1 | 2 | 3) {
	if (!texture || texture.format !== RGBAFormat || texture.mipmaps.length) return true;

	const source = texture.source;
	const cached = channels.get(source);
	if (cached?.version === source.version) return cached.varying[channel]!;

	const image = source.data as { data?: ArrayLike<number> | null } | null | undefined;
	let data = image?.data;
	if (!data && typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap && image.width && image.height) {
		const canvas = new OffscreenCanvas(image.width, image.height);
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) return true;

		context.drawImage(image, 0, 0);
		data = context.getImageData(0, 0, image.width, image.height).data;
		canvas.width = canvas.height = 1;
		// Canvas premultiplication can discard RGB under transparency. Only raw
		// RGBA arrays or opaque bitmap readback prove a constant RGB channel.
		for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
	}
	if (!data?.length) return true;

	const varying = [false, false, false, false];
	for (let i = 4; i < data.length; i += 4) {
		for (let c = 0; c < 4; c++) if (data[i + c] !== data[c]) varying[c] = true;
		if (varying.every(Boolean)) break;
	}
	channels.set(source, { version: source.version, varying });
	return varying[channel]!;
}
