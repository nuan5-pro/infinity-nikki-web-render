import {
	DirectionalLight,
	InstancedMesh,
	Matrix3,
	Matrix4,
	Vector3,
	type Camera,
	type Object3D,
	type Scene,
	type WebGLRenderer,
} from 'three';
import {
	jewelryMaskedComponentWorldBounds,
	jewelryMaskedTileOffsetRows,
	type JewelryMaskedComponentBounds,
} from './jewelryMaskedBounds.js';
import { jewelryMaskedDistanceBlend, jewelryMaskedEditorLight } from './jewelryMaskedRuntime.js';
import type {
	JewelryMaskedDrawInput,
	JewelryMaskedMaterialOptions,
	JewelryMaskedPreviewInputs,
	JewelryMaskedSourceContract,
} from './jewelryMaskedShader.js';

export interface JewelryMaskedPreviewFrame {
	/** Reviewed source-frame/bounds identity; an absent affine never means identity. */
	frameProofSha256: string
	runtimeProofSha256: string
	sourceModelSha256: string
	geometryCaptureSha256: string
	editorWorldToSourceWorldCM: readonly number[]
	componentBounds: JewelryMaskedComponentBounds
}

export interface JewelryMaskedPreviewDrawProof {
	runtimeProofSha256: string
	sourceModelSha256: string
	geometryCaptureSha256: string
	beforeBake: true
	sourceCMToGeometry: readonly number[]
}

export interface JewelryMaskedPreviewContext {
	renderer: WebGLRenderer
	scene: Scene
	light: DirectionalLight
	targetOwnership: 'scene-owned' | 'actual-unparented-light-target'
	/** Supplied editor clock, never cb150.z or a synthesized live UE value. */
	editorClockSeconds: () => number
}

const sha = (value: string) => /^[a-f0-9]{64}$/.test(value);
const finite = (values: readonly number[]) => values.every(Number.isFinite);
const sealedFrames = new WeakMap<JewelryMaskedPreviewFrame, { sha256: string; identity: string }>();

const frameIdentity = (frame: JewelryMaskedPreviewFrame) =>
	JSON.stringify([
		frame.frameProofSha256,
		frame.runtimeProofSha256,
		frame.sourceModelSha256,
		frame.geometryCaptureSha256,
		frame.editorWorldToSourceWorldCM,
		frame.componentBounds,
	]);

/** Caller obtains the expected digest from the reviewed source contract, not from this JSON's self-reported identity. */
export async function readJewelryMaskedPreviewFrame(raw: ArrayBuffer, source: JewelryMaskedSourceContract): Promise<JewelryMaskedPreviewFrame> {
	if (!sha(source.previewFrameSha256) || raw.byteLength === 0 || raw.byteLength > 1024 * 1024) throw new Error('[JewelryMasked] reviewed preview frame input invalid');

	const hash = await crypto.subtle.digest('SHA-256', raw);
	const digest = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
	if (digest !== source.previewFrameSha256) throw new Error('[JewelryMasked] reviewed preview frame SHA changed');

	const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
	if (
		!parsed ||
		typeof parsed !== 'object' ||
		!('componentBounds' in parsed) ||
		!parsed.componentBounds
	) throw new Error('[JewelryMasked] reviewed whole-component frame missing');

	const frame = parsed as JewelryMaskedPreviewFrame;
	// The file cannot self-report its own SHA. Its identity is the externally
	// verified raw-byte digest; persisted source/runtime identities remain checked.
	frame.frameProofSha256 = digest;
	affine(frame.editorWorldToSourceWorldCM);
	sealedFrames.set(frame, { sha256: digest, identity: frameIdentity(frame) });
	return frame;
}

const belongsToScene = (object: Object3D, scene: Scene): boolean => {
	let ancestor: Object3D | null = object;
	while (ancestor) {
		if (ancestor === scene) return true;

		ancestor = ancestor.parent;
	}

	return false;
};

function affine(values: readonly number[]): Matrix4 {
	if (
		!Array.isArray(values) ||
		values.length !== 16 ||
		!finite(values) ||
		values[3] !== 0 ||
		values[7] !== 0 ||
		values[11] !== 0 ||
		values[15] !== 1
	) throw new Error('[JewelryMasked] verified preview affine missing');

	const matrix = new Matrix4().fromArray(values);
	if (!Number.isFinite(matrix.determinant()) || matrix.determinant() === 0) throw new Error('[JewelryMasked] singular preview affine');

	return matrix;
}

function orthogonalScale(matrix: Matrix3): number {
	const values = matrix.elements;
	const columns = [0, 1, 2].map((i) => values.slice(i * 3, i * 3 + 3));
	const scale = Math.hypot(...columns[0]!);
	if (
		!finite(values) ||
		!(scale > 0) ||
		columns.some((column) => Math.abs(Math.hypot(...column) / scale - 1) > 1e-12) ||
		columns.some(
			(column, i) =>
				Math.abs(column.reduce((sum, value, j) => sum + value * columns[(i + 1) % 3]![j]!, 0)) >
				scale * scale * 1e-12,
		)
	) throw new Error('[JewelryMasked] preview frame requires orthogonal uniform-unit transport');

	return scale;
}

/** Context-bound input provider only. Presented-frame invalidation belongs to the editor; this installs no loop or renderer wrapper. */
export function createJewelryMaskedPreviewProvider(context: JewelryMaskedPreviewContext) {
	let active = true;

	const resolve = (
		input: JewelryMaskedDrawInput,
		source: JewelryMaskedSourceContract,
		proof: JewelryMaskedPreviewDrawProof,
		frame: JewelryMaskedPreviewFrame,
	): JewelryMaskedPreviewInputs => {
		if (
			!active ||
			input.renderer !== context.renderer ||
			input.scene !== context.scene ||
			!belongsToScene(input.object, context.scene) ||
			!(context.light instanceof DirectionalLight) ||
			!belongsToScene(context.light, context.scene) ||
			!context.light.visible ||
			(context.targetOwnership === 'scene-owned'
				? !belongsToScene(context.light.target, context.scene)
				: context.targetOwnership !== 'actual-unparented-light-target' ||
					context.light.target.parent !== null)
		) throw new Error('[JewelryMasked] inactive/mismatched actual editor scene/light context');
		if (
			![
				frame.frameProofSha256,
				frame.runtimeProofSha256,
				frame.sourceModelSha256,
				frame.geometryCaptureSha256,
			].every(sha) ||
			sealedFrames.get(frame)?.sha256 !== source.previewFrameSha256 ||
			sealedFrames.get(frame)?.identity !== frameIdentity(frame) ||
			frame.frameProofSha256 !== source.previewFrameSha256 ||
			frame.componentBounds.captureSha256 !== source.componentBoundsCaptureSha256 ||
			source.runtimeProofSha256 !== proof.runtimeProofSha256 ||
			source.runtimeProofSha256 !== frame.runtimeProofSha256 ||
			(source.sourceModelSha256 !== undefined &&
				(source.sourceModelSha256 !== proof.sourceModelSha256 ||
					source.sourceModelSha256 !== frame.sourceModelSha256)) ||
			source.geometryCaptureSha256 !== proof.geometryCaptureSha256 ||
			source.geometryCaptureSha256 !== frame.geometryCaptureSha256 ||
			proof.beforeBake !== true ||
			frame.componentBounds.sourceModelSha256 !== proof.sourceModelSha256 ||
			source.domain.primitivePositionDomain !== 'source-defined-tile-offset-preview-not-live-CVar'
		) throw new Error('[JewelryMasked] source runtime/component/frame proof identity differs');

		const camera = input.camera as Camera & {
			isPerspectiveCamera?: boolean
			isOrthographicCamera?: boolean
			isArrayCamera?: boolean
		};
		if (
			camera.isArrayCamera ||
			(!camera.isPerspectiveCamera && !camera.isOrthographicCamera) ||
			!finite(camera.matrixWorld.elements) ||
			!finite(camera.projectionMatrixInverse.elements)
		) throw new Error('[JewelryMasked] preview View prefix requires actual mono perspective/orthographic camera');

		const cameraScale = orthogonalScale(new Matrix3().setFromMatrix4(camera.matrixWorld));
		if (Math.abs(cameraScale - 1) > 1e-12) throw new Error('[JewelryMasked] scaled camera source View domain unproved');

		const editorToSource = affine(frame.editorWorldToSourceWorldCM);
		const unitScale = orthogonalScale(new Matrix3().setFromMatrix4(editorToSource));
		const sourceToGeometry = affine(proof.sourceCMToGeometry);
		const cameraCM = camera
			.getWorldPosition(new Vector3())
			.applyMatrix4(editorToSource)
			.toArray() as [number, number, number];
		const cameraRows = jewelryMaskedTileOffsetRows(cameraCM);
		const direction = new Matrix3()
			.setFromMatrix4(editorToSource)
			.multiply(new Matrix3().setFromMatrix4(camera.matrixWorld));
		for (const lane of [0, 1, 2, 3, 4, 5, 6, 7, 8] as const) {
			direction.elements[lane] = direction.elements[lane] / unitScale;
		}

		orthogonalScale(direction);
		// gl.VIEWPORT is the active draw's physical framebuffer viewport, not CSS,
		// getSize(), or a presumed default target. Capture occurs in onBeforeRender.
		const viewport: unknown = context.renderer
			.getContext()
			.getParameter(context.renderer.getContext().VIEWPORT);
		if (
			!(viewport instanceof Int32Array) ||
			viewport.length !== 4 ||
			viewport[2]! <= 0 ||
			viewport[3]! <= 0
		) throw new Error('[JewelryMasked] actual framebuffer viewport unavailable');

		const clipToView00 = camera.projectionMatrixInverse.elements[0]! * (camera.isOrthographicCamera ? unitScale : 1);

		const distance = (instanceLocal?: Matrix4) => {
			const bounds = jewelryMaskedComponentWorldBounds(frame.componentBounds, {
				sourceModelSha256: source.sourceModelSha256,
				boundsCaptureSha256: frame.componentBounds.captureSha256,
				frameProofSha256: frame.frameProofSha256,
				beforeBake: true,
				sourceToGeometry,
				objectWorld: input.object.matrixWorld,
				editorWorldToSourceWorldCM: editorToSource,
				instanceLocal,
			});
			const rows = jewelryMaskedTileOffsetRows(bounds.originCM);
			return jewelryMaskedDistanceBlend({
				cameraTile: cameraRows.tile,
				cameraOffsetCM: cameraRows.offsetCM,
				objectBoundsTile: rows.tile,
				objectBoundsOffsetCM: rows.offsetCM,
				viewportPixels: [viewport[2]!, viewport[3]!],
				clipToView00,
				globalAttributeFactor: source.domain.globalAttributeFactor,
			});
		};

		let distances: number[] | undefined;
		if (input.object instanceof InstancedMesh) {
			const object = input.object;
			if (!Number.isInteger(object.count) || object.count <= 0) throw new Error('[JewelryMasked] actual instance draw count invalid');

			const instance = new Matrix4();
			distances = Array.from({ length: object.count }, (_, index) => {
				object.getMatrixAt(index, instance);
				return distance(instance);
			});
		}

		const sourceDistanceBlend = distances?.[0] ?? distance();
		if (distances && !distances.every((value) => value === sourceDistanceBlend)) throw new Error(
			'[JewelryMasked] distinct whole-component instance distances require per-instance transport; no shared uniform',
		);

		const time = context.editorClockSeconds();
		if (!Number.isFinite(time) || time < 0 || !Number.isFinite(Math.fround(time))) throw new Error('[JewelryMasked] actual editor clock invalid');

		return {
			clockDomain: 'editor-monotonic-seconds-not-live-UE',
			editorTimeSeconds: time,
			distanceDomain: 'source-projection-and-primitive-origin-validated',
			sourceDistanceBlend,
			viewToSourceWorldDirection: direction.toArray(),
			instanceDistanceBlends: distances,
			...jewelryMaskedEditorLight(context.light, camera),
		};
	};

	const materialOptions = (
		source: JewelryMaskedSourceContract,
		nativeTextures: JewelryMaskedMaterialOptions['nativeTextures'],
		frame: JewelryMaskedPreviewFrame,
	): JewelryMaskedMaterialOptions => ({
		nativeTextures,

		resolvePreview(input) {
			return resolve(input, source, input.proof, frame);
		},
	});

	return {
		resolve,
		materialOptions,

		dispose() {
			active = false;
		},
	};
}
