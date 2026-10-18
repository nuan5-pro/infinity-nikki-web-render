import type { GeometryGroup, Material } from 'three';

type DrawContext = Parameters<Material['onBeforeRender']>;

type Finalizer = (...context: DrawContext) => void;
// Three passes a geometry group or null at runtime, while its callback types
// currently declare an Object3D Group. Accept both at this preparation boundary.
type PreparationContext = [
	DrawContext[0],
	DrawContext[1],
	DrawContext[2],
	DrawContext[3],
	DrawContext[4],
	DrawContext[5] | GeometryGroup | null,
];

const finalizers = new WeakMap<Material, Finalizer>();
const finalized = new WeakMap<
	Material,
	{ renderer: DrawContext[0]; scene: DrawContext[1]; shadowType: number; shadowsEnabled: boolean }
>();
const dependencies = new WeakMap<Material, readonly Material[]>();
const bindingRevisions = new WeakMap<Material, number>();

export function materialBindingRevision(material: Material) {
	return bindingRevisions.get(material) ?? 0;
}

/** Refresh upload dependencies without invalidating the shader program. */
export function invalidateMaterialBindings(material: Material) {
	bindingRevisions.set(material, materialBindingRevision(material) + 1);
}

export function registerMaterialDependencies(material: Material, values: readonly Material[]) {
	dependencies.set(material, values);
}

export function materialDependencies(material: Material) {
	return dependencies.get(material) ?? [];
}

/** Final shader construction is distinct from binding frame-dependent inputs.
 * Registration borrows the material; disposal never transfers its resources. */
export function registerMaterialFinalizer(material: Material, finalize: Finalizer) {
	finalizers.set(material, finalize);
	finalized.delete(material);
	material.addEventListener('dispose', () => {
		finalizers.delete(material);
		finalized.delete(material);
	});
}

export function materialNeedsFinalization(material: Material, renderer?: DrawContext[0], scene?: DrawContext[1]) {
	if (!finalizers.has(material)) return false;

	const previous = finalized.get(material);
	return (
		!previous ||
		(!!renderer &&
			(previous.renderer !== renderer ||
				previous.scene !== scene ||
				previous.shadowType !== renderer.shadowMap.type ||
				previous.shadowsEnabled !== renderer.shadowMap.enabled))
	);
}

export function finalizeMaterial(material: Material, ...context: PreparationContext) {
	if (!materialNeedsFinalization(material, context[0], context[1])) return;

	const finalize = finalizers.get(material);
	if (finalize) Reflect.apply(finalize, material, context);
	finalized.set(material, {
		renderer: context[0],
		scene: context[1],
		shadowType: context[0].shadowMap.type,
		shadowsEnabled: context[0].shadowMap.enabled,
	});
}
