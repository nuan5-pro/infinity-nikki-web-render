import {
	AddEquation,
	BasicShadowMap,
	Color,
	CustomBlending,
	DirectionalLight,
	Matrix4,
	MeshBasicMaterial,
	OneFactor,
	OneMinusSrcAlphaFactor,
	PCFShadowMap,
	RGFormat,
	ShaderChunk,
	SrcAlphaFactor,
	Vector2,
	Vector3,
	VSMShadowMap,
	ZeroFactor,
	type Scene,
	type Texture,
	type WebGLRenderer,
} from 'three';
import {
	createTranslucentCrystalMaterial,
	type FurnitureTranslucentCrystal,
	type TranslucentCrystalLighting,
	type TranslucentCrystalPreviewShadow,
} from './translucentCrystalShader.js';
import { registerMaterialFinalizer } from '../../runtime/materialPreparation.js';

export interface TranslucentCrystalPreviewDomain {
	version: 1
	kind: 'editor-linked-day-collection-defaults'
	dayNight: number
	jewelryStrength: number
	materialTextureMipBias: number
	collectionStateId: string
	collectionCaptureSha256: string
	viewDefaultSourceSha256: string
}

export interface TranslucentCrystalPreviewOptions {
	renderer: WebGLRenderer
	scene: Scene
	domain: TranslucentCrystalPreviewDomain
	/** Explicit selection when the scene has multiple visible shadow-casting suns. */
	light?: DirectionalLight
}

export function readTranslucentCrystalPreviewDomain(value: unknown): TranslucentCrystalPreviewDomain | null {
	if (!value || typeof value !== 'object') return null;

	const domain = value as TranslucentCrystalPreviewDomain;
	return domain.version === 1 &&
		domain.kind === 'editor-linked-day-collection-defaults' &&
		domain.dayNight === 1 &&
		domain.jewelryStrength === 1 &&
		domain.materialTextureMipBias === 0 &&
		domain.collectionStateId === '73C1D5ED-4B7AE2FA-DA3C9D83-4F8F468D'
		? domain
		: null;
}

// Saved UE world Location.X/Y/Z stays local X/Y/Z; matrixTransform applies the
// scene parent Scale(1,-1,1). Asset-local CUE/geometry baking is a separate frame.
export function crystalEditorDirectionToNative(direction: Vector3, target = new Vector3()): Vector3 {
	return target.set(direction.x, -direction.y, direction.z);
}

/** UE destination-alpha transmittance is not transparent-canvas opacity. The
 * preview adapts only target alpha; source RGB/coverage and offscreen ABI stay. */
export function applyCrystalPreviewTargetAlpha(material: MeshBasicMaterial, renderer: WebGLRenderer) {
	const attributes = renderer.getContext().getContextAttributes();
	if (!attributes) throw new Error('[ModelManager][Crystal] active renderer context attributes required');

	const target = renderer.getRenderTarget();
	const canvasOpacity = !target && attributes.alpha;
	material.blendSrcAlpha = canvasOpacity ? OneFactor : ZeroFactor;
	material.blendDstAlpha = OneMinusSrcAlphaFactor;
	return {
		contract: 'crystal-preview-target-alpha-v1',
		target: target ? 'offscreen-native-transmittance' : 'default-framebuffer',
		contextAlpha: attributes.alpha,
		contextPremultipliedAlpha: attributes.premultipliedAlpha,
		alphaMeaning: canvasOpacity ? 'transparent-canvas-opacity' : 'native-destination-transmittance',
		blendSrcRGB: material.blendSrc,
		blendDstRGB: material.blendDst,
		blendSrcAlpha: material.blendSrcAlpha,
		blendDstAlpha: material.blendDstAlpha,
	};
}

function directionalLight(scene: Scene, requested?: DirectionalLight): DirectionalLight {
	const lights: DirectionalLight[] = [];
	scene.traverseVisible((object) => {
		if (object instanceof DirectionalLight && object.castShadow) lights.push(object);
	});
	if (requested ? !lights.includes(requested) : lights.length !== 1) throw new Error(
		'[ModelManager][Crystal] select an actual visible scene DirectionalLight with shadows',
	);

	return requested ?? lights[0]!;
}

/** Use the installed renderer's actual directional shadow filtering equation. */
export function crystalPreviewShadowKernel(): string {
	const chunk = ShaderChunk.shadowmap_pars_fragment;
	const start = chunk.indexOf('\t#if defined( SHADOWMAP_TYPE_PCF )', chunk.indexOf('uniform PointLightShadow'));
	const end = chunk.indexOf('\t#if NUM_POINT_LIGHT_SHADOWS > 0', start);
	if (start < 0 || end < 0) throw new Error('[ModelManager][Crystal] unreviewed renderer shadow chunk');

	return chunk
		.slice(start, end)
		.split('SHADOWMAP_TYPE_PCF')
		.join('CRYSTAL_PREVIEW_PCF')
		.split('SHADOWMAP_TYPE_VSM')
		.join('CRYSTAL_PREVIEW_VSM')
		.split('USE_REVERSED_DEPTH_BUFFER')
		.join('CRYSTAL_PREVIEW_REVERSED_DEPTH')
		.split('getShadow(')
		.join('crystalPreviewGetShadow(')
		.split('interleavedGradientNoise')
		.join('crystalPreviewGradientNoise')
		.split('vogelDiskSample')
		.join('crystalPreviewVogelDiskSample');
}

export function createTranslucentCrystalPreviewMaterial(
	profile: FurnitureTranslucentCrystal,
	sources: Partial<Record<string, Texture | null>>,
	options: TranslucentCrystalPreviewOptions,
): MeshBasicMaterial {
	const { renderer, scene, domain } = options;
	if (!readTranslucentCrystalPreviewDomain(domain)) throw new Error('[ModelManager][Crystal] evidenced static preview domain required');

	const light = directionalLight(scene, options.light);
	const shadowType = renderer.shadowMap.type;
	if (shadowType !== BasicShadowMap && shadowType !== PCFShadowMap && shadowType !== VSMShadowMap) throw new Error('[ModelManager][Crystal] unreviewed renderer shadow type');
	if (!renderer.shadowMap.enabled) throw new Error('[ModelManager][Crystal] actual renderer shadows must be enabled');

	const position = new Vector3();
	const target = new Vector3();
	const direction = new Vector3();
	const color = new Color();
	const nativeLightDirection = new Vector3();
	const nativeLightColor = new Vector3();

	const updateLight = () => {
		light.updateWorldMatrix(true, false);
		light.target.updateWorldMatrix(true, false);
		light.getWorldPosition(position);
		light.target.getWorldPosition(target);
		direction.subVectors(position, target);
		if (
			!direction.lengthSq() ||
			![
				direction.x,
				direction.y,
				direction.z,
				light.intensity,
				light.color.r,
				light.color.g,
				light.color.b,
			].every(Number.isFinite) ||
			light.intensity < 0
		) throw new Error('[ModelManager][Crystal] actual scene light is invalid');

		crystalEditorDirectionToNative(direction.normalize(), nativeLightDirection);
		color.copy(light.color).multiplyScalar(light.intensity);
		nativeLightColor.set(color.r, color.g, color.b);
	};

	updateLight();

	const uniforms = {
		crystalPreviewShadowMap: { value: null as Texture | null },
		crystalPreviewShadowMatrix: { value: new Matrix4() },
		crystalPreviewShadowSize: { value: new Vector2() },
		crystalPreviewShadowBias: { value: light.shadow.bias },
		crystalPreviewNormalBias: { value: light.shadow.normalBias },
		crystalPreviewShadowRadius: { value: light.shadow.radius },
		crystalPreviewShadowIntensity: { value: light.shadow.intensity },
	};

	const reversed = renderer.capabilities.reversedDepthBuffer;
	const defines = [
		shadowType === PCFShadowMap ? '#define CRYSTAL_PREVIEW_PCF' : '',
		shadowType === VSMShadowMap ? '#define CRYSTAL_PREVIEW_VSM' : '',
		reversed ? '#define CRYSTAL_PREVIEW_REVERSED_DEPTH' : '',
	].join('\n');

	const shadow: TranslucentCrystalPreviewShadow = {
		kind: 'editor-directional-shadow',
		programKey: `editor-shadow-${shadowType}-${reversed}`,
		uniforms,
		vertexDeclarations:
			'uniform mat4 crystalPreviewShadowMatrix;\nuniform float crystalPreviewNormalBias;\nvarying vec4 vCrystalPreviewShadowCoord;\n',
		vertexBody: /* glsl */ `
vec4 crystalPreviewWorld=vec4(transformed,1.0);
#ifdef USE_INSTANCING
crystalPreviewWorld=instanceMatrix*crystalPreviewWorld;
#endif
crystalPreviewWorld=modelMatrix*crystalPreviewWorld;
vec3 crystalPreviewWorldNormal=inverseTransformDirection(transformedNormal,viewMatrix);
vCrystalPreviewShadowCoord=crystalPreviewShadowMatrix*(crystalPreviewWorld+vec4(crystalPreviewWorldNormal*crystalPreviewNormalBias,0.0));
`,
		fragment: [
			defines,
			'varying vec4 vCrystalPreviewShadowCoord;',
			`uniform ${shadowType === PCFShadowMap ? 'sampler2DShadow' : 'sampler2D'} crystalPreviewShadowMap;`,
			'uniform vec2 crystalPreviewShadowSize;',
			'uniform float crystalPreviewShadowBias,crystalPreviewShadowRadius,crystalPreviewShadowIntensity;',
			crystalPreviewShadowKernel(),
			'float crystalPreviewShadow() {',
			'return crystalPreviewGetShadow(crystalPreviewShadowMap,crystalPreviewShadowSize,crystalPreviewShadowIntensity,crystalPreviewShadowBias,crystalPreviewShadowRadius,vCrystalPreviewShadowCoord);',
			'}',
		].join('\n'),

		update(currentRenderer, currentScene, _camera, object) {
			if (
				currentRenderer !== renderer ||
				currentScene !== scene ||
				renderer.shadowMap.type !== shadowType ||
				renderer.capabilities.reversedDepthBuffer !== reversed ||
				!renderer.shadowMap.enabled ||
				directionalLight(scene, light) !== light
			) throw new Error('[ModelManager][Crystal] preview renderer/scene/shadow contract changed');
			// This custom source core samples its own renderer map. The stock Three
			// receiveShadow flag controls a different shader path, not this sampler.
			updateLight();

			const map = light.shadow.map;
			const texture = map?.texture.format === RGFormat ? map.texture : (map?.depthTexture ?? map?.texture);
			if (
				!map ||
				!texture ||
				(shadowType === PCFShadowMap &&
					(!map.depthTexture || map.depthTexture.compareFunction === null))
			) throw new Error('[ModelManager][Crystal] actual generated renderer shadow texture required');

			uniforms.crystalPreviewShadowMap.value = texture;
			uniforms.crystalPreviewShadowMatrix.value.copy(light.shadow.matrix);
			uniforms.crystalPreviewShadowSize.value.set(map.width, map.height);
			uniforms.crystalPreviewShadowBias.value = light.shadow.bias;
			uniforms.crystalPreviewNormalBias.value = light.shadow.normalBias;
			uniforms.crystalPreviewShadowRadius.value = light.shadow.radius;
			uniforms.crystalPreviewShadowIntensity.value = light.shadow.intensity;

			const targetAlpha = applyCrystalPreviewTargetAlpha(material, renderer);
			material.userData.translucentCrystalPreview = {
				domain,
				lightUuid: light.uuid,
				lightPosition: position.toArray(),
				targetPosition: target.toArray(),
				nativeLightDirection: nativeLightDirection.toArray(),
				linearLightColorIntensity: nativeLightColor.toArray(),
				shadow: {
					kind: 'renderer-map-per-fragment',
					textureUuid: texture.uuid,
					mapSize: [map.width, map.height],
					type: shadowType,
					bias: light.shadow.bias,
					normalBias: light.shadow.normalBias,
					intensity: light.shadow.intensity,
					matrix: light.shadow.matrix.toArray(),
					rendererFrame: renderer.info.render.frame,
					stockReceiveShadow: object.receiveShadow,
					consumer: 'crystal-owned-per-fragment-renderer-map',
				},
				targetAlpha,
				worldFrame: 'UE-world-to-editor-parentFlip-X-negY-Z',
				approximation:
					'editor-linked preview light and renderer visibility; static collection defaults, not live UE lighting',
			};
		},
	};

	const lighting: TranslucentCrystalLighting = {
		nativeLightDirection,
		nativeLightColor,
		shadow,
		dayNight: domain.dayNight,
		jewelryStrength: domain.jewelryStrength,
		materialTextureMipBias: domain.materialTextureMipBias,
	};

	const material = createTranslucentCrystalMaterial(profile, sources, lighting);
	return material;
}

/** Material loading precedes Tres scene readiness. Bind the actual draw's own
 * renderer/scene on its first draw, before WebGLRenderer requests its program. */
export function createDeferredTranslucentCrystalPreviewMaterial(
	profile: FurnitureTranslucentCrystal,
	sources: Partial<Record<string, Texture | null>>,
): MeshBasicMaterial {
	if (!readTranslucentCrystalPreviewDomain(profile.preview)) throw new Error('[ModelManager][Crystal] source preview domain missing');

	for (const role of Object.keys(profile.textures)) {
		if (!sources[role]) throw new Error(`[ModelManager][Crystal] actual ${role} texture missing`);
	}

	const deferred = new MeshBasicMaterial({
		transparent: true,
		depthWrite: false,
		blending: CustomBlending,
		blendEquation: AddEquation,
		blendSrc: SrcAlphaFactor,
		blendDst: OneMinusSrcAlphaFactor,
		blendEquationAlpha: AddEquation,
		blendSrcAlpha: ZeroFactor,
		blendDstAlpha: OneMinusSrcAlphaFactor,
		forceSinglePass: true,
	});
	deferred.userData.translucentCrystal = profile;

	let current: MeshBasicMaterial | undefined;
	let binding: { renderer: WebGLRenderer; scene: Scene; shadowType: number } | undefined;
	deferred.customProgramCacheKey = () => 'crystal-preview-awaiting-actual-draw-context';

	const finalize: MeshBasicMaterial['onBeforeRender'] = (...args) => {
		if (
			current &&
			(binding?.renderer !== args[0] ||
				binding?.scene !== args[1] ||
				binding?.shadowType !== args[0].shadowMap.type)
		) {
			current.dispose();
			current = undefined;
		}

		if (!current) {
			current = createTranslucentCrystalPreviewMaterial(profile, sources, {
				renderer: args[0],
				scene: args[1],
				domain: profile.preview!,
			});
			current.side = deferred.side;
			current.name = deferred.name;

			const userData = deferred.userData;
			const visible = deferred.visible;
			const toneMapped = deferred.toneMapped;
			deferred.copy(current);
			deferred.defines = { ...current.defines };
			deferred.visible = visible;
			deferred.toneMapped = toneMapped;
			deferred.userData = { ...userData, ...current.userData };
			current.userData = deferred.userData;
			deferred.onBeforeCompile = current.onBeforeCompile;
			deferred.customProgramCacheKey = current.customProgramCacheKey;
			deferred.needsUpdate = true;
			binding = { renderer: args[0], scene: args[1], shadowType: args[0].shadowMap.type };
		}
	};

	registerMaterialFinalizer(deferred, finalize);
	deferred.onBeforeRender = (...args) => {
		finalize(...args);
		Reflect.apply(current!.onBeforeRender, current!, args);
		deferred.blendSrcAlpha = current!.blendSrcAlpha;
		deferred.blendDstAlpha = current!.blendDstAlpha;
	};
	deferred.addEventListener('dispose', () => current?.dispose());
	return deferred;
}
