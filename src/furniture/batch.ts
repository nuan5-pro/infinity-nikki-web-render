import { Box3, Color, DynamicDrawUsage, InstancedMesh, Matrix4, Mesh, MeshDepthMaterial, MeshDistanceMaterial, Sphere, type Intersection, type Material, type MeshStandardMaterial } from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import type { LoadedFurniture } from './assetStore.js';
import { CustomDataBuffer, type PaperCustomData } from './customData.js';
import { bindPaperMaterial } from './paperMaterial.js';
import { MAX_RENDER_INSTANCES } from '../helpers/instanceCapacity.js';

const matrix = new Matrix4();
const bounds = new Box3();

/** Mutable storage belongs to one layer; source geometry/materials belong to its asset store. */
export class FurnitureBatch {
	mesh: InstancedMesh;
	data: CustomDataBuffer;
	readonly ids: string[] = [];
	private dirty = new Set<number>();
	private box = new Box3();
	private shadows: Material[] = [];
	readonly asset: LoadedFurniture;
	private maxTextureSize: number;

	constructor(asset: LoadedFurniture, capacity: number, maxTextureSize: number) {
		this.asset = asset;
		this.maxTextureSize = maxTextureSize;
		if (!asset.data.geometry.boundsTree)
			asset.data.geometry.boundsTree = new MeshBVH(asset.data.geometry, { indirect: true });

		this.data = new CustomDataBuffer(asset.config.customData, capacity, maxTextureSize);
		this.mesh = this.createMesh(capacity);
	}

	private createMesh(capacity: number): InstancedMesh {
		const mesh = new InstancedMesh(this.asset.data.geometry, this.asset.data.mergedMaterial, capacity);
		mesh.name = `furniture:${this.asset.config.id}`;
		mesh.count = this.ids.length;
		mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		mesh.setColorAt(0, new Color(1, 1, 1));
		mesh.instanceColor!.array.fill(1);
		mesh.instanceColor!.setUsage(DynamicDrawUsage);
		mesh.matrixAutoUpdate = false;
		mesh.castShadow = mesh.receiveShadow = true;
		mesh.boundingBox = this.box;
		mesh.boundingSphere = new Sphere();

		const proxy = new Mesh(mesh.geometry, mesh.material);
		const local = new Matrix4();
		const worldSphere = new Sphere();
		const hits: Intersection[] = [];
		mesh.raycast = (raycaster, intersections) => {
			this.flush();
			worldSphere.copy(mesh.boundingSphere!).applyMatrix4(mesh.matrixWorld);
			if (!raycaster.ray.intersectsSphere(worldSphere)) return;

			for (let slot = 0; slot < mesh.count; slot++) {
				mesh.getMatrixAt(slot, local);
				proxy.matrixWorld.multiplyMatrices(mesh.matrixWorld, local);
				acceleratedRaycast.call(proxy, raycaster, hits);
				for (const hit of hits) intersections.push({ ...hit, instanceId: slot, object: mesh });

				hits.length = 0;
			}
		};

		const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		for (const material of new Set(materials)) bindPaperMaterial(material, this.data);
		// Three normally reuses a renderer-global depth material. Its shader recipe
		// cannot carry per-source HBC parameters or another batch's custom-data owner.
		mesh.customDepthMaterial = new MeshDepthMaterial();
		mesh.customDistanceMaterial = new MeshDistanceMaterial();
		mesh.customDepthMaterial.userData.nuanShadowRecipe = true;
		mesh.customDistanceMaterial.userData.nuanShadowRecipe = true;
		this.shadows.push(mesh.customDepthMaterial, mesh.customDistanceMaterial);

		const shadowUniforms = {
			nuanCustomData: { value: this.data.texture },
			nuanCustomDataStride: { value: this.data.stride },
		};
		const recipes = new Map<Material, Map<boolean, Material>>();
		mesh.onBeforeShadow = (_renderer, _object, _camera, _shadowCamera, _geometry, depth, group) => {
			const source: Material | undefined = materials[(group as unknown as { materialIndex?: number })?.materialIndex ?? 0];
			if (!source) return;

			let variants = recipes.get(source);
			if (!variants) {
				variants = new Map();
				recipes.set(source, variants);
			}

			const distance = depth === mesh.customDistanceMaterial;
			let recipe = variants.get(distance);
			if (!recipe) {
				const target = distance ? new MeshDistanceMaterial() : new MeshDepthMaterial();
				target.userData = source.userData;
				target.map = (source as MeshStandardMaterial).map;
				target.alphaMap = (source as MeshStandardMaterial).alphaMap;
				bindPaperMaterial(target, this.data);
				const compile = target.onBeforeCompile;
				target.onBeforeCompile = function (shader, renderer) {
					compile.call(this, shader, renderer);
					// Three keeps one uniform dictionary per depth material, not per
					// cached group program. Plain variants must retain Paper bindings
					// for a subsequent group that reuses an already compiled shader.
					Object.assign(shader.uniforms, shadowUniforms);
				};
				recipe = target;
				variants.set(distance, recipe);
				this.shadows.push(recipe);
			}

			if (depth.onBeforeCompile !== recipe.onBeforeCompile) {
				depth.onBeforeCompile = recipe.onBeforeCompile;
				depth.customProgramCacheKey = recipe.customProgramCacheKey;
				depth.needsUpdate = true;
			}
		};
		return mesh;
	}

	reserve(count: number): void {
		if (count <= this.data.capacity) return;
		if (count > MAX_RENDER_INSTANCES) throw new RangeError('Furniture instance budget exceeded');

		const capacity = Math.min(MAX_RENDER_INSTANCES, Math.max(count + 16, Math.ceil(this.data.capacity * 1.5)));
		const oldMesh = this.mesh;
		const oldData = this.data;
		for (const material of this.shadows) material.dispose();

		this.shadows.length = 0;
		this.data = new CustomDataBuffer(this.asset.config.customData, capacity, this.maxTextureSize);
		oldData.copyTo(this.data, this.ids.length);
		this.mesh = this.createMesh(capacity);
		this.mesh.instanceMatrix.array.set(oldMesh.instanceMatrix.array);
		this.mesh.instanceColor!.array.set(oldMesh.instanceColor!.array);
		this.mesh.instanceColor!.needsUpdate = true;
		this.mesh.instanceMatrix.needsUpdate = true;
		this.mesh.boundingSphere!.copy(oldMesh.boundingSphere!);
		oldMesh.parent?.add(this.mesh);
		oldMesh.removeFromParent();
		oldMesh.dispose();
		oldData.dispose();
	}

	setMatrix(slot: number, value: Matrix4): void {
		this.mesh.setMatrixAt(slot, value);
		this.dirty.add(slot);
		bounds.copy(this.asset.data.boundingBox).applyMatrix4(value);
		this.box.union(bounds);
	}

	add(id: string, value: Matrix4, dyes?: PaperCustomData): number {
		this.reserve(this.ids.length + 1);

		const slot = this.ids.length;
		this.ids.push(id);
		this.mesh.count = this.ids.length;
		this.setMatrix(slot, value);
		this.data.set(slot, dyes);
		return slot;
	}

	remove(slot: number): string | undefined {
		const last = this.ids.length - 1;
		const moved = slot === last ? undefined : this.ids[last];
		if (moved !== undefined) {
			this.ids[slot] = moved;
			this.mesh.getMatrixAt(last, matrix);
			this.setMatrix(slot, matrix);
			this.data.copySlot(last, slot);

			const color = new Color();
			this.mesh.getColorAt(last, color);
			this.mesh.setColorAt(slot, color);
			this.mesh.instanceColor!.addUpdateRange(slot * 3, 3);
			this.mesh.instanceColor!.needsUpdate = true;
		}

		this.ids.pop();
		this.mesh.count = this.ids.length;
		return moved;
	}

	flush(): void {
		if (this.dirty.size) {
			const slots = [...this.dirty].sort((a, b) => a - b);
			let first = slots[0]!;
			let last = first;
			for (let i = 1; i <= slots.length; i++) {
				if (slots[i] === last + 1) {
					last = slots[i]!;
					continue;
				}

				this.mesh.instanceMatrix.addUpdateRange(first * 16, (last - first + 1) * 16);
				first = last = slots[i]!;
			}

			this.mesh.instanceMatrix.needsUpdate = true;
			this.box.getBoundingSphere(this.mesh.boundingSphere!);
			this.dirty.clear();
		}

		this.data.flush();
	}

	dispose(): void {
		this.mesh.removeFromParent();
		this.mesh.dispose();
		this.data.dispose();
		for (const material of this.shadows) material.dispose();

		this.shadows.length = 0;
		this.ids.length = 0;
		this.dirty.clear();
	}
}
