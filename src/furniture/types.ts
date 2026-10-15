export type ModelAssetProfile = 'lite' | 'full';

export interface FurnitureAsset {
	path: string;
	bytes: number;
}

export interface FurniturePackedResource {
	bundle: string;
	byteOffset: number;
	bytes: number;
	sha256: string;
}

export interface FurnitureTextureResource {
	mimeType: 'image/webp' | 'image/png' | 'image/jpeg';
	full: FurniturePackedResource;
	lite: FurniturePackedResource;
}

export interface FurnitureRawReference {
	resource: string;
	byteOffset: number;
	byteLength: number;
}

export interface FurnitureTextureInfo {
	resource: string;
	texCoord?: number;
	scale?: number;
	strength?: number;
	sampler?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number };
	extensions?: Record<string, unknown>;
}

export interface FurnitureMaterialDefinition {
	name?: string;
	extras?: Record<string, unknown>;
	pbrMetallicRoughness?: {
		baseColorFactor?: number[];
		metallicFactor?: number;
		roughnessFactor?: number;
		baseColorTexture?: FurnitureTextureInfo;
		metallicRoughnessTexture?: FurnitureTextureInfo;
	};
	normalTexture?: FurnitureTextureInfo;
	occlusionTexture?: FurnitureTextureInfo;
	emissiveTexture?: FurnitureTextureInfo;
	emissiveFactor?: number[];
	alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
	alphaCutoff?: number;
	doubleSided?: boolean;
	extensions?: Record<string, unknown>;
}

export interface FurnitureAssetSelection {
	model: ModelAssetProfile;
	material: ModelAssetProfile;
}

/** Area → scheme → [original source component, raw PaperCustomData]. */
export type PaperColorings = Record<string, Record<string, Array<[number, number]>>>;

export interface FurnitureMeshConfig {
	sourceIndex: number;
	rotation: { x: number; y: number; z: number; w: number };
	trans: { x: number; y: number; z: number };
	scale: { x: number; y: number; z: number };
	models: { full: FurnitureAsset; lite?: FurnitureAsset };
	slots: string[];
}

export interface FurnitureModelConfig {
	id: number;
	componentCount: number;
	customData: number[];
	colorings: PaperColorings;
	meshes: FurnitureMeshConfig[];
	root_offset: { x: number; y: number; z: number };
	assembled?: boolean;
	lightPreview?: 'home-object-light-off';
	prepared?: Partial<Record<`${ModelAssetProfile}:${ModelAssetProfile}`, FurnitureAsset>>;
}

export interface FurnitureDB {
	schemaVersion: 4;
	defaults: {
		mesh: { rotation: number[]; scale: number[]; trans: number[] };
		furniture: { root_offset: number[]; assembled: boolean };
	};
	materials: Record<string, FurnitureMaterialDefinition>;
	textures: Record<string, FurnitureTextureResource>;
	rawResources: Record<string, FurniturePackedResource>;
	bundles: Record<string, number>;
	furniture: Array<{
		id: number;
		componentCount: number;
		customData: number[];
		colorings: PaperColorings;
		meshes: Array<{
			sourceIndex: number;
			models: FurnitureMeshConfig['models'];
			slots: string[];
			rotation?: number[];
			scale?: number[];
			trans?: number[];
		}>;
		root_offset?: number[];
		assembled?: boolean;
		lightPreview?: FurnitureModelConfig['lightPreview'];
		prepared?: FurnitureModelConfig['prepared'];
	}>;
}
