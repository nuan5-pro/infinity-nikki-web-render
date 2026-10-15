/** Final editor world is Z-up centimetres with the scene's native-Y reflection.
 * Source GLB axis conversion has already happened in geometryPipeline. */
export const nativeWorldFrameGLSL = `
vec3 furnitureNativeWorld(vec3 value) { return vec3(value.x, -value.y, value.z); }
mat3 furnitureUnscaledBasis(mat4 transform) {
 return mat3(normalize(transform[0].xyz), normalize(transform[1].xyz), normalize(transform[2].xyz));
}`;
