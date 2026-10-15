import { createHash } from 'node:crypto';
import {
	BufferGeometry,
	DirectionalLight,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	PerspectiveCamera,
	Scene,
	type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
	createJewelryMaskedPreviewProvider,
	readJewelryMaskedPreviewFrame,
} from '../../src/materials/jewel/jewelryMaskedPreview.js';
import { jewelryMaskedDistanceBlend } from '../../src/materials/jewel/jewelryMaskedRuntime.js';
import type { JewelryMaskedSourceContract } from '../../src/materials/jewel/jewelryMaskedShader.js';

async function fixture(instanced = false) {
	// Mechanical context tests: real Three scene/light/camera; only GL viewport is
	// a fixture. Fake digest identities below do not constitute runtime admission.
	const renderer = {
		getContext: () => ({ VIEWPORT: 0x0ba2,

			getParameter: () => new Int32Array([0, 0, 1600, 800]) }),
	} as unknown as WebGLRenderer;

	const scene = new Scene();
	const camera = new PerspectiveCamera(60, 2, 0.1, 2000);
	camera.position.z = 200;

	const light = new DirectionalLight(0xffffff, 3);
	light.color.setRGB(0.2, 0.4, 0.8);
	light.position.set(50, 0, 100);

	const geometry = new BufferGeometry();
	const material = new MeshBasicMaterial();
	const object = instanced ? new InstancedMesh(geometry, material, 2) : new Mesh(geometry, material);
	if (object instanceof InstancedMesh) {
		object.setMatrixAt(0, new Matrix4());
		object.setMatrixAt(1, new Matrix4());
	}

	scene.add(camera, light, light.target, object);
	scene.updateMatrixWorld(true);

	const profile = {
		runtimeProofSha256: '1'.repeat(64),
		sourceModelSha256: '2'.repeat(64),
		geometryCaptureSha256: '3'.repeat(64),
		componentBoundsCaptureSha256: '4'.repeat(64),
		domain: {
			globalAttributeFactor: 1,
		},
	};

	const frameBytes = new TextEncoder().encode(
		JSON.stringify({
			runtimeProofSha256: profile.runtimeProofSha256,
			sourceModelSha256: profile.sourceModelSha256,
			geometryCaptureSha256: profile.geometryCaptureSha256,
			editorWorldToSourceWorldCM: new Matrix4().toArray(),
			componentBounds: {
				kind: 'whole-static-mesh-extended-bounds',
				sourceModelSha256: profile.sourceModelSha256,
				captureSha256: profile.componentBoundsCaptureSha256,
				originCM: [100, 0, 0],
				extentCM: [10, 20, 30],
			},
		}),
	);

	const source = {
		...profile,
		previewFrameSha256: createHash('sha256').update(frameBytes).digest('hex'),
	} as unknown as JewelryMaskedSourceContract;

	const frame = await readJewelryMaskedPreviewFrame(frameBytes.buffer, source);

	const proof = {
		runtimeProofSha256: source.runtimeProofSha256,
		sourceModelSha256: source.sourceModelSha256,
		geometryCaptureSha256: source.geometryCaptureSha256,
		beforeBake: true as const,
		sourceCMToGeometry: new Matrix4().toArray(),
	};

	const input = { renderer, scene, camera, geometry, object, proof };
	const provider = createJewelryMaskedPreviewProvider({
		renderer,
		scene,
		light,
		targetOwnership: 'scene',

		editorClockSeconds: () => 12.5,
	});
	return {
		renderer,
		scene,
		camera,
		light,
		object,
		source,
		frame,
		proof,
		input,
		provider,
		frameBytes,
	};
}

describe('Masked actual-context provider mechanics, not GPU/normal producer proof', () => {
	it('uses whole asset bounds, physical viewport, real non-white light and explicit clock', async () => {
		const f = await fixture();
		const result = f.provider.resolve(f.input, f.source, f.proof, f.frame);
		expect(result.editorTimeSeconds).toBe(12.5);
		expect(result.lightLinearColorIntensity).toEqual([0.2 * 3, 0.4 * 3, 0.8 * 3]);
		expect(result.sourceDistanceBlend).toBe(
			jewelryMaskedDistanceBlend({
				cameraTile: [0, 0, 0],
				cameraOffsetCM: [0, 0, 200],
				objectBoundsTile: [0, 0, 0],
				objectBoundsOffsetCM: [100, 0, 0],
				viewportPixels: [1600, 800],
				clipToView00: f.camera.projectionMatrixInverse.elements[0]!,
				globalAttributeFactor: 1,
			}),
		);
		expect(result.viewToSourceWorldDirection).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
	});

	it('rejects context/source/frame/capture mismatch and frame mutation instead of an identity/light fallback', async () => {
		const f = await fixture();
		expect(() => f.provider.resolve({ ...f.input, scene: new Scene() }, f.source, f.proof, f.frame)).toThrow();
		expect(() => f.provider.resolve(f.input, f.source, { ...f.proof, sourceModelSha256: '9'.repeat(64) }, f.frame)).toThrow();
		expect(() => f.provider.resolve(f.input, f.source, f.proof, { ...f.frame })).toThrow();
		f.frame.componentBounds.originCM = [0, 0, 0];
		expect(() => f.provider.resolve(f.input, f.source, f.proof, f.frame)).toThrow();
		await expect(
			readJewelryMaskedPreviewFrame(f.frameBytes.buffer, {
				...f.source,
				previewFrameSha256: '0'.repeat(64),
			}),
		).rejects.toThrow('SHA changed');
	});

	it('uses independently evaluated instances only when their actual distance factors coincide', async () => {
		const f = await fixture(true);
		const first = f.provider.resolve(f.input, f.source, f.proof, f.frame);
		expect(first.instanceDistanceBlends).toEqual([
			first.sourceDistanceBlend,
			first.sourceDistanceBlend,
		]);
		if (!(f.object instanceof InstancedMesh)) throw new Error('expected actual instance fixture');

		f.object.setMatrixAt(1, new Matrix4().makeTranslation(0, 0, 100));
		expect(() => f.provider.resolve(f.input, f.source, f.proof, f.frame)).toThrow('per-instance transport');
	});

	it('does not schedule or install a renderer loop, and dispose prevents future context use', async () => {
		const f = await fixture();
		f.provider.dispose();
		f.provider.dispose();
		expect(() => f.provider.resolve(f.input, f.source, f.proof, f.frame)).toThrow('inactive');
		expect('render' in f.renderer).toBe(false);
	});
});
