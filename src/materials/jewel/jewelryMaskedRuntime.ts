import { DirectionalLight, Vector3, type Camera } from 'three';
import type { MaskedVec3 } from './jewelryMaskedSource.js';

export interface JewelryMaskedDistanceInput {
	/** CB0[109].xyz and [110].xyz; source LWC tile/offset in centimetres. */
	cameraTile: MaskedVec3
	cameraOffsetCM: MaskedVec3
	/** Primitive rows18/19: ObjectWorldPosition, NOT the actor translation. */
	objectBoundsTile: MaskedVec3
	objectBoundsOffsetCM: MaskedVec3
	/** Actual draw viewport width/height, in framebuffer pixels (CB0[136].xy). */
	viewportPixels: readonly [number, number]
	/** Source ClipToView[0][0], independently mapped from the active projection. */
	clipToView00: number
	globalAttributeFactor: number
}

const f = Math.fround;

const finite = (values: readonly number[]) => values.every((value) => Number.isFinite(value) && Number.isFinite(f(value)));

/** PS206–220, with each source float operation rounded separately. */
export function jewelryMaskedDistanceBlend(input: JewelryMaskedDistanceInput): number {
	if (
		![
			input.cameraTile,
			input.cameraOffsetCM,
			input.objectBoundsTile,
			input.objectBoundsOffsetCM,
		].every((values) => values.length === 3 && finite(values)) ||
		!finite(input.viewportPixels) ||
		input.viewportPixels.some((value) => !Number.isInteger(value) || value <= 0) ||
		!finite([input.clipToView00, input.globalAttributeFactor]) ||
		input.clipToView00 <= 0 ||
		input.globalAttributeFactor < 0 ||
		input.globalAttributeFactor > 1
	) throw new Error('[JewelryMasked] unproved/nonfinite source View or ObjectWorldPosition domain');

	const delta = input.cameraTile.map((value, i) =>
		f(
			f(f(value - input.objectBoundsTile[i]!) * 2097152) +
				f(input.cameraOffsetCM[i]! - input.objectBoundsOffsetCM[i]!),
		),
	);
	const squared = f(f(f(delta[0]! * delta[0]!) + f(delta[1]! * delta[1]!)) + f(delta[2]! * delta[2]!));
	const distance = f(Math.sqrt(squared));
	const inverseFactor = f(1 - input.globalAttributeFactor);
	const near = f(f(inverseFactor * -25) + 75);
	const farRange = f(f(inverseFactor * 200) + 300);
	let threshold = f(input.viewportPixels[0] / input.viewportPixels[1]);
	threshold = f(threshold / input.clipToView00);
	threshold = f(threshold * f(0.6));
	threshold = f(threshold * near);

	const result = f(f(distance - threshold) / farRange);
	if (!Number.isFinite(result)) throw new Error('[JewelryMasked] source distance equation overflow');

	return Math.min(1, Math.max(0, result));
}

/** Explicit editor lighting: uses the chosen scene light, never synthesized RGB. */
export function jewelryMaskedEditorLight(light: DirectionalLight, camera: Camera): {
	lightDirectionView: MaskedVec3
	lightLinearColorIntensity: MaskedVec3
} {
	if (
		!(light instanceof DirectionalLight) ||
		!light.visible ||
		!Number.isFinite(light.intensity) ||
		light.intensity < 0 ||
		!camera.matrixWorldInverse.elements.every(Number.isFinite) ||
		camera.matrixWorldInverse.determinant() === 0
	) throw new Error('[JewelryMasked] invalid actual editor light/camera');
	// No scene ownership inference here: the ready provider must verify the light
	// and its target belong to its actual context before calling this conversion.
	const position = light.getWorldPosition(new Vector3());
	const target = light.target.getWorldPosition(new Vector3());
	const direction = position.sub(target);
	if (!direction.toArray().every(Number.isFinite) || direction.lengthSq() === 0) throw new Error('[JewelryMasked] actual DirectionalLight position equals target');

	direction.transformDirection(camera.matrixWorldInverse);

	const color: MaskedVec3 = [
		light.color.r * light.intensity,
		light.color.g * light.intensity,
		light.color.b * light.intensity,
	];

	if (!finite(color) || color.some((value) => value < 0)) throw new Error('[JewelryMasked] invalid actual linear light RGB');

	return { lightDirectionView: direction.toArray() as MaskedVec3, lightLinearColorIntensity: color };
}
