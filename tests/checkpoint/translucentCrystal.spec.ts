import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	BufferGeometry,
	CustomBlending,
	DepthTexture,
	DirectionalLight,
	Float32BufferAttribute,
	LessEqualCompare,
	Mesh,
	MeshBasicMaterial,
	OneFactor,
	OneMinusSrcAlphaFactor,
	PCFShadowMap,
	PerspectiveCamera,
	Scene,
	ShaderLib,
	SrcAlphaFactor,
	Texture,
	Uint32BufferAttribute,
	Vector3,
	WebGLRenderTarget,
	ZeroFactor,
	type Matrix4,
	type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
	mergeTranslucentCrystalGeometryProofs,
	restoreTranslucentCrystalGeometryProof,
} from '../../src/materials/glass/translucentCrystalGeometry.js';
import {
	createTranslucentCrystalMaterial,
	readFurnitureTranslucentCrystal,
	type FurnitureTranslucentCrystal,
} from '../../src/materials/glass/translucentCrystalShader.js';
import {
	buildDefaultPlainMaterial,
	type MaterialRegistryEntry,
} from '../../src/materials/factory.js';
import {
	TEXTURE_SLOTS,
	type TextureSlot,
} from '../../src/materials/textureInputs.js';
import {
	createTranslucentCrystalPreviewMaterial,
	crystalEditorDirectionToNative,
	crystalPreviewShadowKernel,
	applyCrystalPreviewTargetAlpha,
	createDeferredTranslucentCrystalPreviewMaterial,
	readTranslucentCrystalPreviewDomain,
	type TranslucentCrystalPreviewDomain,
} from '../../src/materials/glass/translucentCrystalPreview.js';

const evidence = process.env.CRYSTAL_PROFILES_EVIDENCE;
const actual = evidence
	? (JSON.parse(readFileSync(evidence, 'utf8')) as Record<string, FurnitureTranslucentCrystal>)
	: null;
const domainPath = process.env.CRYSTAL_PREVIEW_DOMAIN_EVIDENCE;
const domain = domainPath
	? (JSON.parse(readFileSync(domainPath, 'utf8')) as TranslucentCrystalPreviewDomain)
	: null;

function source(profile: FurnitureTranslucentCrystal) {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
	geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
	geometry.setAttribute('tangent', new Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
	for (const channel of profile.requiredUv)
		geometry.setAttribute(channel === 0 ? 'uv' : `uv${channel}`, new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));

	geometry.setAttribute('_crystal_proof_index', new Uint32BufferAttribute([1, 1, 1], 1));
	geometry.setIndex([0, 1, 2]);

	const proof = {
		contract: profile.geometry,
		verifiedVertexCount: 3,
		sourceNativeIndex: '_UE_VERTEX_INDEX',
		positionMatched: true,
		basisMatched: true,
		uvMatched: true,
		mismatches: 0,
		pose: 'source-bind-pose',
		pixelShader: 'a576d489ff423f4197f5746a78127a0ea3aefdb4',
	};

	const material = new MeshBasicMaterial();
	material.userData.ueTranslucentCrystalProofs = { 1: proof };
	return { geometry, material, proof };
}

describe.skipIf(!actual)('Crystal source ABI and transport (not visual acceptance)', () => {
	it('retains all six actual native profiles and source shader operations', () => {
		expect(Object.keys(actual!)).toHaveLength(6);
		for (const profile of Object.values(actual!)) {
			expect(readFurnitureTranslucentCrystal(profile)).toBe(profile);

			const sources = Object.fromEntries(Object.keys(profile.textures).map((role) => [role, new Texture()]));
			// Explicit test inputs exercise ABI only; no scene/native defaults are inferred.
			const material = createTranslucentCrystalMaterial(profile, sources, {
				nativeLightDirection: new Vector3(1, 0, 0),
				nativeLightColor: new Vector3(1, 1, 1),
				shadow: 1,
				dayNight: 0,
				jewelryStrength: 0,
				materialTextureMipBias: 0,
			});

			const shader = {
				uniforms: {},
				vertexShader: ShaderLib.basic.vertexShader,
				fragmentShader: ShaderLib.basic.fragmentShader,
			};

			Reflect.apply(material.onBeforeCompile, material, [shader, {}]);
			expect(shader.fragmentShader).toContain('textureGrad(crystalD1,uv+offset,dx,dy).r');
			expect(shader.fragmentShader).toContain('body*dot(body,detail)-detail*body.z');
			expect(shader.fragmentShader).toContain('bodyNormalSample.b+cCrystal_RoughnessEmissiveMaskSwitch');
			expect(shader.fragmentShader).toContain('crystalMipBias');
			expect(shader.fragmentShader).toContain('vec3 native=normalize(furnitureNativeWorld(world));');
			expect(shader.fragmentShader).toContain('return vec3(value.x, -value.y, value.z);');
			expect(shader.fragmentShader).not.toContain('normalize(vec3(-world.y,world.x,world.z))');
			expect(shader.vertexShader).not.toContain('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )');
			expect(shader.vertexShader.match(/#include <defaultnormal_vertex>/g)).toHaveLength(1);
			expect(material.customProgramCacheKey()).toContain('translucent-crystal-native-4-world-frame-v1');
			expect(material.transparent).toBe(true);
			expect(material.depthWrite).toBe(false);
			expect(material.blending).toBe(CustomBlending);
			expect(material.blendSrc).toBe(SrcAlphaFactor);
			expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
			expect(material.blendSrcAlpha).toBe(ZeroFactor);
			expect(material.blendDstAlpha).toBe(OneMinusSrcAlphaFactor);
			material.dispose();
		}
	});

	it.each([
		'missing-scalar',
		'missing-colour',
		'missing-resource',
		'missing-uv',
		'negative-height',
	])('rejects incomplete profile: %s', (kind) => {
		const profile = structuredClone(Object.values(actual!)[0]!);
		switch (kind) {
		case 'missing-scalar':
			delete profile.scalars.Crystal_DetailHeightRatio;
			break;
		case 'missing-colour':
			delete profile.colors.Crystal_HDRAttributes;
			break;
		case 'missing-resource':
			delete profile.textures.N1;
			break;
		case 'missing-uv':
			profile.requiredUv = [0];
			break;
		case 'negative-height':
			profile.scalars.Crystal_DetailHeightRatio = -0.01;
			break;
		}

		expect(readFurnitureTranslucentCrystal(profile)).toBeNull();
	});

	it.each([
		'float-id',
		'mixed-id',
		'wrong-count',
		'missing-tangent',
		'missing-uv',
		'nonfinite-normal',
	])('rejects incomplete transport: %s', (kind) => {
		const profile = Object.values(actual!)[0]!;
		const { geometry, material, proof } = source(profile);
		switch (kind) {
		case 'float-id':
			geometry.setAttribute('_crystal_proof_index', new Float32BufferAttribute([1, 1, 1], 1));
			break;
		case 'mixed-id':
			geometry.getAttribute('_crystal_proof_index').setX(1, 2);
			break;
		case 'wrong-count':
			proof.verifiedVertexCount = 4;
			break;
		case 'missing-tangent':
			geometry.deleteAttribute('tangent');
			break;
		case 'missing-uv':
			geometry.deleteAttribute('uv1');
			break;
		case 'nonfinite-normal':
			geometry.getAttribute('normal').setX(0, NaN);
			break;
		}

		expect(() => restoreTranslucentCrystalGeometryProof(geometry, material, profile)).toThrow();
		expect(geometry.userData.ueTranslucentCrystalProof).toBeUndefined();
	});

	it('limits merged proof to its source draw and rejects crossed indices', () => {
		const profile = Object.values(actual!)[0]!;
		const { geometry, material, proof } = source(profile);
		restoreTranslucentCrystalGeometryProof(geometry, material, profile);
		expect(geometry.hasAttribute('_crystal_proof_index')).toBe(false);

		const other = geometry.clone();
		other.userData = {};

		const merged = mergeGeometries([other, geometry], true)!;
		mergeTranslucentCrystalGeometryProofs(merged, [other, geometry]);
		expect(merged.userData.ueTranslucentCrystalProof.drawRanges).toEqual([
			{ start: 3, count: 3, materialIndex: 1, vertexStart: 3, vertexCount: 3, proof },
		]);
		merged.getIndex()!.setX(3, 0);
		expect(() => mergeTranslucentCrystalGeometryProofs(merged, [other, geometry])).toThrow('crosses source vertex interval');
	});
});

describe.skipIf(!actual || !domain)(
	'Crystal preview provider ABI (not whole-object visual evidence)',
	() => {
		it('dispatches typed seven-role shared material pipeline without legacy tint/white fallback', async () => {
			const profile = { ...Object.values(actual!)[0]!, preview: domain! };
			const original = new MeshBasicMaterial();
			original.name = 'actual-source-Crystal-material';
			original.userData.translucentCrystal = profile;
			original.userData.ueTranslucentCrystalProofs = { 7: { contract: profile.geometry } };

			const entry = Object.fromEntries(TEXTURE_SLOTS.map((role) => [role, new Map()])) as MaterialRegistryEntry;
			const inputs: Record<string, unknown> = {};
			for (const [key, texture] of Object.entries(profile.textures)) {
				const role = key as TextureSlot;
				const resource = `t-${'a'.repeat(16)}`;
				inputs[role] = {
					images: [resource],
					usage:
						role === 'N' || role === 'N1'
							? 'normal'
							: role === 'O'
								? 'data'
								: role === 'S'
									? 'reflection'
									: 'color',
					srgb: texture.sRGB,
					mipmaps: texture.mipmaps,
					nearest: texture.nearest,
					addressX: texture.addressX,
					addressY: texture.addressY,
					...(role === 'N' || role === 'N1' ? { normalEncoding: 'native-rg' } : {}),
				};
				entry[role].set(0, {
					resource,
					resources:
						{} as import('../../src/resources/resources.js').FurnitureResources,
					quality: 'full',
					_cache: new Texture(),
				});
			}

			original.userData.textureInputs = inputs;

			const registry = new Map([[original.name, entry]]);
			const material = await buildDefaultPlainMaterial(original, original.name, registry);
			expect(material.customProgramCacheKey()).toContain('awaiting-actual-draw-context');
			expect(material.blending).toBe(CustomBlending);
			expect(material.userData.ueTranslucentCrystalProofs).toBe(original.userData.ueTranslucentCrystalProofs);
			expect(material.name).toBe(original.name);
			entry.N1.clear();
			await expect(buildDefaultPlainMaterial(original, original.name, registry)).rejects.toThrow('missing declared native texture input N1');
			material.dispose();
		});

		it('locks actual Collection state/register defaults and neutral native View bias', () => {
			expect(readTranslucentCrystalPreviewDomain(domain)).toBe(domain);
			for (const override of [
				{ dayNight: 0 },
				{ jewelryStrength: 0 },
				{ materialTextureMipBias: -0.5 },
				{ collectionStateId: 'weather-unrelated' },
			]) {
				expect(readTranslucentCrystalPreviewDomain({ ...domain, ...override })).toBeNull();
			}
		});

		it('maps all signed editor basis directions to the declared UE preview frame', () => {
			for (const direction of [
				new Vector3(1, 0, 0),
				new Vector3(0, 1, 0),
				new Vector3(0, 0, 1),
				new Vector3(-2, 3, -4),
			]) {
				const native = crystalEditorDirectionToNative(direction);
				expect(native.toArray()).toEqual([direction.x, -direction.y, direction.z]);
				expect(new Vector3(native.x, -native.y, native.z).toArray()).toEqual(direction.toArray());
			}
		});

		it('reuses actual installed PCF/VSM/Basic shader equations instead of constant shadow', () => {
			const kernel = crystalPreviewShadowKernel();
			expect(kernel).toContain('sampler2DShadow shadowMap');
			expect(kernel).toContain('crystalPreviewVogelDiskSample');
			expect(kernel).toContain('texture2D( shadowMap, shadowCoord.xy ).rg');
			expect(kernel).not.toContain('uniform PointLightShadow');
		});

		it('updates position/target/color*intensity and binds the selected map; missing map fails', () => {
			const profile = Object.values(actual!)[0]!;
			const textures = Object.fromEntries(Object.keys(profile.textures).map((role) => [role, new Texture()]));
			const scene = new Scene();
			const light = new DirectionalLight(0x123abc, 1.7);
			light.position.set(14, 27, 39);
			light.target.position.set(4, 7, 9);
			light.castShadow = true;
			scene.add(light, light.target);
			// Resource objects verify binding only; actual generated GPU maps are covered
			// separately by Playwright, not inferred from this transport unit fixture.
			light.shadow.map = new WebGLRenderTarget(16, 32);
			light.shadow.map.depthTexture = new DepthTexture(16, 32);
			light.shadow.map.depthTexture.compareFunction = LessEqualCompare;

			const renderer = {
				shadowMap: { enabled: true, type: PCFShadowMap },
				capabilities: { reversedDepthBuffer: false },

				getRenderTarget: () => null,

				getContext: () => ({
					getContextAttributes: () => ({ alpha: true, premultipliedAlpha: true }),
				}),

				info: { render: { frame: 7 } },
			} as unknown as WebGLRenderer;

			const material = createTranslucentCrystalPreviewMaterial(profile, textures, {
				renderer,
				scene,
				domain: domain!,
			});
			const data = source(profile);
			restoreTranslucentCrystalGeometryProof(data.geometry, data.material, profile);

			const mesh = new Mesh(data.geometry, material);
			mesh.receiveShadow = true;

			const camera = new PerspectiveCamera();

			const shader = {
				uniforms: {} as Record<string, { value: unknown }>,
				vertexShader: ShaderLib.basic.vertexShader,
				fragmentShader: ShaderLib.basic.fragmentShader,
			};

			Reflect.apply(material.onBeforeCompile, material, [shader, renderer]);
			Reflect.apply(material.onBeforeRender, material, [
				renderer,
				scene,
				camera,
				data.geometry,
				mesh,
				null,
			]);
			expect(shader.uniforms.crystalPreviewShadowMap!.value).toBe(light.shadow.map.depthTexture);
			expect(shader.uniforms.crystalShadow).toBeUndefined();
			expect(shader.fragmentShader).toContain('crystalPreviewShadow()+cCrystal_ShadowEmissive');

			const direction = crystalEditorDirectionToNative(new Vector3(10, 20, 30).normalize());
			expect((shader.uniforms.crystalNativeLight!.value as Vector3).toArray()).toEqual(direction.toArray());

			const color = new Vector3(light.color.r, light.color.g, light.color.b).multiplyScalar(light.intensity);
			expect((shader.uniforms.crystalNativeLightColor!.value as Vector3).toArray()).toEqual(color.toArray());
			light.position.x += 3;
			light.intensity *= 2;
			Reflect.apply(material.onBeforeRender, material, [
				renderer,
				scene,
				camera,
				data.geometry,
				mesh,
				null,
			]);
			expect((shader.uniforms.crystalNativeLightColor!.value as Vector3).toArray()).toEqual(color.multiplyScalar(2).toArray());
			light.shadow.map = null;
			expect(() =>
				Reflect.apply(material.onBeforeRender, material, [
					renderer,
					scene,
					camera,
					data.geometry,
					mesh,
					null,
				]),
			).toThrow('generated renderer shadow');
		});

		it('defers scene readiness without constant light/shadow and keeps the real geometry proof', () => {
			const profile = { ...Object.values(actual!)[0]!, preview: domain! };
			const textures = Object.fromEntries(Object.keys(profile.textures).map((role) => [role, new Texture()]));
			const scene = new Scene();
			const camera = new PerspectiveCamera();
			const light = new DirectionalLight(0x456abc, 1.2);
			light.position.set(10, 20, 30);
			light.castShadow = true;
			light.shadow.map = new WebGLRenderTarget(16, 16);
			light.shadow.map.depthTexture = new DepthTexture(16, 16);
			light.shadow.map.depthTexture.compareFunction = LessEqualCompare;
			scene.add(light, light.target);

			const renderer = {
				shadowMap: { enabled: true, type: PCFShadowMap },
				capabilities: { reversedDepthBuffer: false },

				getRenderTarget: () => null,

				getContext: () => ({
					getContextAttributes: () => ({ alpha: true, premultipliedAlpha: true }),
				}),

				info: { render: { frame: 9 } },
			} as unknown as WebGLRenderer;

			const material = createDeferredTranslucentCrystalPreviewMaterial(profile, textures);
			expect(material.customProgramCacheKey()).toContain('awaiting-actual-draw-context');

			const data = source(profile);
			restoreTranslucentCrystalGeometryProof(data.geometry, data.material, profile);
			material.userData.ueTranslucentCrystalProofs = data.material.userData.ueTranslucentCrystalProofs;
			material.name = 'actual-source-identity';

			const mesh = new Mesh(data.geometry, material);
			mesh.receiveShadow = true;
			Reflect.apply(material.onBeforeRender, material, [
				renderer,
				scene,
				camera,
				data.geometry,
				mesh,
				null,
			]);
			expect(material.name).toBe('actual-source-identity');
			expect(material.userData.ueTranslucentCrystalProofs).toBe(data.material.userData.ueTranslucentCrystalProofs);
			expect(material.customProgramCacheKey()).toContain('translucent-crystal-native-4-world-frame-v1');
			expect(material.blendSrcAlpha).toBe(OneFactor);
			expect(material.blendDstAlpha).toBe(OneMinusSrcAlphaFactor);
			renderer.getRenderTarget = () => light.shadow.map;
			Reflect.apply(material.onBeforeRender, material, [
				renderer,
				scene,
				camera,
				data.geometry,
				mesh,
				null,
			]);
			expect(material.blendSrcAlpha).toBe(ZeroFactor);
			expect(material.blendDstAlpha).toBe(OneMinusSrcAlphaFactor);

			const shader = {
				uniforms: {} as Record<string, { value: unknown }>,
				vertexShader: ShaderLib.basic.vertexShader,
				fragmentShader: ShaderLib.basic.fragmentShader,
			};

			Reflect.apply(material.onBeforeCompile, material, [shader, renderer]);
			expect(shader.uniforms.crystalPreviewShadowMap!.value).toBe(light.shadow.map.depthTexture);
			expect(shader.uniforms.crystalShadow).toBeUndefined();
			mesh.receiveShadow = false;
			Reflect.apply(material.onBeforeRender, material, [
				renderer,
				scene,
				camera,
				data.geometry,
				mesh,
				null,
			]);
			expect((shader.uniforms.crystalPreviewShadowMatrix!.value as Matrix4).equals(light.shadow.matrix)).toBe(true);
			expect(shader.uniforms.crystalPreviewShadowMap!.value).toBe(light.shadow.map.depthTexture);
		});

	},
);

it('switches crystal alpha blending between transparent canvas and offscreen targets without changing RGB', () => {
	const material = new MeshBasicMaterial();
	material.blendSrc = SrcAlphaFactor;
	material.blendDst = OneMinusSrcAlphaFactor;
	const offscreen = new WebGLRenderTarget();
	let target: WebGLRenderTarget | null = null;
	let alpha = true;
	const renderer = {
		getRenderTarget: () => target,
		getContext: () => ({ getContextAttributes: () => ({ alpha, premultipliedAlpha: true }) }),
	} as unknown as WebGLRenderer;
	try {
		for (const state of [
			{ target: null, alpha: true, source: OneFactor },
			{ target: offscreen, alpha: true, source: ZeroFactor },
			{ target: null, alpha: false, source: ZeroFactor },
			{ target: null, alpha: true, source: OneFactor },
		]) {
			target = state.target;
			alpha = state.alpha;
			applyCrystalPreviewTargetAlpha(material, renderer);
			expect(material.blendSrcAlpha).toBe(state.source);
			expect(material.blendDstAlpha).toBe(OneMinusSrcAlphaFactor);
			expect(material.blendSrc).toBe(SrcAlphaFactor);
			expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
		}
	} finally {
		material.dispose();
		offscreen.dispose();
	}
});
