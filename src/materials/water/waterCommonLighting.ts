type RGB = [number, number, number];

export interface CommonSourceOpticsInput {
	color: RGB
	scene: RGB
	absorption: RGB
	axialDepthCm: number
	transmittance: number
	sourceCoverage: number
	vertexB: number
}

const saturate = (value: number) => Math.min(1, Math.max(0, value));

/** Analytic audit oracle, not a bit-exact GPU or live-game lighting replay. */
export function commonSourceOptics(input: CommonSourceOpticsInput): {
	baseColor: RGB
	alpha: number
} {
	const behind = input.scene.map((value, channel) => value * Math.exp(-Math.max(input.axialDepthCm, 0) * input.absorption[channel]!));
	const loss = 1 - Math.max(...behind);
	const weight = saturate(loss * input.transmittance) ** 2;
	return {
		baseColor: input.color.map((value, channel) => saturate(value + (behind[channel]! - value) * weight)) as RGB,
		alpha: saturate(loss * input.sourceCoverage * input.vertexB),
	};
}

/** Native L499–503 consumes evaluated r10, not the original HDR color parameter. */
export function commonSourcePBR(baseColor: RGB, metallic: number, dielectricF0: number): { diffuse: RGB; specular: RGB } {
	const metalness = saturate(metallic);
	return {
		diffuse: baseColor.map((value) => value * (1 - metalness)) as RGB,
		specular: baseColor.map((value) => dielectricF0 + (value - dielectricF0) * metalness) as RGB,
	};
}

// Common's bound-scene PBR path consumes this optical result before lighting.
// The caller explicitly owns vertex coverage and already-decoded scene inputs.
export const waterCommonSourceOpticsShader = /* glsl */ `
vec4 waterCommonSourceOptics(vec3 sourceColor, vec3 sceneColor, vec3 absorption,
  float axialDepthCm, float transmittance, float sourceCoverage, float vertexB) {
  vec3 behind = sceneColor * exp(-max(axialDepthCm, 0.0) * absorption);
  float loss = 1.0 - max(max(behind.r, behind.g), behind.b);
  float weight = clamp(loss * transmittance, 0.0, 1.0);
  weight *= weight;
  vec3 sourceBaseColor = clamp(sourceColor + (behind - sourceColor) * weight, 0.0, 1.0);
  return vec4(sourceBaseColor, clamp(loss * sourceCoverage * vertexB, 0.0, 1.0));
}
`;
