import type { WebGLRenderer } from 'three';

const now = () => performance.now() * .001;

export function createMaterialClock(clock = now, enabled = true) {
	let running = enabled;
	let anchor = clock();
	let elapsed = enabled ? anchor : 0;

	return {
		get enabled() { return running; },
		read: () => elapsed + (running ? clock() - anchor : 0),
		setEnabled(value: boolean) {
			if (running === value) return false;

			const time = clock();
			if (running) elapsed += time - anchor;
			anchor = time;
			running = value;
			return true;
		},
	};
}

const clocks = new WeakMap<WebGLRenderer, ReturnType<typeof createMaterialClock>>();

export function installMaterialClock(renderer: WebGLRenderer, clock: ReturnType<typeof createMaterialClock>) {
	clocks.set(renderer, clock);
	return () => { if (clocks.get(renderer) === clock) clocks.delete(renderer); };
}

/** Materials outside a render context retain their standalone wall-clock behaviour. */
export function materialTime(renderer: WebGLRenderer) {
	return clocks.get(renderer)?.read() ?? now();
}
