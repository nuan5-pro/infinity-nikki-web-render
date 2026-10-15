import { type Material, type Texture } from 'three';
import { readWaterFX, waterFxActiveInputs, waterFxTextureKeys, type WaterFX } from './waterFx.js';
import {
	assertWaterFxResource,
	createWaterFxTexture,
	loadWaterFxTextures,
	type WaterFxNativeResource,
} from './waterFxResources.js';
import { createLightweightWaterFxMaterial, type WaterFxMaterialOptions } from './waterFxMaterial.js';
import type { FurnitureResourceReader } from '../../resources/resources.js';

interface WaterFxResources {
	bindings: Record<string, Texture>
	dispose(): void
}

interface Context {
	reader: FurnitureResourceReader
	disposed: boolean
	resources?: WaterFxResources
	loading?: Promise<WaterFxResources>
}

const contexts = new WeakMap<WaterFX, Context>();
const owners = new WeakMap<FurnitureResourceReader, Set<Context>>();

export function assertWaterFxMaterialAdmission(material: Material): void {
	if (material.userData.waterFx && !readWaterFX(material.userData.waterFx)) throw new Error('X6FX invalid native material contract');
}

export function bindWaterFxResources(material: Material, reader: FurnitureResourceReader): void {
	if (!material.userData.waterFx) return;

	const config = readWaterFX(material.userData.waterFx);
	if (!config || config.transport !== 'x6fx-native-resource-views-v1' || !config.resources?.length) throw new Error('X6FX native typed resource contract required');

	for (const key of waterFxTextureKeys) {
		const matches = config.resources.filter((resource) => resource.sourcePath === config.textures[key]);
		if (
			matches.length !== 1 ||
			matches[0]!.type !== (key === 'Cubemap' ? 'TextureCube' : 'Texture2D')
		) throw new Error(`X6FX missing native resource ${key}`);
	}

	for (const resource of config.resources) assertWaterFxResource(resource);

	const context: Context = { reader, disposed: false };
	contexts.set(config, context);

	let owned = owners.get(reader);
	if (!owned) {
		owned = new Set();
		owners.set(reader, owned);
	}

	owned.add(context);
}

export function disposeWaterFxResources(reader: FurnitureResourceReader): void {
	for (const context of owners.get(reader) ?? []) {
		context.disposed = true;
		context.resources?.dispose();
		context.resources = undefined;
	}

	owners.delete(reader);
}

function textureKey(resource: WaterFxNativeResource): string {
	return `water-native:${JSON.stringify([
		resource.type,
		resource.pixelFormat,
		resource.sRGB,
		resource.width,
		resource.height,
		resource.slices,
		resource.filter,
		resource.addressX,
		resource.addressY,
		resource.mipChain,
	])}`;
}

export async function createWaterFxResourceMaterial(source: Material, options: WaterFxMaterialOptions): Promise<Material> {
	const config = readWaterFX(source.userData.waterFx);
	const context = config ? contexts.get(config) : undefined;
	if (!config || !context || context.disposed || !config.resources) throw new Error('X6FX native resource context missing');

	const read = context.reader.read.bind(context.reader);
	const resources = await (context.loading ??= loadWaterFxTextures(
		config,
		config.resources,
		read,
		waterFxActiveInputs(config, options.lighting === 'editor-standard-preview').textures,
		(resource) => context.reader.texture(textureKey(resource), () => createWaterFxTexture(resource, read)),
	)
		.then((loaded) => {
			if (context.disposed) {
				loaded.dispose();
				throw new Error('X6FX owner disposed during native resource loading');
			}

			context.resources = loaded;
			return loaded;
		})
		.catch((error) => {
			context.loading = undefined;
			throw error;
		}));
	if (context.disposed) throw new Error('X6FX resource owner disposed before material creation');

	const bindings: Record<string, Texture> = {};
	try {
		for (const [key, texture] of Object.entries(resources.bindings)) bindings[key] = texture.clone();

		const material = createLightweightWaterFxMaterial(config, bindings, options, source);
		let disposed = false;
		material.addEventListener('dispose', () => {
			if (disposed) return;

			disposed = true;
			for (const texture of new Set(Object.values(bindings))) texture.dispose();
		});
		return material;
	} catch (error) {
		for (const texture of new Set(Object.values(bindings))) texture.dispose();

		throw error;
	}
}
