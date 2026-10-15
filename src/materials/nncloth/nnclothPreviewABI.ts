import {
	Camera,
	DirectionalLight,
	Matrix4,
	Vector2,
	Vector3,
	Vector4,
	type WebGLRenderer,
} from 'three';

// geometryPipeline already converts imported meters to editor world cm.
const gameFromWorld = new Matrix4().set(0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
const worldFromGameDirection = new Matrix4().set(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

/** Populate View registers from the editor camera, light and monotonic clock. */
export function updateNNClothPreviewView(
	view: Vector4[],
	renderer: WebGLRenderer,
	camera: Camera,
	light: DirectionalLight | null,
	realTime: number,
) {
	if (view.length !== 325 || !Number.isFinite(realTime)) throw new Error('[NNCloth] invalid View buffer or time');

	camera.updateMatrixWorld(true);

	const cameraGame = new Vector3()
		.setFromMatrixPosition(camera.matrixWorld)
		.applyMatrix4(gameFromWorld);
	if (
		![cameraGame.x, cameraGame.y, cameraGame.z].every((value) => Number.isFinite(value) && Math.abs(value) < 1048576)
	) throw new Error('[NNCloth] preview camera outside proved zero-tile domain');

	const rotation = camera.matrixWorldInverse.clone().multiply(worldFromGameDirection);
	rotation.setPosition(0, 0, 0);
	for (let column = 0; column < 3; column++)
		view[12 + column]!.fromArray(rotation.elements, column * 4);

	view[31]!.w = camera.projectionMatrix.elements[15]!;
	view[36]!.x = camera.projectionMatrixInverse.elements[0]!;

	const size = renderer.getDrawingBufferSize(new Vector2());
	if (size.x < 1 || size.y < 1) throw new Error('[NNCloth] invalid actual drawing-buffer size');

	const screenToClip = new Matrix4().set(2 / size.x, 0, 0, -1, 0, -2 / size.y, 0, 1, 0, 0, 2, -1, 0, 0, 0, 1);
	const screenToGame = gameFromWorld
		.clone()
		.multiply(camera.matrixWorld)
		.multiply(camera.projectionMatrixInverse)
		.multiply(screenToClip);
	for (let column = 0; column < 4; column++)
		view[44 + column]!.fromArray(screenToGame.elements, column * 4);

	const forward = camera.getWorldDirection(new Vector3());
	view[61]!.set(-forward.y, forward.x, forward.z, 0);
	view[109]!.set(0, 0, 0, 0);
	view[110]!.set(cameraGame.x, cameraGame.y, cameraGame.z, 0);
	view[136]!.set(size.x, size.y, 1 / size.x, 1 / size.y);
	view[135]!.set(0, 0, 0, 0);
	// Unit exposure, unmodified normals and zero mip bias for the editor view.
	view[143]!.z = 1;
	view[146]!.set(0, 0, 0, 1);
	view[149]!.w = 1;
	view[150]!.z = realTime;
	view[151]!.x = 0;
	view[160]!.set(0, 1, 0, 0);
	if (light) {
		light.updateMatrixWorld(true);
		light.target.updateMatrixWorld(true);

		const direction = new Vector3()
			.setFromMatrixPosition(light.matrixWorld)
			.sub(new Vector3().setFromMatrixPosition(light.target.matrixWorld))
			.normalize();
		view[154]!.set(
			(light.color.r * light.intensity) / Math.PI,
			(light.color.g * light.intensity) / Math.PI,
			(light.color.b * light.intensity) / Math.PI,
			0,
		);
		view[155]!.set(-direction.y, direction.x, direction.z, 0);
	} else {
		view[154]!.set(0, 0, 0, 0);
		view[155]!.set(0, 0, 0, 0);
	}
}

export function createNNClothPreviewView() {
	return Array.from({ length: 325 }, () => new Vector4());
}
