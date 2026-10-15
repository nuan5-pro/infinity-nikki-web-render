import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
	BufferAttribute,
	BufferGeometry,
	Matrix4,
	MeshBasicMaterial,
	Mesh,
	PerspectiveCamera,
	Scene,
	Texture,
	WebGLRenderTarget,
	type WebGLRenderer,
} from 'three';
import {
	parallaxCardBasisV2Contract,
	parallaxCardBasisV2SHA,
	restoreParallaxCardBasisV2,
	transformParallaxCardBasisV2,
	parallaxCardBasisV2DrawProof,
} from '../../src/materials/effects/parallaxCardBasisV2.js';
import {
	createDeferredParallaxCardPreviewMaterial,
	installParallaxCardPreviewContext,
	notifyParallaxCardPresented,
} from '../../src/materials/effects/parallaxCardPreview.js';
import {
	readFurnitureParallaxCard,
	type FurnitureParallaxCard,
} from '../../src/materials/effects/parallaxCardShader.js';

const path = process.env.PARALLAX_CARD_BASIS_V2_CONTRACT;

interface CaptureAttribute {
	componentType: number;
	itemSize: number;
	bytesBase64: string;
}

interface Capture {
	row: {
		sourceModelSha256: string;
		pixelShader: string;
		vertexShader: string;
		attributes: Record<string, CaptureAttribute>;
	};
	sourceToGeometry: number[];
}

const capture = path ? (JSON.parse(readFileSync(path, 'utf8')) as Capture) : undefined;
const profilePath = process.env.PARALLAX_CARD_PROFILE_EVIDENCE;
const originalProfile = profilePath
	? (JSON.parse(readFileSync(profilePath, 'utf8')) as FurnitureParallaxCard)
	: undefined;

function actualCarrier() {
	const geometry = new BufferGeometry();
	const material = new MeshBasicMaterial();
	geometry.setAttribute('position', new BufferAttribute(new Float32Array(30), 3));
	for (const [name, attribute] of Object.entries(capture!.row.attributes)) {
		const bytes = Buffer.from(attribute.bytesBase64, 'base64');
		const buffer = Uint8Array.from(bytes).buffer;
		const values = attribute.componentType === 5125 ? new Uint32Array(buffer) : new Float32Array(buffer);
		geometry.setAttribute(name.toLowerCase(), new BufferAttribute(values, attribute.itemSize));
	}

	geometry.setAttribute('_parallax_card_basis_v2_proof_index', new BufferAttribute(new Uint32Array(10).fill(1), 1));
	material.userData.UEParallaxCardBasisV2Proofs = {
		'1': {
			contract: parallaxCardBasisV2Contract,
			contractSha256: parallaxCardBasisV2SHA,
			sourceModelSha256: capture!.row.sourceModelSha256,
			pixelShader: capture!.row.pixelShader,
			vertexShader: capture!.row.vertexShader,
			verifiedVertexCount: 10,
			sourceWindingParity: 1,
			sourceToGeometry: [...capture!.sourceToGeometry],
			sourceNativeIndex: '_UE_VERTEX_INDEX',
			sourceDomain: 'native-snorm8-original-split-buffer',
			boneDomain: 'explicit-original-source-reference-bind-rows',
			mismatches: 0,
		},
	};
	return { geometry, material };
}

describe('actual Card v2 carrier controls (not whole-object GPU acceptance)', () => {
	it.skipIf(!capture)('preserves raw native XYZ, explicit bone rows and typed original IDs', () => {
		const { geometry, material } = actualCarrier();
		restoreParallaxCardBasisV2(geometry, material);
		expect(Array.from(geometry.getAttribute('cardRHITangentX').array.slice(0, 4))).toEqual([
			1, 0, 0, 1,
		]);
		expect(geometry.getAttribute('_jewel_rhi_source_index').array).toBeInstanceOf(Uint32Array);
		expect(geometry.getAttribute('cardRHIBindRow0').count).toBe(10);

		const proof = parallaxCardBasisV2DrawProof(geometry, null);
		transformParallaxCardBasisV2(geometry, new Matrix4().makeScale(-100, 100, 100));
		expect(proof.sourceWindingParity).toBe(-1);
		expect(() => transformParallaxCardBasisV2(geometry, new Matrix4().makeScale(2, 1, 1))).toThrow('orthogonal');
		proof.sourceToGeometry = Array(9).fill(0);
		expect(() => parallaxCardBasisV2DrawProof(geometry, null)).toThrow('orthogonal');
	});
	it.skipIf(!capture)(
		'rejects float source IDs, missing bind input, quantized transport and unknown source',
		() => {
			for (const fault of ['floatIDs', 'missingBind', 'lossy', 'source'] as const) {
				const { geometry, material } = actualCarrier();
				const proof = material.userData.UEParallaxCardBasisV2Proofs['1'];
				if (fault === 'floatIDs')
					geometry.setAttribute('_jewel_rhi_source_index', new BufferAttribute(new Float32Array(10), 1));

				if (fault === 'missingBind') geometry.deleteAttribute('_jewel_rhi_bind_row1');
				if (fault === 'lossy')
					proof.compression = {
						contract: 'parallax-card-native-rhi-lossless-draco-v2',
						hashSpace: 'source-before-optimization',
						decodedVertexCount: 10,
						proofIndexComponentType: 5125,
						sourceIndexComponentType: 5125,
						basisBindQuantizationBits: 16,
					};

				if (fault === 'source') proof.sourceModelSha256 = '0'.repeat(64);
				expect(() => restoreParallaxCardBasisV2(geometry, material)).toThrow();
			}
		},
	);
	it.skipIf(!capture || !originalProfile)(
		'keeps native1 separate and updates native2 frame through ready provider; disposes its pending frame',
		() => {
			expect(readFurnitureParallaxCard(originalProfile)).toBe(originalProfile);

			const profile: FurnitureParallaxCard = {
				...originalProfile!,
				version: 2,
				geometry: parallaxCardBasisV2Contract,
				basisV2: {
					contract: parallaxCardBasisV2Contract,
					contractSha256: parallaxCardBasisV2SHA,
					sourceModelSha256: capture!.row.sourceModelSha256,
					pixelShader: capture!.row.pixelShader,
					vertexShader: capture!.row.vertexShader,
					frame: 'source-native-snorm8-with-explicit-reference-bind-rows',
				},
			};

			expect(readFurnitureParallaxCard(profile)).toBe(profile);
			expect(readFurnitureParallaxCard({ ...profile, basisV2: undefined })).toBeNull();

			const { geometry, material } = actualCarrier();
			restoreParallaxCardBasisV2(geometry, material);

			const scene = new Scene();
			const camera = new PerspectiveCamera();
			const mesh = new Mesh(geometry);
			scene.add(mesh);
			scene.updateMatrixWorld(true);
			camera.updateMatrixWorld(true);

			const target = new WebGLRenderTarget(1, 1);

			const renderer = {
				getRenderTarget: () => target,

				info: { render: { frame: 7 } },
			} as unknown as WebGLRenderer;

			const request = vi.fn(() => 84);
			const cancel = vi.fn();
			vi.stubGlobal('requestAnimationFrame', request);
			vi.stubGlobal('cancelAnimationFrame', cancel);

			const dispose = installParallaxCardPreviewContext(renderer, scene, {
				invalidate: vi.fn(),

				clock: () => 3.25,
			});
			const textures = Object.fromEntries(Object.keys(profile.textures).map((role) => [role, new Texture()]));
			const deferred = createDeferredParallaxCardPreviewMaterial(profile, textures);
			deferred.onBeforeRender(renderer, scene, camera, geometry, mesh, null);
			deferred.onBeforeRender(renderer, scene, camera, geometry, mesh, null);
			expect(deferred.userData.parallaxCardUniforms.cardSourceToGeometry.value.elements).toEqual(capture!.sourceToGeometry);
			expect(deferred.userData.parallaxCardUniforms.cardSourceWindingParity.value).toBe(1);
			expect(deferred.customProgramCacheKey()).toContain('native-2');
			expect(request).not.toHaveBeenCalled();
			notifyParallaxCardPresented({} as WebGLRenderer, scene, deferred);
			notifyParallaxCardPresented(renderer, new Scene(), deferred);
			notifyParallaxCardPresented(renderer, scene, new MeshBasicMaterial());
			expect(request).not.toHaveBeenCalled();
			notifyParallaxCardPresented(renderer, scene, deferred);
			notifyParallaxCardPresented(renderer, scene, deferred);
			expect(request).toHaveBeenCalledTimes(1);
			deferred.dispose();
			notifyParallaxCardPresented(renderer, scene, deferred);
			expect(request).toHaveBeenCalledTimes(1);
			dispose();
			notifyParallaxCardPresented(renderer, scene, deferred);
			expect(cancel).toHaveBeenCalledWith(84);
			expect(() => deferred.onBeforeRender(renderer, scene, camera, geometry, mesh, null)).toThrow('provider');
			Object.values(textures).forEach((texture) => texture.dispose());
			target.dispose();
			vi.unstubAllGlobals();
		},
	);
});
