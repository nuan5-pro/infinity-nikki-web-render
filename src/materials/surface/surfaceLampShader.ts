/** Independently captured ordinary/Lightmass consumer; not HBC admission. */
export interface FurnitureSurfaceLamp {
	useDESLamp: number
	lightID: number
	environment?: SurfaceLampEnvironment
}

export interface SurfaceLampEnvironment {
	kind: 'captured-mpc-asset-defaults'
	sourceAsset?: string
	sourceSha256?: string
	stateID?: string
	slots: { index: number; name: string; value: number }[]
}

/** MPC_TOD scalar slots 52,53,54,55,56,64: UrbanLightState_0,1001..1005. */
export type SurfaceLampStates = readonly [number, number, number, number, number, number];

export function readFurnitureSurfaceLamp(value: unknown): FurnitureSurfaceLamp | null {
	if (!value || typeof value !== 'object') return null;

	const lamp = value as Record<string, unknown>;
	for (const key of ['useDESLamp', 'lightID']) {
		if (
			typeof lamp[key] !== 'number' ||
			!Number.isFinite(lamp[key]) ||
			!Number.isFinite(Math.fround(lamp[key]))
		) return null;
	}

	return value as FurnitureSurfaceLamp;
}

/** The same pinned native collection capture as the producer; never live scene. */
export function readFurnitureSurfaceLampPreview(value: unknown): FurnitureSurfaceLamp | null {
	const lamp = readFurnitureSurfaceLamp(value);
	if (!lamp || !lamp.environment || typeof lamp.environment !== 'object') return null;

	const env = lamp.environment;
	if (
		env.kind !== 'captured-mpc-asset-defaults' ||
		!Array.isArray(env.slots) ||
		env.slots.length !== 6
	) return null;

	const indices = [52, 53, 54, 55, 56, 64];

	const names = [
		'UrbanLightState_0',
		'UrbanLightState_1001',
		'UrbanLightState_1002',
		'UrbanLightState_1003',
		'UrbanLightState_1004',
		'UrbanLightState_1005',
	];

	if (
		!env.slots.every(
			(slot, i) =>
				slot &&
				typeof slot === 'object' &&
				slot.index === indices[i] &&
				slot.name === names[i] &&
				slot.value === -1,
		)
	) return null;

	return lamp;
}

export function surfaceLampPreviewMembership(lamp: FurnitureSurfaceLamp): number | null {
	const preview = readFurnitureSurfaceLampPreview(lamp);
	if (!preview?.environment) return null;

	return surfaceLampMembership(
		preview,
		preview.environment.slots.map((slot) => slot.value) as [
			number,
			number,
			number,
			number,
			number,
			number,
		],
	);
}

/** No implicit source-default or live-scene environment is selected here. */
export function surfaceLampMembership(lamp: FurnitureSurfaceLamp, states: SurfaceLampStates | null): number | null {
	if (
		!readFurnitureSurfaceLamp(lamp) ||
		!states ||
		states.length !== 6 ||
		!states.every((state) => Number.isFinite(state) && Number.isFinite(Math.fround(state)))
	) return null;

	const id = Math.trunc(Math.fround(lamp.lightID));
	return states.some((state) => id === Math.fround(state)) ? 1 : 0;
}

/** Matches native two mad instructions, before ORM.A/base/contrast/toggle. */
export const SURFACE_LAMP_GLSL = `
vec3 furnitureDESLamp(vec3 emission, float useDESLamp, float membership) {
  return emission + useDESLamp * (emission * membership - emission);
}`;

/** Computes the same static consumer without mutating source RGB or weight. */
export function evaluateSurfaceLampEmission(
	emission: readonly [number, number, number],
	lamp: FurnitureSurfaceLamp,
	states: SurfaceLampStates | null,
): [number, number, number] | null {
	if (!readFurnitureSurfaceLamp(lamp) || !emission.every(Number.isFinite)) return null;
	// Exact zero delta is independent of membership, not a guessed collection.
	if (lamp.useDESLamp === 0 || emission.every((channel) => channel === 0)) return [...emission];

	const membership = surfaceLampMembership(lamp, states);
	if (membership === null) return null;

	const result = emission.map((channel) => channel + lamp.useDESLamp * (channel * membership - channel));
	return result.every(Number.isFinite) ? (result as [number, number, number]) : null;
}
