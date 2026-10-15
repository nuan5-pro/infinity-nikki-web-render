import type { FurnitureModelConfig } from './types.js';

/** Resolves host-owned area selections to native values, ignoring unknown palettes. */
export function resolveCustomData(
	config: Pick<FurnitureModelConfig, 'customData' | 'colorings'>,
	selections: ReadonlyMap<number, number> | Readonly<Record<string, number>>,
): Uint32Array {
	const values = Uint32Array.from(config.customData);
	const entries = selections instanceof Map ? selections.entries() : Object.entries(selections);
	for (const [area, scheme] of entries) {
		const palette = config.colorings[String(area)]?.[String(scheme)];
		if (!palette) continue;
		for (const [component, raw] of palette) values[component] = raw;
	}

	return values;
}
