import type { WebGLRenderer } from 'three';

export interface NNClothRendererLease {
	readonly renderer: WebGLRenderer;
	readonly gl: WebGL2RenderingContext;
	readonly generation: number;
	assertCurrent(renderer?: WebGLRenderer): void;
	onInvalidate(callback: () => void): () => void;
}

interface Registration {
	lease: NNClothRendererLease;
	invalidate(): void;
}

const registrations = new Map<WebGLRenderer, Registration>();
let generation = 0;

/** Each render context owns a lease for its actual Three renderer. */
export function installNNClothRendererContext(renderer: WebGLRenderer) {
	registrations.get(renderer)?.invalidate();

	const gl = renderer.getContext();
	const callbacks = new Set<() => void>();
	let active = true;

	const lease: NNClothRendererLease = {
		renderer,
		generation: ++generation,

		get gl() {
			lease.assertCurrent();
			if (!('texStorage3D' in gl)) throw new Error('[NNCloth] source arrays require WebGL2');

			return gl;
		},

		assertCurrent(actual = renderer) {
			if (
				!active ||
				actual !== renderer ||
				registrations.get(renderer)?.lease !== lease ||
				renderer.getContext() !== gl ||
				gl.isContextLost()
			) throw new Error('[NNCloth] renderer lease missing, ambiguous, replaced or lost');
		},

		onInvalidate(callback) {
			lease.assertCurrent();
			callbacks.add(callback);

			return () => callbacks.delete(callback);
		},
	};

	const registration: Registration = {
		lease,

		invalidate() {
			if (!active) return;

			active = false;
			if (registrations.get(renderer) === registration) registrations.delete(renderer);
			renderer.domElement.removeEventListener('webglcontextlost', registration.invalidate);

			for (const callback of [...callbacks]) callback();
			callbacks.clear();
		},
	};

	registrations.set(renderer, registration);
	renderer.domElement.addEventListener('webglcontextlost', registration.invalidate);

	return registration.invalidate;
}

export function requireNNClothRendererLease(renderer?: WebGLRenderer): NNClothRendererLease {
	const registration = renderer ? registrations.get(renderer) : undefined;
	if (!registration) throw new Error('[NNCloth] renderer context unavailable');

	registration.lease.assertCurrent();
	return registration.lease;
}
