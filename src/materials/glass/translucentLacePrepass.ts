import {
	OneFactor,
	OneMinusSrcAlphaFactor,
	ZeroFactor,
	type GeometryGroup,
	type MeshStandardMaterial,
} from 'three';
import { registerMaterialDependencies } from '../../runtime/materialPreparation.js';

function isDrawGroup(value: unknown): value is GeometryGroup {
	if (!value || typeof value !== 'object' || !('start' in value) || !('count' in value)) return false;
	if (
		typeof value.start !== 'number' ||
		!Number.isSafeInteger(value.start) ||
		value.start < 0 ||
		typeof value.count !== 'number' ||
		(value.count !== Infinity && !Number.isSafeInteger(value.count)) ||
		value.count < 0
	) return false;

	return (
		!('materialIndex' in value) ||
		value.materialIndex === undefined ||
		(typeof value.materialIndex === 'number' &&
			Number.isSafeInteger(value.materialIndex) &&
			value.materialIndex >= 0)
	);
}

export function translucentLaceDrawGroup(value: unknown): GeometryGroup {
	// Three sends null for a single-material draw, although its callback type
	// incorrectly says Object3D.Group. The direct draw still clamps this full
	// descriptor to geometry.drawRange and the actual index/vertex buffer length.
	if (value === null || value === undefined) return { start: 0, count: Infinity };
	if (!isDrawGroup(value)) throw new Error('Invalid translucent lace geometry draw group');

	return value;
}

/** Editor approximation: each actual geometry/group draw gets its own paired
 * coverage-depth draw first. Native queue0/queue1 do not prove global ordering.
 */
export function installTranslucentLacePrepass(color: MeshStandardMaterial, depth: MeshStandardMaterial): void {
	const previous = color.onBeforeRender;
	registerMaterialDependencies(color, [depth]);
	color.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
		previous.call(this, renderer, scene, camera, geometry, object, group);

		const attributes = renderer.getContext().getContextAttributes();
		const canvasOpacity = attributes?.alpha === true && renderer.getRenderTarget() === null;
		// UE's target alpha stores remaining background transmittance. A browser
		// canvas with alpha instead needs accumulated opacity. RGB and coverage are
		// identical; only the separate alpha source factor changes from 0 to 1.
		color.blendSrcAlpha = canvasOpacity ? OneFactor : ZeroFactor;
		color.blendDstAlpha = OneMinusSrcAlphaFactor;
		// WebGLRenderer has already computed modelViewMatrix/normalMatrix here.
		// renderBufferDirect does not invoke Material.onBeforeRender recursively.
		renderer.renderBufferDirect(camera, scene, geometry, depth, object, translucentLaceDrawGroup(group));
	};
	color.addEventListener('dispose', () => depth.dispose());
}
