import {
	DoubleSide,
	FrontSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	LinearMipmapNearestFilter,
	MeshBasicMaterial,
	MeshPhysicalMaterial,
	MeshStandardMaterial,
	MirroredRepeatWrapping,
	ClampToEdgeWrapping,
	NearestFilter,
	NearestMipmapLinearFilter,
	NearestMipmapNearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	type Material,
	type Texture,
} from 'three';
import type {
	FurnitureMaterialDefinition,
	FurnitureTextureInfo,
	ModelAssetProfile,
} from '../furniture/types.js';
import type { FurnitureResources } from '../resources/resources.js';

export async function createSourceMaterial(
	definition: FurnitureMaterialDefinition,
	resources: FurnitureResources,
	quality: ModelAssetProfile,
): Promise<Material> {
	const extensions = definition.extensions ?? {};

	const supported = [
		'KHR_materials_unlit',
		'KHR_materials_emissive_strength',
		'KHR_materials_clearcoat',
		'KHR_materials_transmission',
		'KHR_materials_ior',
		'KHR_materials_volume',
		'KHR_materials_specular',
		'KHR_materials_sheen',
		'KHR_materials_iridescence',
		'KHR_materials_anisotropy',
		'KHR_materials_dispersion',
	];

	for (const key of Object.keys(extensions))
		if (!supported.includes(key)) throw new Error(`[Furniture] Unsupported material extension ${key}`);

	const unlit = !!extensions.KHR_materials_unlit;
	const physical = Object.keys(extensions).some((key) =>
		[
			'KHR_materials_clearcoat',
			'KHR_materials_transmission',
			'KHR_materials_ior',
			'KHR_materials_volume',
			'KHR_materials_specular',
			'KHR_materials_sheen',
			'KHR_materials_iridescence',
			'KHR_materials_anisotropy',
			'KHR_materials_dispersion',
		].includes(key),
	);
	const material = unlit
		? new MeshBasicMaterial()
		: physical
			? new MeshPhysicalMaterial()
			: new MeshStandardMaterial();
	material.name = definition.name ?? '';
	material.userData = structuredClone(definition.extras ?? {});
	material.side = definition.doubleSided ? DoubleSide : FrontSide;
	material.transparent = definition.alphaMode === 'BLEND';
	material.depthWrite = !material.transparent;
	material.alphaTest = definition.alphaMode === 'MASK' ? (definition.alphaCutoff ?? 0.5) : 0;

	const pbr = definition.pbrMetallicRoughness ?? {};
	const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
	if (factor.length !== 4 || !factor.every(Number.isFinite)) {
		material.dispose();
		throw new Error('[Furniture] Invalid base color factor');
	}

	material.color.setRGB(factor[0]!, factor[1]!, factor[2]!);
	material.opacity = factor[3]!;

	const owned = new Set<Texture>();
	const sampled = new Map<string, Promise<Texture>>();

	const texture = (info: FurnitureTextureInfo | undefined, srgb: boolean): Promise<Texture | null> => {
		if (!info) return Promise.resolve(null);
		if (
			!/^t-[a-f0-9]{16}$/.test(info.resource) ||
			!Number.isInteger(info.texCoord ?? 0) ||
			(info.texCoord ?? 0) < 0 ||
			(info.texCoord ?? 0) > 3
		) return Promise.reject(new Error('[Furniture] Invalid texture resource/UV binding'));

		const key = JSON.stringify([info, srgb]);
		let pending = sampled.get(key);
		if (!pending) {
			pending = resources.image(info.resource, quality).then((source) => {
				const result = source.clone();
				owned.add(result);
				result.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;

				const sampler = info.sampler ?? {};
				if (
					(sampler.magFilter !== undefined && ![9728, 9729].includes(sampler.magFilter)) ||
					(sampler.minFilter !== undefined &&
						![9728, 9729, 9984, 9985, 9986, 9987].includes(sampler.minFilter)) ||
					[sampler.wrapS, sampler.wrapT].some((wrap) => wrap !== undefined && ![33071, 33648, 10497].includes(wrap))
				) throw new Error('[Furniture] Invalid declared texture sampler');

				const filters: Record<number, Texture['minFilter']> = {
					9728: NearestFilter,
					9729: LinearFilter,
					9984: NearestMipmapNearestFilter,
					9985: LinearMipmapNearestFilter,
					9986: NearestMipmapLinearFilter,
					9987: LinearMipmapLinearFilter,
				};

				const wraps = {
					33071: ClampToEdgeWrapping,
					33648: MirroredRepeatWrapping,
					10497: RepeatWrapping,
				};

				result.magFilter = sampler.magFilter === 9728 ? NearestFilter : LinearFilter;
				result.minFilter = filters[sampler.minFilter ?? 9987] ?? LinearMipmapLinearFilter;
				result.wrapS = wraps[sampler.wrapS as keyof typeof wraps] ?? RepeatWrapping;
				result.wrapT = wraps[sampler.wrapT as keyof typeof wraps] ?? RepeatWrapping;
				result.generateMipmaps = result.minFilter !== NearestFilter && result.minFilter !== LinearFilter;
				result.channel = info.texCoord ?? 0;

				const transform = info.extensions?.KHR_texture_transform as
					| { offset?: number[]; scale?: number[]; rotation?: number; texCoord?: number }
					| undefined;
				if (transform) {
					result.channel = transform.texCoord ?? result.channel;
					if (transform.offset) result.offset.fromArray(transform.offset);
					if (transform.scale) result.repeat.fromArray(transform.scale);
					result.rotation = transform.rotation ?? 0;
				}

				result.flipY = false;
				result.needsUpdate = true;
				return result;
			});
			sampled.set(key, pending);
		}

		return pending;
	};

	try {
		if (material instanceof MeshStandardMaterial) {
			const [baseColor, metallicRoughness, normal, occlusion, emissive] = await Promise.all([
				texture(pbr.baseColorTexture, true),
				texture(pbr.metallicRoughnessTexture, false),
				texture(definition.normalTexture, false),
				texture(definition.occlusionTexture, false),
				texture(definition.emissiveTexture, true),
			]);
			material.map = baseColor;
			material.metalness = pbr.metallicFactor ?? 1;
			material.roughness = pbr.roughnessFactor ?? 1;
			material.metalnessMap = material.roughnessMap = metallicRoughness;
			material.normalMap = normal;

			const normalScale = definition.normalTexture?.scale ?? 1;
			material.normalScale.set(normalScale, normalScale);
			material.aoMap = occlusion;
			material.aoMapIntensity = definition.occlusionTexture?.strength ?? 1;
			material.emissiveMap = emissive;
			material.emissive.fromArray(definition.emissiveFactor ?? [0, 0, 0]);
			material.emissiveIntensity =
				(extensions.KHR_materials_emissive_strength as { emissiveStrength?: number } | undefined)
					?.emissiveStrength ?? 1;
		} else material.map = await texture(pbr.baseColorTexture, true);

		if (material instanceof MeshPhysicalMaterial) {
			const extension = (key: string) => extensions[key] as Record<string, any> | undefined;
			const clearcoat = extension('KHR_materials_clearcoat');
			material.clearcoat = clearcoat?.clearcoatFactor ?? 0;
			material.clearcoatRoughness = clearcoat?.clearcoatRoughnessFactor ?? 0;
			material.clearcoatMap = await texture(clearcoat?.clearcoatTexture, false);
			material.clearcoatRoughnessMap = await texture(clearcoat?.clearcoatRoughnessTexture, false);
			material.clearcoatNormalMap = await texture(clearcoat?.clearcoatNormalTexture, false);
			material.clearcoatNormalScale.setScalar(clearcoat?.clearcoatNormalTexture?.scale ?? 1);

			const transmission = extension('KHR_materials_transmission');
			material.transmission = transmission?.transmissionFactor ?? 0;
			material.transmissionMap = await texture(transmission?.transmissionTexture, false);
			material.ior = extension('KHR_materials_ior')?.ior ?? 1.5;

			const volume = extension('KHR_materials_volume');
			material.thickness = volume?.thicknessFactor ?? 0;
			material.thicknessMap = await texture(volume?.thicknessTexture, false);
			material.attenuationDistance = volume?.attenuationDistance ?? Infinity;
			material.attenuationColor.fromArray(volume?.attenuationColor ?? [1, 1, 1]);

			const specular = extension('KHR_materials_specular');
			material.specularIntensity = specular?.specularFactor ?? 1;
			material.specularIntensityMap = await texture(specular?.specularTexture, false);
			material.specularColor.fromArray(specular?.specularColorFactor ?? [1, 1, 1]);
			material.specularColorMap = await texture(specular?.specularColorTexture, true);

			const sheen = extension('KHR_materials_sheen');
			material.sheen = sheen ? 1 : 0;
			material.sheenColor.fromArray(sheen?.sheenColorFactor ?? [0, 0, 0]);
			material.sheenRoughness = sheen?.sheenRoughnessFactor ?? 0;
			material.sheenColorMap = await texture(sheen?.sheenColorTexture, true);
			material.sheenRoughnessMap = await texture(sheen?.sheenRoughnessTexture, false);

			const iridescence = extension('KHR_materials_iridescence');
			material.iridescence = iridescence?.iridescenceFactor ?? 0;
			material.iridescenceIOR = iridescence?.iridescenceIor ?? 1.3;
			material.iridescenceThicknessRange = [
				iridescence?.iridescenceThicknessMinimum ?? 100,
				iridescence?.iridescenceThicknessMaximum ?? 400,
			];
			material.iridescenceMap = await texture(iridescence?.iridescenceTexture, false);
			material.iridescenceThicknessMap = await texture(iridescence?.iridescenceThicknessTexture, false);

			const anisotropy = extension('KHR_materials_anisotropy');
			material.anisotropy = anisotropy?.anisotropyStrength ?? 0;
			material.anisotropyRotation = anisotropy?.anisotropyRotation ?? 0;
			material.anisotropyMap = await texture(anisotropy?.anisotropyTexture, false);
			material.dispersion = extension('KHR_materials_dispersion')?.dispersion ?? 0;
		}

		material.addEventListener('dispose', () => {
			for (const texture of owned) texture.dispose();

			owned.clear();
		});
		return material;
	} catch (error) {
		// Concurrent loads can still create sampler clones after the first failure.
		await Promise.allSettled(sampled.values());
		for (const texture of owned) texture.dispose();

		material.dispose();
		throw error;
	}
}
