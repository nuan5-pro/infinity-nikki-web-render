/** Shared instance budget for one scene. */
export const MAX_RENDER_INSTANCES = 500_000;

const POOL_MIN = 32;
const POOL_HEADROOM = 16;
const POOL_GROWTH = 1.5;

/** Clamp rendered instances to the scene budget. */
export function requiredInstanceCount(itemCount: number): number {
	return Math.min(Math.max(0, itemCount), MAX_RENDER_INSTANCES);
}

/** Grow the instance pool with headroom while preserving allocated slots. */
export function nextInstancedPoolCapacity(required: number, currentAllocated: number): number {
	const cap = MAX_RENDER_INSTANCES;
	const need = Math.min(Math.max(0, required), cap);
	if (need === 0) return Math.min(POOL_MIN, cap);

	if (currentAllocated >= need) return currentAllocated;

	if (currentAllocated === 0) return Math.min(cap, Math.max(POOL_MIN, need + POOL_HEADROOM, Math.floor(need * POOL_GROWTH)));

	const grown = Math.max(need + POOL_HEADROOM, Math.floor(currentAllocated * POOL_GROWTH), need);
	return Math.min(cap, Math.max(grown, POOL_MIN));
}
