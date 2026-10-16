import {
	ClampToEdgeWrapping,
	LinearFilter,
	LinearMipmapLinearFilter,
	LinearMipmapNearestFilter,
	MirroredRepeatWrapping,
	NearestFilter,
	NearestMipmapNearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	type Texture,
} from 'three';

export const TEXTURE_SLOTS = [
	'D',
	'M',
	'N',
	'O',
	'T',
	'D1',
	'N1',
	'O1',
	'D2',
	'N2',
	'O2',
	'B',
	'S',
	'C',
	'T1',
] as const;

export type TextureSlot = (typeof TEXTURE_SLOTS)[number];

export interface TextureInput {
	images: string[]
	usage:
		| 'data'
		| 'base-color'
		| 'normal'
		| 'mask'
		| 'palette'
		| 'gradient'
		| 'emission'
		| 'matcap'
		| 'color'
		| 'specular'
		| 'reflection'
	srgb: boolean
	mipmaps?: boolean
	nearest?: boolean
	normalEncoding?: 'gltf' | 'gltf-rg' | 'native-rg' | 'native-rgb'
	filter?: 'TF_Default' | 'TF_Nearest' | 'TF_Bilinear' | 'TF_Trilinear'
	addressX?: 'TA_Wrap' | 'TA_Clamp' | 'TA_Mirror'
	addressY?: 'TA_Wrap' | 'TA_Clamp' | 'TA_Mirror'
	sampler?: 'view-world-wrap' | 'texture-asset'
	paperLayer?: 'raw' | 'raw-mod25' | 'raw-div25' | 'hbc-decimal'
}

export function readTextureInputs(userData: Record<string, unknown>): Partial<Record<TextureSlot, TextureInput>> | null {
	const value = userData.textureInputs;
	if (value === undefined) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid material textureInputs dictionary');

	const inputs: Partial<Record<TextureSlot, TextureInput>> = {};
	for (const [role, raw] of Object.entries(value)) {
		if (!TEXTURE_SLOTS.includes(role as TextureSlot) || !raw || typeof raw !== 'object') throw new Error(`Invalid material texture input: ${role}`);

		const input = raw as TextureInput;
		if (
			!Array.isArray(input.images) ||
			input.images.length === 0 ||
			input.images.some((name) => typeof name !== 'string' || !name.trim()) ||
			![
				'data',
				'base-color',
				'normal',
				'mask',
				'palette',
				'gradient',
				'emission',
				'matcap',
				'color',
				'specular',
				'reflection',
			].includes(input.usage)
		) throw new Error(`Invalid material texture input images/usage: ${role}`);
		if (typeof input.srgb !== 'boolean') throw new Error(`Material texture input ${role} requires explicit srgb`);
		if (input.paperLayer !== undefined &&
			!['raw', 'raw-mod25', 'raw-div25', 'hbc-decimal'].includes(input.paperLayer)) throw new Error(`Invalid PaperCustomData layer recipe: ${role}`);
		if ('paperArray' in input) throw new Error(`Obsolete raw paper array; regenerate the furniture manifest: ${role}`);
		if (input.usage === 'normal' && input.normalEncoding === undefined) throw new Error(`Material texture input ${role} requires normalEncoding`);

		for (const key of ['mipmaps', 'nearest'] as const) {
			if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`Invalid material texture input ${role}.${key}`);
		}

		if (
			input.normalEncoding !== undefined &&
			!['gltf', 'gltf-rg', 'native-rg', 'native-rgb'].includes(input.normalEncoding)
		) throw new Error(`Invalid material normal encoding: ${role}`);
		if (
			input.filter !== undefined &&
			!['TF_Default', 'TF_Nearest', 'TF_Bilinear', 'TF_Trilinear'].includes(input.filter)
		) throw new Error(`Invalid native texture filter: ${role}`);
		if (
			input.sampler !== undefined &&
			!['view-world-wrap', 'texture-asset'].includes(input.sampler)
		) throw new Error(`Invalid texture consumer sampler: ${role}`);

		for (const key of ['addressX', 'addressY'] as const) {
			if (input[key] !== undefined && !['TA_Wrap', 'TA_Clamp', 'TA_Mirror'].includes(input[key]!)) throw new Error(`Invalid native texture address: ${role}.${key}`);
		}

		inputs[role as TextureSlot] = input;
	}

	return inputs;
}

/** Compare only inherited sampling/UV state; image identity and color space
 * are supplied by the selected role, not by the standard binding.
 */
export function sameTextureBinding(a: Texture, b: Texture): boolean {
	return (
		a === b ||
		(a.mapping === b.mapping &&
			a.channel === b.channel &&
			a.wrapS === b.wrapS &&
			a.wrapT === b.wrapT &&
			a.magFilter === b.magFilter &&
			a.minFilter === b.minFilter &&
			a.anisotropy === b.anisotropy &&
			a.generateMipmaps === b.generateMipmaps &&
			a.offset.equals(b.offset) &&
			a.repeat.equals(b.repeat) &&
			a.center.equals(b.center) &&
			a.rotation === b.rotation &&
			a.matrixAutoUpdate === b.matrixAutoUpdate &&
			a.matrix.equals(b.matrix))
	);
}

/** A cached image can serve different native consumers. Sampling state belongs
 * to the material-local clone, never the shared decoder/cache texture.
 */
export function cloneTextureInput(texture: Texture, input: TextureInput, binding?: Texture): Texture {
	const clone = texture.clone();
	if (binding) {
		clone.mapping = binding.mapping;
		clone.channel = binding.channel;
		clone.wrapS = binding.wrapS;
		clone.wrapT = binding.wrapT;
		clone.magFilter = binding.magFilter;
		clone.minFilter = binding.minFilter;
		clone.anisotropy = binding.anisotropy;
		clone.offset.copy(binding.offset);
		clone.repeat.copy(binding.repeat);
		clone.center.copy(binding.center);
		clone.rotation = binding.rotation;
		clone.matrixAutoUpdate = binding.matrixAutoUpdate;
		clone.matrix.copy(binding.matrix);
	}
	// Borrow only the selected image; the binding owns its sampler, UV channel
	// and KHR_texture_transform state, including a manually maintained matrix.
	clone.source = texture.source;
	clone.mipmaps = texture.mipmaps.slice();
	clone.flipY = false;

	const palette = input.usage === 'palette';
	const nearest =
		input.filter !== undefined
			? input.filter === 'TF_Nearest'
			: (input.nearest ?? (binding ? binding.magFilter === NearestFilter : palette));
	const mipmaps = input.mipmaps ?? binding?.generateMipmaps ?? !palette;
	clone.colorSpace = input.srgb ? SRGBColorSpace : NoColorSpace;
	if (!binding || input.filter !== undefined || input.nearest !== undefined) {
		clone.magFilter = nearest ? NearestFilter : LinearFilter;
	}

	if (
		!binding ||
		input.filter !== undefined ||
		input.nearest !== undefined ||
		input.mipmaps !== undefined
	) {
		clone.minFilter = mipmaps
			? nearest
				? NearestMipmapNearestFilter
				: input.filter === 'TF_Bilinear'
					? LinearMipmapNearestFilter
					: LinearMipmapLinearFilter
			: nearest
				? NearestFilter
				: LinearFilter;
	}

	const address = (mode: TextureInput['addressX']) => {
		switch (mode) {
		case 'TA_Wrap':
			return RepeatWrapping;
		case 'TA_Clamp':
			return ClampToEdgeWrapping;
		case 'TA_Mirror':
			return MirroredRepeatWrapping;
		default:
			return undefined;
		}
	};

	const wrapDefault = binding && input.sampler === 'view-world-wrap' ? RepeatWrapping : undefined;
	clone.wrapS = address(input.addressX) ?? wrapDefault ?? clone.wrapS;
	clone.wrapT = address(input.addressY) ?? wrapDefault ?? clone.wrapT;
	clone.generateMipmaps = mipmaps;
	if (input.paperLayer) clone.userData.paperLayer = input.paperLayer;
	clone.needsUpdate = true;
	return clone;
}
