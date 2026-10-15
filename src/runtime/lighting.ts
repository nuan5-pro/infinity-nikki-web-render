import type { IUniform, WebGLRenderer } from 'three';

/** The material inputs supplied by the host's time-of-day system. */
export interface HomeTodSample {
	minute: number;
	sunDirectionWorld: readonly [number, number, number];
	swapLightFactor: number;
}

export interface MaterialLighting {
	primaryDirection: [number, number, number];
	primaryColor: [number, number, number];
	tod: HomeTodSample;
}

const outputs = new WeakMap<WebGLRenderer, Record<string, IUniform>>();
const empty: Record<string, IUniform> = Object.freeze({});

/** Borrows uniforms from the host's output transform; their values stay live. */
export function setOutputUniforms(renderer: WebGLRenderer, uniforms: Record<string, IUniform>): void {
	outputs.set(renderer, uniforms);
}

export function outputUniforms(renderer: WebGLRenderer): Record<string, IUniform> {
	return outputs.get(renderer) ?? empty;
}

export function releaseOutputUniforms(renderer: WebGLRenderer): void {
	outputs.delete(renderer);
}
