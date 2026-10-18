import { expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PCFShadowMap, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import {
	finalizeMaterial,
	invalidateMaterialBindings,
	materialBindingRevision,
	materialNeedsFinalization,
	registerMaterialFinalizer,
} from '../src/runtime/materialPreparation.js';

it('tracks binding changes independently of shader finalization', () => {
	const material = new MeshBasicMaterial();
	const key = material.customProgramCacheKey();
	const compile = material.onBeforeCompile;
	expect(materialBindingRevision(material)).toBe(0);
	invalidateMaterialBindings(material);
	invalidateMaterialBindings(material);
	expect(materialBindingRevision(material)).toBe(2);
	expect(material.customProgramCacheKey()).toBe(key);
	expect(material.onBeforeCompile).toBe(compile);
	expect(materialNeedsFinalization(material)).toBe(false);
	material.dispose();
});

it('finalizes shader variants again when renderer shadows are toggled before GPU preparation', () => {
	const renderer = { shadowMap: { enabled: true, type: PCFShadowMap } } as unknown as WebGLRenderer;
	const scene = new Scene();
	const camera = new PerspectiveCamera();
	const geometry = new BoxGeometry();
	const material = new MeshBasicMaterial();
	const mesh = new Mesh(geometry, material);
	const finalize = vi.fn();
	registerMaterialFinalizer(material, finalize);

	try {
		for (const enabled of [true, false, true]) {
			renderer.shadowMap.enabled = enabled;
			expect(materialNeedsFinalization(material, renderer, scene)).toBe(true);
			finalizeMaterial(material, renderer, scene, camera, geometry, mesh, null);
			expect(materialNeedsFinalization(material, renderer, scene)).toBe(false);
			finalizeMaterial(material, renderer, scene, camera, geometry, mesh, null);
		}
		expect(finalize).toHaveBeenCalledTimes(3);
	} finally {
		material.dispose();
		geometry.dispose();
	}
});
