export interface WaterCommon {
	baseWave01: [number, number, number, number]
	baseWave02: [number, number, number, number]
	detailWave01: [number, number, number, number]
	detailWave02: [number, number, number, number]
	waveSpeed: [number, number]
	distanceFade: [number, number, number, number]
	baseIntensity: [number, number]
	detailIntensity: [number, number]
	normalFlatten: [number, number, number]
	heightFade: [number, number, number, number]
	horizon: [number, number, number]
	finalFlatten: number
	normalIntensity: number
	causticsProject: [number, number, number]
	causticsAtlas: [number, number, number, number]
	causticsLight: [number, number, number, number]
	causticsDark: number
	selectionColor: [number, number, number, number]
}

export interface WaterCaustics {
	causticsProject: [number, number, number]
	causticsAtlas: [number, number, number, number]
	brightness: number
}

export function readWaterCaustics(value: unknown): WaterCaustics | null {
	if (!value || typeof value !== 'object') return null;

	const row = value as Record<string, unknown>;
	for (const [key, length] of Object.entries({ causticsProject: 3, causticsAtlas: 4 })) {
		const vector = row[key];
		if (
			!Array.isArray(vector) ||
			vector.length !== length ||
			!vector.every((v) => typeof v === 'number' && Number.isFinite(v))
		) return null;
	}

	if (typeof row.brightness !== 'number' || !Number.isFinite(row.brightness)) return null;

	return value as WaterCaustics;
}

export function readWaterCommon(value: unknown): WaterCommon | null {
	if (!value || typeof value !== 'object') return null;

	const row = value as Record<string, unknown>;
	for (const [key, length] of Object.entries({
		baseWave01: 4,
		baseWave02: 4,
		detailWave01: 4,
		detailWave02: 4,
		waveSpeed: 2,
		distanceFade: 4,
		baseIntensity: 2,
		detailIntensity: 2,
		normalFlatten: 3,
		heightFade: 4,
		horizon: 3,
		causticsProject: 3,
		causticsAtlas: 4,
		causticsLight: 4,
		selectionColor: 4,
	})) {
		const vector = row[key];
		if (
			!Array.isArray(vector) ||
			vector.length !== length ||
			!vector.every((v) => typeof v === 'number' && Number.isFinite(v))
		) return null;
	}

	for (const key of ['finalFlatten', 'normalIntensity', 'causticsDark']) {
		if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) return null;
	}

	return value as WaterCommon;
}

// Return numeric uniform values; the parent owns texture lifetime and the clock.
export function waterCommonUniforms(config: WaterCommon) {
	return Object.fromEntries(
		Object.entries(config).map(([key, value]) => [
			`waterCommon${key[0]!.toUpperCase()}${key.slice(1)}`,
			{ value },
		]),
	);
}

const fract = (value: number) => value - Math.floor(value);
const saturate = (value: number) => Math.min(1, Math.max(0, value));
const safeDivisor = (value: number) => (Math.abs(value) < 1e-5 ? (value < 0 ? -1e-5 : 1e-5) : value);

export function waterCommonWaveUV(worldCm: [number, number], wave: WaterCommon['baseWave01'], speed: number, seconds: number): [number, number] {
	return [
		worldCm[0] * 1e-6 * wave[2] + seconds * speed * wave[0],
		worldCm[1] * 1e-6 * wave[3] + seconds * speed * wave[1],
	];
}

export function waterCommonCausticsUV(
	config: Pick<WaterCommon, 'causticsProject' | 'causticsAtlas'>,
	behindCm: [number, number, number],
	objectCenterZCm: number,
	seconds: number,
): [number, number] {
	const [px, py, scale] = config.causticsProject;
	const [columns, rows, speed] = config.causticsAtlas;
	const phase = fract(seconds * speed);
	const height = objectCenterZCm - behindCm[2];
	return [
		(fract((behindCm[0] + px * height) * scale) + Math.floor(phase * columns * rows)) /
			safeDivisor(columns),
		(fract((behindCm[1] + py * height) * scale) + Math.floor(phase * rows)) / safeDivisor(rows),
	];
}

export function waterNatureColorScaleBehindWater(
	config: WaterCaustics,
	sampleLinear: [number, number, number],
	causticsAxialDepthCm: number,
	transportAxialDepthCm: number,
): [number, number, number] {
	const fade = 1 - saturate(causticsAxialDepthCm * config.causticsAtlas[3]);
	const transportBlend = Math.min(Math.max(transportAxialDepthCm, 0) * 0.02, 1);
	return sampleLinear.map((value) => 1 + transportBlend * (Math.max(1 + value * fade * config.brightness, 0) - 1)) as [number, number, number];
}

export const waterCausticsSamplingShader = /* glsl */ `
float waterCausticsSafeDivisor(float value) {
  return abs(value) < 1e-5 ? (value < 0.0 ? -1e-5 : 1e-5) : value;
}
vec2 waterCausticsSourceUV(vec3 behindCm, float objectCenterZCm, float seconds, vec3 project, vec4 atlas) {
  vec2 projected = behindCm.xy + project.xy * (objectCenterZCm - behindCm.z);
  vec2 tile = fract(projected * project.z);
  float phase = fract(seconds * atlas.z);
  vec2 cell = floor(phase * vec2(atlas.x * atlas.y, atlas.y));
  return (tile + cell) / vec2(waterCausticsSafeDivisor(atlas.x), waterCausticsSafeDivisor(atlas.y));
}
`;

export const waterNatureCausticsShader = /* glsl */ `
${waterCausticsSamplingShader}
uniform sampler2D waterNatureCausticsTex;
uniform vec3 waterNatureCausticsProject;
uniform vec4 waterNatureCausticsAtlas;
uniform float waterNatureCausticsBrightness;
vec3 waterNatureColorScaleBehindWater(vec3 behindCm, float objectCenterZCm, float causticsAxialDepthCm, float transportAxialDepthCm, float seconds) {
  vec2 uv = waterCausticsSourceUV(behindCm, objectCenterZCm, seconds, waterNatureCausticsProject, waterNatureCausticsAtlas);
  vec3 sampled = texture2D(waterNatureCausticsTex, uv, -1.0).rgb;
  vec3 scale = max(vec3(1.0) + sampled * (1.0 - clamp(causticsAxialDepthCm * waterNatureCausticsAtlas.w, 0.0, 1.0)) * waterNatureCausticsBrightness, vec3(0.0));
  return mix(vec3(1.0), scale, min(max(transportAxialDepthCm, 0.0) * 0.02, 1.0));
}
`;

export function waterCommonCausticsEmission(
	config: WaterCommon,
	sampleLinear: [number, number, number],
	sceneLinear: [number, number, number],
	axialDepthCm: number,
	edge: number,
): [number, number, number] {
	const [brightness, low, high, light] = config.causticsLight;
	const fade = 1 - saturate(axialDepthCm * config.causticsAtlas[3]);
	const threshold = saturate((Math.max(...sceneLinear) - low) / (high - low));
	const weight =
		config.causticsDark +
		threshold * threshold * (3 - 2 * threshold) * (light - config.causticsDark);
	return sampleLinear.map((value, channel) => {
		const emission = value * fade * brightness * edge * weight;
		return Math.max(0, emission + config.selectionColor[3] * (config.selectionColor[channel]! - emission));
	}) as [number, number, number];
}

// ed4b7554 PS L120-320 / L408-461. All positions supplied here are UE
// world centimeters, including instance transforms; never mesh UV0.
// Normal output is UE-world-space. The caller converts it to its view frame.
// This is the noninteractive wave core; native UIWS RT normals/view overrides
// remain separate inputs, not a fabricated neutral/white texture binding.
export const waterCommonShader = /* glsl */ `
${waterCausticsSamplingShader}
uniform sampler2D waterCommonBaseNormal;
uniform sampler2D waterCommonDetailNormal;
uniform sampler2D waterCommonCausticsTex;
uniform vec4 waterCommonBaseWave01;
uniform vec4 waterCommonBaseWave02;
uniform vec4 waterCommonDetailWave01;
uniform vec4 waterCommonDetailWave02;
uniform vec2 waterCommonWaveSpeed;
uniform vec4 waterCommonDistanceFade;
uniform vec2 waterCommonBaseIntensity;
uniform vec2 waterCommonDetailIntensity;
uniform vec3 waterCommonNormalFlatten;
uniform vec4 waterCommonHeightFade;
uniform vec3 waterCommonHorizon;
uniform float waterCommonFinalFlatten;
uniform float waterCommonNormalIntensity;
uniform vec3 waterCommonCausticsProject;
uniform vec4 waterCommonCausticsAtlas;
uniform vec4 waterCommonCausticsLight;
uniform float waterCommonCausticsDark;
uniform vec4 waterCommonSelectionColor;

vec3 waterCommonDecodeNormal(vec2 rg) {
  vec2 xy = rg * 2.0 - 1.0;
  return normalize(vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))));
}
vec3 waterCommonRNM(vec3 base, vec3 detail) {
  vec3 t = base + vec3(0.0, 0.0, 1.0);
  vec3 u = detail * vec3(-1.0, -1.0, 1.0);
  return t * (dot(t, u) / t.z) - u;
}
vec2 waterCommonWaveUV(vec2 worldCm, vec4 wave, float speed, float seconds) {
  return worldCm * 1e-6 * wave.zw + seconds * speed * wave.xy;
}
vec3 waterCommonWaveNormal(vec3 worldCm, vec3 cameraCm, vec3 toCameraUE, float seconds) {
  vec2 f = clamp(max(vec2(length(worldCm - cameraCm)) - waterCommonDistanceFade.xz, vec2(0.0)) * waterCommonDistanceFade.yw, 0.0, 1.0);
  float nearWeight = 1.0 - f.x;
  float midWeight = f.x - f.y;
  vec3 b1 = waterCommonDecodeNormal(texture2D(waterCommonBaseNormal, waterCommonWaveUV(worldCm.xy, waterCommonBaseWave01, waterCommonWaveSpeed.x, seconds)).rg);
  vec3 b2 = waterCommonDecodeNormal(texture2D(waterCommonBaseNormal, waterCommonWaveUV(worldCm.xy, waterCommonBaseWave02, waterCommonWaveSpeed.x, seconds)).rg);
  vec3 base = waterCommonRNM(b1, b2);
  base.xy *= mix(waterCommonBaseIntensity.x, waterCommonBaseIntensity.y, midWeight);
  base = normalize(base);
  vec3 d2 = waterCommonDecodeNormal(texture2D(waterCommonDetailNormal, waterCommonWaveUV(worldCm.xy, waterCommonDetailWave02, waterCommonWaveSpeed.y, seconds)).rg);
  vec3 d1 = waterCommonDecodeNormal(texture2D(waterCommonDetailNormal, waterCommonWaveUV(worldCm.xy, waterCommonDetailWave01, waterCommonWaveSpeed.y, seconds)).rg);
  vec3 detail = waterCommonRNM(d2, d1);
  detail.xy *= mix(waterCommonDetailIntensity.y, waterCommonDetailIntensity.x, nearWeight);
  vec3 n = normalize(waterCommonRNM(base, detail));
  n = mix(n, vec3(0.0, 0.0, 1.0), nearWeight * waterCommonNormalFlatten.x);
  n = mix(n, vec3(0.0, 0.0, 1.0), midWeight * waterCommonNormalFlatten.y);
  float heightFade = clamp(max(abs(cameraCm.z - worldCm.z) - waterCommonHeightFade.x, 0.0) * waterCommonHeightFade.y, 0.0, 1.0);
  float farFlatten = waterCommonNormalFlatten.z - mix(waterCommonHeightFade.z, waterCommonHeightFade.w, heightFade);
  n = mix(n, vec3(0.0, 0.0, 1.0), f.y * farFlatten);
  vec3 v = normalize(toCameraUE);
  float viewZ = clamp(v.z, 0.0, 1.0);
  float horizon = mix(viewZ, 1.0, waterCommonHorizon.x) * waterCommonHorizon.y;
  horizon += clamp(v.z - 2.0 * dot(n, v) * n.z, 0.0, 1.0);
  n = normalize(n + v * horizon * waterCommonHorizon.z);
  n = mix(n, vec3(0.0, 0.0, 1.0), waterCommonFinalFlatten);
  // Material[11].z NormalIntensity belongs to the UIWS mask at native
  // L358-370, not this world-wave amplitude or FinalNormalFlatten (L319).
  // Its value remains transported for the separate interaction consumer.
  return normalize(n);
}
vec2 waterCommonCausticsUV(vec3 behindCm, float objectCenterZCm, float seconds) {
  return waterCausticsSourceUV(behindCm, objectCenterZCm, seconds, waterCommonCausticsProject, waterCommonCausticsAtlas);
}
vec3 waterCommonCausticsEmission(vec3 behindCm, float objectCenterZCm, vec3 sceneLinear, float axialDepthCm, float edge, float seconds) {
  vec3 caustic = texture2D(waterCommonCausticsTex, waterCommonCausticsUV(behindCm, objectCenterZCm, seconds), -1.0).rgb;
  caustic *= (1.0 - clamp(axialDepthCm * waterCommonCausticsAtlas.w, 0.0, 1.0)) * waterCommonCausticsLight.x * edge;
  float peak = max(sceneLinear.r, max(sceneLinear.g, sceneLinear.b));
  float t = clamp((peak - waterCommonCausticsLight.y) / (waterCommonCausticsLight.z - waterCommonCausticsLight.y), 0.0, 1.0);
  float light = mix(waterCommonCausticsDark, waterCommonCausticsLight.w, t * t * (3.0 - 2.0 * t));
  return max(mix(caustic * light, waterCommonSelectionColor.rgb, waterCommonSelectionColor.a), vec3(0.0));
}
`;
