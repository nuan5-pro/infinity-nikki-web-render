import {
	Color,
	LinearFilter,
	LinearMipmapLinearFilter,
	Matrix4,
	MeshStandardMaterial,
	NoColorSpace,
	RepeatWrapping,
	ShaderChunk,
	SRGBColorSpace,
	type BufferGeometry,
	type InstancedMesh,
	type Material,
	type Texture,
} from 'three';
import type { FurnitureLayered, LayeredRole } from './layeredShader.js';
import {
	rockProjectionEditorCore,
	rockProjectionEditorUniformDeclarations,
	rockProjectionEditorUniforms,
	validRockProjectionEditor,
} from './layeredRockProjectionEditorShader.js';
import { createRockProjectionCollectionTexture } from './rockProjectionCollectionTexture.js';
import {
	assertRockProjectionDrawFrame,
	assertRockProjectionRawCarriers,
	ROCK_PROJECTION_RAW_NORMAL,
	ROCK_PROJECTION_RAW_TANGENT,
} from './rockProjectionRawBasis.js';
import {
	createRockProjectionTopArray,
	ROCK_PROJECTION_TOP_ROLES,
} from './rockProjectionTopArrayTexture.js';
import { nativeWorldFrameGLSL } from '../nativeWorldFrame.js';

const roles: LayeredRole[] = ['D', 'N', 'O', 'T', 'D1', 'N1', 'O1', 'B', 'C', 'M', 'D2', 'N2', 'O2'];
const worldDeclaration = `
varying vec2 vLayerUv0;
varying vec4 vLayerColor;
varying vec3 vLayerWorldPosition;
varying vec3 vLayerObjectOrientation;
varying float vLayerWorldParity;
${nativeWorldFrameGLSL}
`;
const helpers = `
vec3 layeredNormal;
float layeredRoughness;
float layeredMetal;
float layeredOcclusion;
vec3 layeredEmission;
vec3 layeredRG(vec4 value, float intensity, float zIntensity) {
  vec2 rg = value.rg * 2.0 - 1.0;
  return vec3(rg * intensity, sqrt(max(1.0 - dot(rg * zIntensity, rg * zIntensity), 0.0)));
}
vec3 layeredRNM(vec3 base, vec3 overlay) {
  vec3 t = base + vec3(0.0, 0.0, 1.0);
  vec3 u = overlay * vec3(-1.0, -1.0, 1.0);
  return t * dot(t, u) - u * t.z;
}
vec3 layeredSrgbDecode(vec3 value) {
  return mix(value / 12.92, pow(max((value + 0.055) / 1.055, vec3(0.0)), vec3(2.4)), step(vec3(0.04045), value));
}
`;

export function createRockProjectionEditorMaterial(
	config: FurnitureLayered,
	inputs: Partial<Record<LayeredRole, Texture | null>>,
	source: Material,
): MeshStandardMaterial {
	const editor = config.projection?.editor;
	if (!validRockProjectionEditor(editor)) throw new Error('[RockProjectionEditor] exact editor contract missing');

	const collection = createRockProjectionCollectionTexture(editor.collection.payload);
	const owned: Partial<Record<LayeredRole, Texture>> = {};
	let top: ReturnType<typeof createRockProjectionTopArray> | undefined;
	try {
		top = createRockProjectionTopArray(config, inputs, source.userData);
		for (const role of roles) {
			if (ROCK_PROJECTION_TOP_ROLES.some((topRole) => topRole === role)) continue;
			const descriptor = config.textures[role];
			if (!descriptor) throw new Error(`[RockProjectionEditor] active role ${role} missing`);

			if (descriptor.constant) continue;
			const input = inputs[role];
			if (!input) throw new Error(`[RockProjectionEditor] source texture ${role} missing`);
			if (
				descriptor.addressX !== 'TA_Wrap' ||
				descriptor.addressY !== 'TA_Wrap' ||
				descriptor.filter !== 'TF_Default'
			) throw new Error('[RockProjectionEditor] unsupported captured sampler policy');

			const texture = input.clone();
			texture.channel = 0;
			texture.colorSpace = descriptor.srgb ? SRGBColorSpace : NoColorSpace;
			texture.wrapS = texture.wrapT = RepeatWrapping;
			texture.minFilter = descriptor.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
			texture.magFilter = LinearFilter;
			texture.needsUpdate = true;
			owned[role] = texture;
		}
	} catch (error) {
		top?.dispose();
		collection.dispose();
		Object.values(owned).forEach((texture) => texture.dispose());
		throw error;
	}

	if (!top) throw new Error('[RockProjectionEditor] preview top array missing');

	const topArray = top;
	const material = new MeshStandardMaterial({
		color: new Color(1, 1, 1),
		map: owned.D,
		normalMap: owned.N,
		aoMap: owned.O,
		roughness: 1,
		metalness: 1,
		vertexColors: false,
		transparent: false,
		opacity: 1,
		side: source.side,
		forceSinglePass: true,
	});
	material.name = source.name;
	material.userData = { ...source.userData, layered: config };
	material.depthTest = source.depthTest;
	material.colorWrite = source.colorWrite;
	material.toneMapped = source.toneMapped;
	material.visible = source.visible;

	let released = false;
	material.addEventListener('dispose', () => {
		if (released) return;

		released = true;
		topArray.dispose();
		collection.dispose();
		Object.values(owned).forEach((texture) => texture.dispose());
	});

	const checked = new WeakMap<
		BufferGeometry,
		{ proof: object; normalVersion: number; tangentVersion: number }
	>();
	material.onBeforeRender = (renderer, _scene, _camera, geometry, object) => {
		assertRockProjectionDrawFrame(object.matrixWorld);

		const instanced = object as InstancedMesh;
		if (instanced.isInstancedMesh) {
			const instance = new Matrix4();
			for (let index = 0; index < instanced.count; index++) {
				instanced.getMatrixAt(index, instance);
				assertRockProjectionDrawFrame(new Matrix4().multiplyMatrices(object.matrixWorld, instance));
			}
		}

		if ('isBatchedMesh' in object && object.isBatchedMesh) throw new Error('[RockProjectionEditor] batching frame has no reviewed actual-draw proof');

		const proof = geometry.userData.ueProjectionRawBasisProof;
		const count = geometry.getAttribute('position')?.count;
		if (
			!proof ||
			proof.contract !== 'rock-projection-vm-raw-basis-1' ||
			!count ||
			(proof.bakeParity !== 1 && proof.bakeParity !== -1) ||
			geometry.getAttribute('ueLayerColor')?.itemSize !== 4 ||
			!geometry.getAttribute('uv')
		) throw new Error('[RockProjectionEditor] actual draw has no independently proven original basis/colour/UV frame');

		for (const [name, size] of [
			[ROCK_PROJECTION_RAW_NORMAL, 3],
			[ROCK_PROJECTION_RAW_TANGENT, 4],
		] as const) {
			const attribute = geometry.getAttribute(name);
			if (
				!attribute ||
				attribute.count !== count ||
				attribute.itemSize !== size ||
				attribute.normalized ||
				!(attribute.array instanceof Float32Array)
			) throw new Error(`[RockProjectionEditor] actual draw raw carrier ${name} missing`);
		}

		const normal = geometry.getAttribute(ROCK_PROJECTION_RAW_NORMAL);
		const tangent = geometry.getAttribute(ROCK_PROJECTION_RAW_TANGENT);
		const normalVersion = 'data' in normal ? normal.data.version : normal.version;
		const tangentVersion = 'data' in tangent ? tangent.data.version : tangent.version;
		const previous = checked.get(geometry);
		if (
			!previous ||
			previous.proof !== proof ||
			previous.normalVersion !== normalVersion ||
			previous.tangentVersion !== tangentVersion
		) {
			assertRockProjectionRawCarriers(geometry);
			checked.set(geometry, { proof, normalVersion, tangentVersion });
		}

		topArray.ensure(renderer);
	};

	const sample = (role: LayeredRole, uv: string, bias?: string): string => {
		const descriptor = config.textures[role];
		if (!descriptor) throw new Error(`[RockProjectionEditor] undeclared consumer ${role}`);
		if (ROCK_PROJECTION_TOP_ROLES.some((topRole) => topRole === role)) return `texture(rockProjectionTopArray, vec3(${uv}, ${descriptor.slice}.0)${bias ? `, ${bias}` : ''})`;

		return descriptor.constant
			? `vec4(${descriptor.constant.map((value) => value.toFixed(12)).join(', ')})`
			: `texture2D(layered${role}, ${uv}${bias ? `, ${bias}` : ''})`;
	};

	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, rockProjectionEditorUniforms(editor));
		shader.uniforms.rockProjectionCollectionTexture = { value: collection };
		shader.uniforms.rockProjectionTopArray = { value: topArray.texture };
		for (const role of roles)
			if (owned[role]) shader.uniforms[`layered${role}`] = { value: owned[role] };

		const declarations =
			'uniform highp sampler2DArray rockProjectionTopArray;\n' +
			roles
				.filter((role) => owned[role])
				.map((role) => `uniform sampler2D layered${role};`)
				.join('\n');
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>\n${worldDeclaration}\n${rockProjectionEditorUniformDeclarations}\nattribute vec4 ueLayerColor;\nattribute vec3 ${ROCK_PROJECTION_RAW_NORMAL};\nattribute vec4 ${ROCK_PROJECTION_RAW_TANGENT};`,
			)
			.replace(
				'#include <project_vertex>',
				`#include <project_vertex>
mat4 projectionWorld = modelMatrix;
#ifdef USE_INSTANCING
projectionWorld = projectionWorld * instanceMatrix;
#endif
#ifdef USE_BATCHING
projectionWorld = projectionWorld * batchingMatrix;
#endif
mat3 projectionAxes = furnitureUnscaledBasis(projectionWorld);
vLayerWorldParity = sign(dot(cross(projectionAxes[0], projectionAxes[1]), projectionAxes[2]));
vProjectionRawNormal = furnitureNativeWorld(projectionAxes * ${ROCK_PROJECTION_RAW_NORMAL});
vProjectionRawTangent = furnitureNativeWorld(projectionAxes * ${ROCK_PROJECTION_RAW_TANGENT}.xyz);
// Raw carrier w already includes the GLB bake reflection. World-to-native
// adds the other reflection, leaving the actual draw determinant here.
vProjectionRawHandedness = vLayerWorldParity * ${ROCK_PROJECTION_RAW_TANGENT}.w;
vLayerWorldPosition = furnitureNativeWorld((projectionWorld * vec4(transformed, 1.0)).xyz);
vLayerObjectOrientation = normalize(furnitureNativeWorld(projectionWorld[2].xyz));
vLayerUv0 = uv;
vLayerColor = ueLayerColor;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>\n${worldDeclaration}\n${rockProjectionEditorUniformDeclarations}\n${declarations}\n${helpers}`,
			)
			.replace(
				'#include <map_fragment>',
				`float layeredSpecularValue = 0.5;\n${rockProjectionEditorCore(sample)}\ndiffuseColor.a = 1.0;`,
			)
			.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = layeredRoughness;')
			.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = layeredMetal;')
			.replace(
				'#include <normal_fragment_maps>',
				ShaderChunk.normal_fragment_maps.replace(
					'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
					'vec3 mapN = layeredNormal; mapN.y *= -vLayerWorldParity;',
				),
			)
			.replace(
				'#include <aomap_fragment>',
				ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'layeredOcclusion'),
			)
			.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = layeredEmission;')
			.replace(
				'#include <lights_physical_fragment>',
				ShaderChunk.lights_physical_fragment.replace(
					'material.specularColor = vec3( 0.04 );',
					'material.specularColor = vec3(0.08 * clamp(layeredSpecularValue, 0.0, 1.0));',
				),
			);
	};
	// Only inlined constants and array slices change generated shader source;
	// collection bytes and the remaining material values are runtime uniforms.
	const samplingKey = JSON.stringify(
		roles.map((role) => [
			role,
			config.textures[role]?.constant ?? null,
			config.textures[role]?.slice ?? null,
		]),
	);
	material.customProgramCacheKey = () => `furniture_rock_projection_editor_v5_native_world_${samplingKey}`;
	return material;
}
