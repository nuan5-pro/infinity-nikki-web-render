import type { FurnitureRawReference } from '../../furniture/types.js';
import type { FurnitureResourceReader } from '../../resources/resources.js';

export interface NNClothMipPayload {
	sha256?: string
	data: Uint8Array
}

export function readNNClothMipBytes(payload: NNClothMipPayload) {
	if (!(payload.data instanceof Uint8Array)) throw new Error('[NNCloth] Native payload requires typed Uint8Array');

	return payload.data;
}

export type NNClothResourceReference = FurnitureRawReference;

export type NNClothResourceReader = FurnitureResourceReader;

export async function readNNClothResource(resources: FurnitureResourceReader, reference: FurnitureRawReference) {
	if (
		!reference ||
		!/^r-[a-f0-9]{16}$/.test(reference.resource) ||
		!Number.isSafeInteger(reference.byteOffset) ||
		!Number.isSafeInteger(reference.byteLength) ||
		reference.byteOffset < 0 ||
		reference.byteLength < 1 ||
		reference.byteLength > 64 * 1024 * 1024
	) throw new Error('[NNCloth] Invalid native resource reference');

	const data = await resources.read(reference);
	if (!(data instanceof Uint8Array) || data.byteLength !== reference.byteLength) throw new Error('[NNCloth] Native resource range length changed');

	return data;
}

export async function nativePayloadSHA256(data: Uint8Array): Promise<string> {
	const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
