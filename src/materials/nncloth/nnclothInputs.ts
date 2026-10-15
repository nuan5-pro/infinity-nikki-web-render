import {
	DataTexture,
	FloatType,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	RGBAFormat,
} from 'three';

export interface NNClothMPT {
	sourcePath: string;
	sha256: string;
	width: 9;
	height: 7;
	rgba: number[] | Float32Array;
}

/** Native float MPT is an operand table, not a display PNG or a palette. */
export function createNNClothMPT(source: NNClothMPT) {
	if (
		source.width !== 9 ||
		source.height !== 7 ||
		source.rgba.length !== 9 * 7 * 4 ||
		!source.rgba.every(Number.isFinite) ||
		!/^[a-f0-9]{64}$/.test(source.sha256) ||
		!source.sourcePath.startsWith('/Game/')
	) throw new Error('[NNCloth] invalid original HDR float MPT');

	const texture = new DataTexture(new Float32Array(source.rgba), source.width, source.height, RGBAFormat, FloatType);
	texture.name = source.sourcePath;
	texture.colorSpace = NoColorSpace;
	texture.minFilter = NearestFilter;
	texture.magFilter = NearestFilter;
	texture.wrapS = RepeatWrapping;
	texture.wrapT = RepeatWrapping;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}

export function nnclothFabricIndex(uv1: [number, number], grid: [number, number]) {
	if (
		!uv1.every((value) => Number.isFinite(value) && value >= 0) ||
		!grid.every((value) => Number.isSafeInteger(value) && value >= 1)
	) throw new Error('[NNCloth] invalid unsigned fabric selector');

	return (
		Math.min(Math.floor(uv1[0] * grid[1]), grid[1] - 1) +
		Math.min(Math.floor(uv1[1] * grid[0]), grid[0] - 1) * grid[1]
	);
}

// Actual PS120-139: Fabric_Attr uses UV1.yx; the original float row is sampled at
// its cell centre and swizzled wxyz before intensity/index/tile consumers.
export const nnclothMPTGLSL = `
vec4 nnclothMPTCell(sampler2D source, float column, float row) {
  return texture2D(source, vec2(column+0.5,row+0.5)/vec2(9.0,7.0));
}
float nnclothFabricColumn(vec2 uv1, vec2 grid) {
  vec2 cells=min(floor(uv1.yx*grid),grid-1.0);
  return cells.y+cells.x*grid.y;
}
vec4 nnclothFabricNormalOperands(sampler2D source,float column) {
  return nnclothMPTCell(source,column,0.0).wxyz;
}`;
