import type { Texture } from 'three';

export interface WaterNatureWave {
	wave01: [number, number, number, number]
	wave02: [number, number, number, number]
	speed: number
	distanceFade: [number, number]
	intensity: [number, number]
}

export function readWaterNatureWave(value: unknown): WaterNatureWave | null {
	if (!value || typeof value !== 'object') return null;

	const wave = value as Record<string, unknown>;
	for (const [key, size] of Object.entries({
		wave01: 4,
		wave02: 4,
		distanceFade: 2,
		intensity: 2,
	})) {
		if (
			!Array.isArray(wave[key]) ||
			wave[key].length !== size ||
			!wave[key].every((v) => typeof v === 'number' && Number.isFinite(v))
		) return null;
	}

	if (typeof wave.speed !== 'number' || !Number.isFinite(wave.speed)) return null;

	return value as WaterNatureWave;
}

export function waterNatureWaveUniforms(wave: WaterNatureWave, texture: Texture) {
	return {
		waterNatureNormal: { value: texture },
		waterNatureWave01: { value: wave.wave01 },
		waterNatureWave02: { value: wave.wave02 },
		waterNatureWaveSpeed: { value: wave.speed },
		waterNatureWaveFade: { value: wave.distanceFade },
		waterNatureWaveIntensity: { value: wave.intensity },
	};
}

// Native e8454/t24: independent linear RG normal, not the DustNoise N slot.
// Two moving samples and distance attenuation; interactive/rain inputs are omitted.
export const waterNatureWaveShader = /* glsl */ `
uniform sampler2D waterNatureNormal;
uniform vec4 waterNatureWave01, waterNatureWave02;
uniform vec2 waterNatureWaveFade, waterNatureWaveIntensity;
uniform float waterNatureWaveSpeed;
vec3 waterNatureWaveSample(vec2 worldCm, vec4 wave, float seconds) {
  vec2 uv = worldCm * 0.000001 * wave.zw + seconds * waterNatureWaveSpeed * wave.xy;
  vec2 rg = texture2D(waterNatureNormal, uv).rg * 2.0 - 1.0;
  return normalize(vec3(rg, sqrt(max(1.0 - dot(rg, rg), 0.0))));
}
vec3 waterNatureWaveNormal(vec3 worldCm, vec3 cameraCm, mat3 sourceTBN, float seconds) {
  vec3 first = waterNatureWaveSample(worldCm.xy, waterNatureWave02, seconds) + vec3(0.0, 0.0, 1.0);
  vec3 second = waterNatureWaveSample(worldCm.xy, waterNatureWave01, seconds) * vec3(-1.0, -1.0, 1.0);
  vec3 n = first * dot(first, second) / first.z - second;
  float nearWeight = 1.0 - clamp(max(length(worldCm - cameraCm) - waterNatureWaveFade.x, 0.0) * waterNatureWaveFade.y, 0.0, 1.0);
  n.xy *= mix(waterNatureWaveIntensity.y, waterNatureWaveIntensity.x, nearWeight);
  return normalize(sourceTBN * normalize(n));
}
`;
