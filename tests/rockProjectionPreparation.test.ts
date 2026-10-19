import { afterEach, expect, it, vi } from 'vitest';
import {
	BufferGeometry, DataTexture, Float32BufferAttribute, Mesh, MeshStandardMaterial,
	PerspectiveCamera, Scene, Texture, type WebGLRenderer,
} from 'three';
import { createRockProjectionEditorMaterial } from '../src/materials/layered/rockProjectionEditorMaterial.js';
import { ROCK_PROJECTION_TOP_ROLES } from '../src/materials/layered/rockProjectionTopArrayTexture.js';
import { rockProjectionCarrierSHA256 } from '../src/materials/layered/rockProjectionRawBasis.js';
import * as collection from '../src/materials/layered/rockProjectionCollectionTexture.js';
import type { FurnitureLayered, LayeredRole } from '../src/materials/layered/layeredShader.js';
import { finalizeMaterial } from '../src/runtime/materialPreparation.js';
import { makeTextureRecoverable, TextureSource } from '../src/resources/textureSource.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it.each(['bitmap', 'pixels'] as const)('prepares rock top arrays before %s sources retire and reuses them on later draws', kind => {
	class Bitmap {
		width = 1;
		height = 2;
		closed = false;
		constructor(readonly pixels: Uint8Array) {}
		close() { this.closed = true; }
	}
	vi.stubGlobal('ImageBitmap', Bitmap);
	let drawn: Bitmap;
	const drawImage = vi.fn((image: Bitmap) => {
		expect(image).toBeInstanceOf(Bitmap);
		expect(image.closed).toBe(false);
		drawn = image;
	});
	vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
		drawImage, getImageData: () => ({ data: new Uint8ClampedArray(drawn.pixels) }),
	}) }) });
	vi.spyOn(collection, 'createRockProjectionCollectionTexture').mockReturnValue(new Texture() as never);
	const config = {
		textures: Object.fromEntries(['D', 'N', 'O', 'T', 'D1', 'N1', 'O1', 'B', 'C', 'M'].map(role => [role, { constant: [0, 0, 0, 1] }])),
		projection: { editor: {
			version: 1, material: Array.from({ length: 33 }, () => [0, 0, 0, 0]),
			secondaryUV: 'compiled-zero', basis: 'native-vm-snorm8-raw-interpolated',
			viewer: { worldOriginUECm: [0, 0, 0], viewTile: [0, 0], mipBias: 0, minFilter: 'LINEAR_MIPMAP_LINEAR', magFilter: 'LINEAR' },
			collection: { lands: [0, 0, 604800, 0], wetness: 0, payload: {} },
		} },
	} as unknown as FurnitureLayered;
	const inputs: Partial<Record<LayeredRole, Texture>> = {};
	const source = new MeshStandardMaterial();
	source.userData.textureInputs = {};
	const leases = ROCK_PROJECTION_TOP_ROLES.map((role, slice) => {
		config.textures[role] = { key: 'Top Layer Texture Array', slice, srgb: false } as never;
		source.userData.textureInputs[role] = { images: [role], usage: 'data', srgb: false };
		const bytes = new Uint8Array([slice + 1, 2, 3, 4, slice + 11, 12, 13, 14]);
		const texture = kind === 'bitmap' ? new Texture(new Bitmap(bytes) as never) : new DataTexture(bytes, 1, 2);
		texture.flipY = true;
		inputs[role] = makeTextureRecoverable(texture, vi.fn());
		return (texture.source as TextureSource).retain();
	});
	const material = createRockProjectionEditorMaterial(config, inputs, source);
	const renderer = { capabilities: { maxTextures: 16 }, shadowMap: { enabled: true, type: 1 } } as WebGLRenderer;
	const scene = new Scene();
	const camera = new PerspectiveCamera();
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
	geometry.setAttribute('uv', new Float32BufferAttribute([0, 0], 2));
	geometry.setAttribute('ueLayerColor', new Float32BufferAttribute([1, 1, 1, 1], 4));
	const normal = new Float32BufferAttribute([0, 0, 1], 3);
	const tangent = new Float32BufferAttribute([1, 0, 0, 1], 4);
	geometry.setAttribute('_projection_raw_n', normal);
	geometry.setAttribute('_projection_raw_t', tangent);
	geometry.userData.ueProjectionRawBasisProof = {
		contract: 'rock-projection-vm-raw-basis-1', bakeParity: 1, vertices: 1,
		normalSHA256: rockProjectionCarrierSHA256(normal), tangentSHA256: rockProjectionCarrierSHA256(tangent),
	};
	const mesh = new Mesh(geometry, material);
	try {
		finalizeMaterial(material, renderer, scene, camera, geometry, mesh, null);
		const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
		material.onBeforeCompile(shader as never, renderer);
		const array = (shader.uniforms as Record<string, { value: Texture }>).rockProjectionTopArray!.value;
		const expected = ROCK_PROJECTION_TOP_ROLES.flatMap((_, slice) => kind === 'bitmap'
			? [slice + 1, 2, 3, 4, slice + 11, 12, 13, 14]
			: [slice + 11, 12, 13, 14, slice + 1, 2, 3, 4]);
		expect(Array.from(array.image.data)).toEqual(expected);
		leases.forEach(lease => lease.release());
		Object.values(inputs).forEach(texture => expect(texture.image.data).toBeNull());
		for (const enabled of [true, false, true]) {
			renderer.shadowMap.enabled = enabled;
			finalizeMaterial(material, renderer, scene, camera, geometry, mesh, null);
			material.onBeforeRender(renderer, scene, camera, geometry, mesh, null as never);
		}
		expect(Array.from(array.image.data)).toEqual(expected);
		expect(drawImage).toHaveBeenCalledTimes(kind === 'bitmap' ? 3 : 0);
	} finally {
		leases.forEach(lease => lease.release());
		material.dispose();
		source.dispose();
		geometry.dispose();
		Object.values(inputs).forEach(texture => texture.dispose());
	}
});
