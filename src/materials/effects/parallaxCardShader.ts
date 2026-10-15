import {
	ClampToEdgeWrapping,
	DoubleSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshBasicMaterial,
	MirroredRepeatWrapping,
	NearestFilter,
	NearestMipmapNearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Matrix3,
	Vector2,
	Vector3,
	Vector4,
	type Texture,
} from 'three';
import {
	parallaxCardNativeCore,
	type ParallaxCardColors,
	type ParallaxCardRuntime,
} from './parallaxCardSource.js';
import { parallaxCardBasisV2Contract } from './parallaxCardBasisV2.js';

interface CardTexture {
	parameter: string
	sRGB: boolean
	rgbScale: number
	addressX: string
	addressY: string
	mipmaps: boolean
	nearest: boolean
	cube: boolean
}

export interface FurnitureParallaxCard {
	current?: {
		uniforms: number[][]
		vertexFactory: 'FLocalVertexFactory' | 'TGPUSkinVertexFactoryDefault'
	}
	version: number
	family: string
	geometry: string
	coverage: string
	sourceOutputBound: number
	nativeViewClamp: string
	outputBoundProof: string
	scalars: Record<string, number>
	colors: ParallaxCardColors
	textures: Record<string, CardTexture>
	preview: string
	basisV2?: {
		contract: string
		contractSha256: string
		sourceModelSha256: string
		pixelShader: string
		vertexShader: string
		frame: string
	}
}

export function parallaxCardOutputBound(p: FurnitureParallaxCard): number {
	const noise = p.scalars['Noise Intensity']!;
	const selection = p.colors.SelectionColor;
	if (!Number.isFinite(noise) || noise < 0 || selection[3]! < 0 || selection[3]! > 1) throw new Error('[ModelManager][ParallaxCard] multiplier range unproved');

	let bound = 0;
	for (let i = 0; i < 3; i++) {
		const values = [
			'Emissive Base Color',
			'Emissive Base Color Night',
			'Emissive BG Color',
			'Emissive BG Color Night',
			'Emissive Character Color',
			'Emissive Character Color Night',
			'CharacterColor',
			'SelectionColor',
		].map((key) => p.colors[key as keyof ParallaxCardColors]?.[i]);
		if (values.some((x) => typeof x !== 'number' || !Number.isFinite(x) || x < 0)) throw new Error('[ModelManager][ParallaxCard] colour range unproved');

		const bg = Math.max(values[0]!, values[1]!) + Math.max(values[2]!, values[3]!);
		const fg = (Math.max(values[4]!, values[5]!) + 1) * noise * values[6]!;
		bound = Math.max(bound, Math.max(bg, fg) * (1 - selection[3]!) + selection[i]! * selection[3]!);
	}

	return bound;
}

export function readFurnitureParallaxCard(value: unknown): FurnitureParallaxCard | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureParallaxCard;
	if (p.version === 3) {
		const current = p.current;
		return p.family === 'parallax-card' &&
			p.geometry === 'parallax-card-current-native-frame-v3' &&
			p.coverage === 'native-mask-constant-one-not-character-alpha' &&
			current &&
			Number.isFinite(p.sourceOutputBound) &&
			p.sourceOutputBound >= 0 &&
			p.nativeViewClamp === 'editor-source-bound-times-pre-exposure' &&
			['FLocalVertexFactory', 'TGPUSkinVertexFactoryDefault'].includes(current.vertexFactory) &&
			current.uniforms.length === 11 &&
			current.uniforms.every((row) => row.length === 4 && row.every(Number.isFinite)) &&
			['D', 'D1', 'T', 'T1', 'O'].every((role) => {
				const t = p.textures?.[role];
				return t && !t.cube && t.rgbScale === 1 && typeof t.sRGB === 'boolean';
			})
			? p
			: null;
	}

	const native1 = p.version === 1 && p.geometry === 'native-parallax-card-bind-basis-v1' && !p.basisV2;
	const native2 =
		p.version === 2 &&
		p.geometry === parallaxCardBasisV2Contract &&
		p.basisV2?.contract === parallaxCardBasisV2Contract &&
		p.basisV2.frame === 'source-native-snorm8-with-explicit-reference-bind-rows';
	if (
		(!native1 && !native2) ||
		p.family !== 'parallax-card' ||
		p.coverage !== 'native-mask-constant-one-not-character-alpha' ||
		p.sourceOutputBound !== 6 ||
		p.nativeViewClamp !== 'unknown-cb0[318].x' ||
		!p.scalars ||
		!p.colors ||
		!p.textures
	) return null;

	const roles = {
		D: 'T_BG',
		D1: 'T_Character',
		T: 'T_Emissive_BG',
		T1: 'T_Emissive_Character',
		O: 'T_Noise',
	};

	if (
		Object.keys(p.textures).length !== 5 ||
		Object.entries(roles).some(([role, key]) => {
			const t = p.textures[role];
			return (
				!t ||
				t.parameter !== key ||
				t.cube ||
				t.rgbScale !== 1 ||
				typeof t.sRGB !== 'boolean' ||
				typeof t.mipmaps !== 'boolean' ||
				typeof t.nearest !== 'boolean'
			);
		})
	) return null;

	const keys = [
		'Tiling BG',
		'Depth BG',
		'Tiling Character',
		'Depth',
		'Offset X Character',
		'Offset Y Character',
		'X Noise Speed',
		'Y Noise Speed',
		'Noise Intensity',
	];

	if (
		keys.some((key) => !Number.isFinite(p.scalars[key])) ||
		Object.values(p.colors).some((color) => !Array.isArray(color) || color.length !== 4 || !color.every(Number.isFinite))
	) return null;

	try {
		return parallaxCardOutputBound(p) === 6 ? p : null;
	} catch {
		return null;
	}
}

const address = (value: string) => {
	switch (value) {
	case 'TA_Wrap':
		return RepeatWrapping;
	case 'TA_Clamp':
		return ClampToEdgeWrapping;
	case 'TA_Mirror':
		return MirroredRepeatWrapping;
	default:
		throw new Error('[ModelManager][ParallaxCard] unproved native address');
	}
};

/** Low-level caller supplies native View inputs explicitly. Preview's proven
 * sourceOutputBound is separate from the unknown fork View clamp. */
export function createParallaxCardMaterial(
	p: FurnitureParallaxCard,
	sources: Partial<Record<string, Texture | null>>,
	runtime: ParallaxCardRuntime,
	update: (...args: Parameters<MeshBasicMaterial['onBeforeRender']>) => void,
): MeshBasicMaterial {
	if (!readFurnitureParallaxCard(p)) throw new Error('[ModelManager][ParallaxCard] native source profile required');
	if (p.version === 3) return createCurrentParallaxCardMaterial(p, sources, runtime, update);

	return createParallaxCardMaterialUnchecked(p, sources, runtime, update);
}

function createParallaxCardMaterialUnchecked(
	p: FurnitureParallaxCard,
	sources: Partial<Record<string, Texture | null>>,
	runtime: ParallaxCardRuntime,
	update: MeshBasicMaterial['onBeforeRender'],
): MeshBasicMaterial {
	const textures: Record<string, Texture> = {};
	for (const [role, contract] of Object.entries(p.textures)) {
		const source = sources[role];
		if (!source || !source.isTexture) throw new Error(`[ModelManager][ParallaxCard] actual ${role} texture required`);

		const texture = source.clone();
		texture.colorSpace = contract.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = address(contract.addressX);
		texture.wrapT = address(contract.addressY);
		texture.generateMipmaps = contract.mipmaps;
		texture.magFilter = contract.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = contract.mipmaps
			? contract.nearest
				? NearestMipmapNearestFilter
				: LinearMipmapLinearFilter
			: texture.magFilter;
		texture.needsUpdate = true;
		textures[role] = texture;
	}

	const material = new MeshBasicMaterial({
		side: DoubleSide,
		transparent: false,
		depthWrite: true,
		depthTest: true,
		alphaTest: 0,
	});
	material.defines = { USE_TANGENT: '' };
	material.userData.parallaxCard = p;
	material.onBeforeRender = update;

	const uniforms: Record<string, { value: unknown }> = {};
	if (p.version === 2) {
		// No identity/default frame: the exact source-native draw proof supplies it.
		uniforms.cardSourceToGeometry = { value: new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0) };
		uniforms.cardSourceWindingParity = { value: 0 };
	}

	for (const [key, name] of Object.entries({
		'Tiling BG': 'cardTilingBG',
		'Depth BG': 'cardDepthBG',
		'Tiling Character': 'cardTilingCharacter',
		Depth: 'cardDepth',
		'Noise Intensity': 'cardNoiseIntensity',
	}))
		uniforms[name] = { value: p.scalars[key] };

	uniforms.cardCharacterOffset = {
		value: new Vector2(p.scalars['Offset X Character'], p.scalars['Offset Y Character']),
	};
	uniforms.cardNoiseSpeed = {
		value: new Vector2(p.scalars['X Noise Speed'], p.scalars['Y Noise Speed']),
	};
	for (const [key, name] of Object.entries({
		'Emissive Base Color': 'cardBaseDay',
		'Emissive Base Color Night': 'cardBaseNight',
		'Emissive BG Color': 'cardBGDay',
		'Emissive BG Color Night': 'cardBGNight',
		'Emissive Character Color': 'cardCharacterDay',
		'Emissive Character Color Night': 'cardCharacterNight',
		CharacterColor: 'cardCharacterColor',
	})) {
		uniforms[name] = { value: new Vector3().fromArray(p.colors[key as keyof ParallaxCardColors]) };
	}

	uniforms.cardSelectionColor = { value: new Vector4().fromArray(p.colors.SelectionColor) };
	for (const [role, texture] of Object.entries(textures))
		uniforms[`card${role}`] = { value: texture };

	const refresh = () => {
		for (const [name, key] of Object.entries({
			cardGameTime: 'gameTime',
			cardSwapLightFactor: 'swapLightFactor',
			cardMipBias: 'materialTextureMipBias',
			cardPreExposure: 'preExposure',
			cardOutputClamp: 'outputClamp',
			cardNativeCullingSign: 'nativeCullingSign',
			cardNativePrimitiveDeterminantSign: 'nativePrimitiveDeterminantSign',
			cardNativeFrontFaceParity: 'nativeFrontFaceParity',
		})) {
			if (uniforms[name]) uniforms[name]!.value = runtime[key as keyof ParallaxCardRuntime];
			else uniforms[name] = { value: runtime[key as keyof ParallaxCardRuntime] };
		}
	};

	material.userData.parallaxCardUniforms = uniforms;
	material.userData.parallaxCardRefreshUniforms = refresh;
	refresh();
	material.onBeforeCompile = (shader) => {
		refresh();
		Object.assign(shader.uniforms, uniforms);

		const varyings = 'varying vec3 vCardPosition,vCardNormal,vCardTangent; varying float vCardHandedness,vCardInstanceSign; varying vec2 vCardUV;';
		const nativeBasisDeclarations =
			p.version === 2
				? 'attribute vec4 cardRHITangentX; attribute vec3 cardRHINormalZ,cardRHIBindRow0,cardRHIBindRow1,cardRHIBindRow2; uniform mat3 cardSourceToGeometry; uniform float cardSourceWindingParity;'
				: '';
		const nativeBasis =
			p.version === 2
				? `
vec3 cardSkinN=vec3(dot(cardRHIBindRow0,cardRHINormalZ),dot(cardRHIBindRow1,cardRHINormalZ),dot(cardRHIBindRow2,cardRHINormalZ));
vec3 cardSkinT=vec3(dot(cardRHIBindRow0,cardRHITangentX.xyz),dot(cardRHIBindRow1,cardRHITangentX.xyz),dot(cardRHIBindRow2,cardRHITangentX.xyz));
vCardNormal=mat3(viewMatrix)*cardUnscaled*cardSourceToGeometry*normalize(cardSkinN);
vCardTangent=mat3(viewMatrix)*cardUnscaled*cardSourceToGeometry*normalize(cardSkinT);
vCardHandedness=cardRHITangentX.w*cardSourceWindingParity*sign(determinant(mat3(cardWorld)));`
				: `
vCardNormal=mat3(viewMatrix)*cardUnscaled*normalize(normal);
vCardTangent=mat3(viewMatrix)*cardUnscaled*normalize(tangent.xyz);
vCardHandedness=tangent.w*sign(determinant(mat3(cardWorld)));`;
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${varyings}\n${nativeBasisDeclarations}`)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
mat4 cardWorld=modelMatrix;
vCardInstanceSign=1.0;
#ifdef USE_INSTANCING
cardWorld=cardWorld*instanceMatrix;
vCardInstanceSign=sign(determinant(mat3(instanceMatrix)));
#endif
mat3 cardUnscaled=mat3(normalize(cardWorld[0].xyz),normalize(cardWorld[1].xyz),normalize(cardWorld[2].xyz));
${nativeBasis}
vCardPosition=mvPosition.xyz;vCardUV=uv;`,
			);

		const declarations = [
			varyings,
			'uniform sampler2D cardD,cardD1,cardT,cardT1,cardO;',
			'uniform vec3 cardBaseDay,cardBaseNight,cardBGDay,cardBGNight,cardCharacterDay,cardCharacterNight,cardCharacterColor;',
			'uniform vec4 cardSelectionColor;',
			'uniform vec2 cardCharacterOffset,cardNoiseSpeed;',
			'uniform float cardTilingBG,cardDepthBG,cardTilingCharacter,cardDepth,cardNoiseIntensity;',
			'uniform float cardGameTime,cardSwapLightFactor,cardMipBias,cardPreExposure,cardOutputClamp,cardNativeCullingSign,cardNativePrimitiveDeterminantSign,cardNativeFrontFaceParity;',
		].join('\n');
		const core = parallaxCardNativeCore.replace(
			'cardNativePrimitiveDeterminantSign*face',
			'cardNativePrimitiveDeterminantSign*vCardInstanceSign*face',
		);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${declarations}\n${core}`)
			.replace(
				'#include <map_fragment>',
				`vec3 cardView=isOrthographic?vec3(0,0,1):normalize(-vCardPosition);
diffuseColor=parallaxCardNativeColor(vCardUV,vCardTangent,-cardNativeCullingSign*cross(vCardNormal,vCardTangent)*vCardHandedness,vCardNormal,cardView);`,
			)
			.replace('#include <color_fragment>', '')
			.replace('#include <alphamap_fragment>', '')
			.replace('#include <alphatest_fragment>', '');
	};
	material.customProgramCacheKey = () =>
		p.version === 2
			? 'parallax-card-native-2:source-rhi-snorm8:explicit-bind-rows:actor-scale-removed:instance-facing-v2'
			: 'parallax-card-native-1:source-normalized-five:actor-scale-removed:instance-facing-v1';
	material.addEventListener('dispose', () => Object.values(textures).forEach((texture) => texture.dispose()));
	return material;
}

/** Current LocalVF does not normalize its cross/cross frame. GPUSkin normalizes
 * the weighted bone result once, before interpolation. These attributes carry
 * that result after source-node baking, rather than the generic GLTF normals. */
function createCurrentParallaxCardMaterial(
	p: FurnitureParallaxCard,
	sources: Partial<Record<string, Texture | null>>,
	runtime: ParallaxCardRuntime,
	update: MeshBasicMaterial['onBeforeRender'],
): MeshBasicMaterial {
	const u = p.current!.uniforms;

	const equivalent: FurnitureParallaxCard = {
		...p,
		scalars: {
			'Tiling BG': u[0]![0]!,
			'Depth BG': u[0]![1]!,
			'Tiling Character': u[6]![3]!,
			Depth: u[7]![0]!,
			'Offset X Character': u[7]![1]!,
			'Offset Y Character': u[7]![2]!,
			'X Noise Speed': u[7]![3]!,
			'Y Noise Speed': u[8]![0]!,
			'Noise Intensity': u[8]![1]!,
		},
		colors: {
			'Emissive Base Color': u[2]!,
			'Emissive Base Color Night': u[1]!,
			'Emissive BG Color': u[4]!,
			'Emissive BG Color Night': u[3]!,
			'Emissive Character Color': u[6]!,
			'Emissive Character Color Night': u[5]!,
			CharacterColor: u[9]!,
			SelectionColor: [u[10]![0]!, u[10]![1]!, u[10]![2]!, u[9]![3]!],
		},
	};
	// The core's parameter names are shared, not the historical admission or its
	// fixed colour bound. A current source can legitimately have a different bound.
	const material = createParallaxCardMaterialUnchecked(equivalent, sources, runtime, update);
	if (material.defines) delete material.defines.USE_TANGENT;
	material.userData.parallaxCard = p;

	const previous = material.onBeforeCompile;
	material.onBeforeCompile = (shader, renderer) => {
		previous(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace(
				'varying vec3 vCardPosition,vCardNormal,vCardTangent;',
				'attribute vec4 cardNativeTangent; attribute vec3 cardNativeNormal; varying vec3 vCardPosition,vCardNormal,vCardTangent;',
			)
			.replace('cardUnscaled*normalize(normal)', 'cardUnscaled*cardNativeNormal')
			.replace('cardUnscaled*normalize(tangent.xyz)', 'cardUnscaled*cardNativeTangent.xyz')
			.replace(
				'tangent.w*sign(determinant(mat3(cardWorld)))',
				'cardNativeTangent.w*sign(determinant(mat3(cardWorld)))',
			);
		shader.fragmentShader = shader.fragmentShader.replace(
			'-cardNativeCullingSign*cross(vCardNormal,vCardTangent)',
			'cross(vCardNormal,vCardTangent)',
		);
	};
	material.customProgramCacheKey = () => 'parallax-card-current-native-frame-v3';
	return material;
}
