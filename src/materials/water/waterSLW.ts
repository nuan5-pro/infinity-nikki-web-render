import type { BufferGeometry } from 'three';

export function assertWaterSLWGeometry(geometry: BufferGeometry): void {
	const count = geometry.getAttribute('position')?.count;
	if (!count) throw new Error('Captured SLW requires source positions');

	for (const [name, size] of [
		['normal', 3],
		['tangent', 4],
	] as const) {
		const attribute = geometry.getAttribute(name);
		if (!attribute || attribute.itemSize !== size || attribute.count !== count) throw new Error(`Captured SLW requires the imported source ${name} stream`);
	}

	const n = geometry.getAttribute('normal');
	const t = geometry.getAttribute('tangent');
	for (let i = 0; i < count; i++) {
		const normal = [n.getX(i), n.getY(i), n.getZ(i)];
		const tangent = [t.getX(i), t.getY(i), t.getZ(i)];
		const handedness = t.getW(i);
		if (
			![...normal, ...tangent, handedness].every(Number.isFinite) ||
			Math.abs(handedness) !== 1 ||
			Math.hypot(...normal) < 1e-6 ||
			Math.hypot(...tangent) < 1e-6 ||
			Math.hypot(
				normal[1]! * tangent[2]! - normal[2]! * tangent[1]!,
				normal[2]! * tangent[0]! - normal[0]! * tangent[2]!,
				normal[0]! * tangent[1]! - normal[1]! * tangent[0]!,
			) < 1e-6
		) throw new Error('Captured SLW requires a finite nondegenerate signed source tangent frame');
	}
}

export interface WaterSLW {
	procedural: [number, number, number, number]
	iterations: number
	bigNormal: [number, number]
	directional: [[number, number, number, number], [number, number, number, number]]
	directionalShape: [[number, number], [number, number]]
	mainHeight: number
	baseWave01: [number, number, number, number]
	baseWave02: [number, number, number, number]
	detailWave01: [number, number, number, number]
	detailWave02: [number, number, number, number]
	waveSpeed: [number, number]
	velocity: [number, number, number, number]
	distanceFade: [number, number, number, number]
	baseIntensity: [number, number]
	detailIntensity: [number, number]
	normalFlatten: [number, number, number]
	heightFade: [number, number, number, number]
	horizon: [number, number, number]
	finalFlatten: number
}

export function readWaterSLW(value: unknown): WaterSLW | null {
	if (!value || typeof value !== 'object') return null;

	const row = value as Record<string, unknown>;

	const finiteVector = (value: unknown, size: number) =>
		Array.isArray(value) &&
		value.length === size &&
		value.every((v) => typeof v === 'number' && Number.isFinite(v));

	for (const [key, size] of Object.entries({
		procedural: 4,
		bigNormal: 2,
		baseWave01: 4,
		baseWave02: 4,
		detailWave01: 4,
		detailWave02: 4,
		waveSpeed: 2,
		velocity: 4,
		distanceFade: 4,
		baseIntensity: 2,
		detailIntensity: 2,
		normalFlatten: 3,
		heightFade: 4,
		horizon: 3,
	}))
		if (!finiteVector(row[key], size)) return null;

	for (const [key, size] of [
		['directional', 4],
		['directionalShape', 2],
	] as const) {
		const waves = row[key];
		if (
			!Array.isArray(waves) ||
			waves.length !== 2 ||
			!waves.every((wave) => finiteVector(wave, size))
		) return null;
	}

	if (
		!Number.isInteger(row.iterations) ||
		(row.iterations as number) < 1 ||
		(row.iterations as number) > 64
	) return null;

	for (const key of ['mainHeight', 'finalFlatten']) {
		if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) return null;
	}

	return value as WaterSLW;
}

export function waterSLWUniforms(config: WaterSLW) {
	// Separate GLSL names avoid nested-array upload ambiguity.
	const { directional, directionalShape, ...values } = config;
	return Object.fromEntries(
		Object.entries({
			...values,
			directional0: directional[0],
			directional1: directional[1],
			directionalShape0: directionalShape[0],
			directionalShape1: directionalShape[1],
		}).map(([key, value]) => [`waterSLW${key[0]!.toUpperCase()}${key.slice(1)}`, { value }]),
	);
}

// Exact iterative height kernel from 3be9563d L133-157; XY is already scaled
// by BigWaveTillingScale. This is not a generic sine-wave visual proxy.
export function waterSLWProceduralHeight(config: Pick<WaterSLW, 'procedural' | 'iterations'>, position: [number, number], seconds: number): number {
	let [x, y] = position;
	let angle = 0;
	let frequency = 1;
	let speed = 2;
	let weight = 1;
	let height = 0;
	let sum = 0;
	for (let i = 0; i < config.iterations; i++) {
		const dx = Math.sin(angle);
		const dy = Math.cos(angle);
		const phase = (dx * x + dy * y) * frequency + seconds * config.procedural[0] * speed;
		const value = Math.exp(Math.sin(phase) - 1);
		const drag = -Math.cos(phase) * value * weight * config.procedural[2];
		x += drag * dx;
		y += drag * dy;
		height += value * weight;
		sum += weight;
		frequency *= 1.18;
		speed *= 1.07;
		weight *= 0.82;
		angle += 1232.39990234375;
	}

	return (height / sum) * config.procedural[3];
}

export function waterSLWDirectionalSample(
	wave: WaterSLW['directional'][0],
	shape: WaterSLW['directionalShape'][0],
	worldCm: [number, number],
	seconds: number,
	amplitudeScale: number,
) {
	const phase = (worldCm[0] * wave[0] + worldCm[1] * wave[1]) * wave[2] - seconds * wave[3];
	const height = amplitudeScale * shape[0];
	const slope = Math.sin(phase) * height * wave[2];
	const horizontal = Math.sin(phase) * height * (shape[1] / (height * wave[2]));
	const n = [slope * wave[0], slope * wave[1], 1 - shape[1] * Math.cos(phase)] as const;
	const length = Math.hypot(...n);
	return {
		normal: n.map((v) => v / length) as [number, number, number],
		displacement: [-horizontal * wave[0], -horizontal * wave[1], Math.cos(phase) * height] as [
			number,
			number,
			number,
		],
	};
}

export function waterSLWDetailUV(
	config: Pick<WaterSLW, 'detailWave01' | 'detailWave02' | 'waveSpeed' | 'velocity'>,
	worldCm: [number, number],
	displacement: [number, number, number],
	seconds: number,
): [[number, number], [number, number]] {
	const first = config.detailWave02;
	const second = config.detailWave01;

	const uv = (wave: WaterSLW['detailWave01'], moving: boolean): [number, number] =>
		[0, 1].map(
			(axis) =>
				worldCm[axis]! * 1e-6 * wave[axis + 2]! +
				(seconds * config.waveSpeed[1] +
					(moving ? displacement[axis]! * config.velocity[0] * config.velocity[1] : 0)) *
					wave[axis]!,
		) as [number, number];

	return [uv(first, true), uv(second, false)];
}

// World positions and camera are UE centimeters. sourceTBN columns are the
// actual imported tangent, signed bitangent and geometric normal in UE world
// space. Runtime UIWS/rain ripple textures remain external, not white assets.
// This returns the captured noninteractive world normal before L584 projection.
export const waterSLWShader = /* glsl */ `
uniform sampler2D waterSLWBaseNormal;
uniform sampler2D waterSLWDetailNormal;
uniform vec4 waterSLWProcedural;
uniform int waterSLWIterations;
uniform vec2 waterSLWBigNormal;
uniform vec4 waterSLWDirectional0, waterSLWDirectional1;
uniform vec2 waterSLWDirectionalShape0, waterSLWDirectionalShape1;
uniform float waterSLWMainHeight;
uniform vec4 waterSLWBaseWave01, waterSLWBaseWave02;
uniform vec4 waterSLWDetailWave01, waterSLWDetailWave02;
uniform vec2 waterSLWWaveSpeed;
uniform vec4 waterSLWVelocity;
uniform vec4 waterSLWDistanceFade;
uniform vec2 waterSLWBaseIntensity, waterSLWDetailIntensity;
uniform vec3 waterSLWNormalFlatten;
uniform vec4 waterSLWHeightFade;
uniform vec3 waterSLWHorizon;
uniform float waterSLWFinalFlatten;

vec3 waterSLWDecodeNormal(vec2 rg) {
  vec2 xy = rg * 2.0 - 1.0;
  return normalize(vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))));
}
vec3 waterSLWRNM(vec3 base, vec3 detail) {
  vec3 t = base + vec3(0.0, 0.0, 1.0);
  vec3 u = detail * vec3(-1.0, -1.0, 1.0);
  return t * (dot(t, u) / t.z) - u;
}
float waterSLWHeight(vec2 p, float seconds) {
  float angle = 0.0, frequency = 1.0, speed = 2.0, weight = 1.0, height = 0.0, sum = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= waterSLWIterations) break;
    vec2 direction = vec2(sin(angle), cos(angle));
    float phase = dot(direction, p) * frequency + seconds * waterSLWProcedural.x * speed;
    float value = exp(sin(phase) - 1.0);
    p += -cos(phase) * value * weight * waterSLWProcedural.z * direction;
    height += value * weight;
    sum += weight;
    frequency *= 1.18;
    speed *= 1.07;
    weight *= 0.82;
    angle += 1232.39990234375;
  }
  return height / sum * waterSLWProcedural.w;
}
vec3 waterSLWDirectional(vec4 wave, vec2 shape, vec2 worldCm, float seconds, float amplitudeScale, out vec3 displacement) {
  float phase = dot(worldCm, wave.xy) * wave.z - seconds * wave.w;
  float height = amplitudeScale * shape.x;
  float slope = sin(phase) * height * wave.z;
  // L298/L334 retain steepness/(height*k); L459/L465 consume that ratio
  // for horizontal Gerstner displacement, NOT the normal derivative slope.
  float horizontal = sin(phase) * height * (shape.y / (height * wave.z));
  displacement = vec3(-horizontal * wave.xy, cos(phase) * height);
  return normalize(vec3(slope * wave.xy, 1.0 - shape.y * cos(phase)));
}
vec2 waterSLWWaveUV(vec2 worldCm, vec4 wave, float speed, float seconds) {
  return worldCm * 1e-6 * wave.zw + seconds * speed * wave.xy;
}
vec3 waterSLWWaveNormal(vec3 worldCm, vec3 cameraCm, vec3 toCameraUE, mat3 sourceTBN, float seconds) {
  float distanceCm = length(worldCm - cameraCm);
  vec2 fade = clamp(max(vec2(distanceCm) - waterSLWDistanceFade.xz, vec2(0.0)) * waterSLWDistanceFade.yw, 0.0, 1.0);
  float nearWeight = 1.0 - fade.x;
  float midWeight = fade.x - fade.y;
  float heightFade = clamp(max(abs(cameraCm.z - worldCm.z) - waterSLWHeightFade.x, 0.0) * waterSLWHeightFade.y, 0.0, 1.0);
  float bigWeight = heightFade * (1.0 - clamp((1.0 - fade.y) * waterSLWBigNormal.y, 0.0, 1.0));
  vec3 big = vec3(0.0, 0.0, 1.0);
  if (bigWeight != 0.0) {
    vec2 p = worldCm.xy * waterSLWProcedural.y;
    float h = waterSLWHeight(p, seconds);
    vec3 procedural = normalize(vec3((waterSLWHeight(p - vec2(0.1, 0.0), seconds) - h) * 0.1,
      (h - waterSLWHeight(p + vec2(0.0, 0.1), seconds)) * 0.1, 0.01));
    big = vec3(dot(sourceTBN[0], procedural), dot(sourceTBN[1], procedural), dot(sourceTBN[2], procedural));
    big.xy *= waterSLWBigNormal.x;
    big = mix(vec3(0.0, 0.0, 1.0), big, bigWeight);
  }
  float amplitudeScale = mix(0.5, waterSLWMainHeight, nearWeight);
  vec3 displacement0, displacement1;
  vec3 directional0 = waterSLWDirectional(waterSLWDirectional0, waterSLWDirectionalShape0, worldCm.xy, seconds, amplitudeScale, displacement0);
  vec3 directional1 = waterSLWDirectional(waterSLWDirectional1, waterSLWDirectionalShape1, worldCm.xy, seconds, amplitudeScale, displacement1);
  vec3 directional = normalize(mix(vec3(0.0, 0.0, 1.0), waterSLWRNM(directional0, directional1), nearWeight));
  vec3 prior = normalize(waterSLWRNM(big, directional));
  vec3 b1 = waterSLWDecodeNormal(texture2D(waterSLWBaseNormal, waterSLWWaveUV(worldCm.xy, waterSLWBaseWave01, waterSLWWaveSpeed.x, seconds)).rg);
  vec3 b2 = waterSLWDecodeNormal(texture2D(waterSLWBaseNormal, waterSLWWaveUV(worldCm.xy, waterSLWBaseWave02, waterSLWWaveSpeed.x, seconds)).rg);
  vec3 base = waterSLWRNM(b1, b2);
  base.xy *= mix(waterSLWBaseIntensity.x, waterSLWBaseIntensity.y, midWeight);
  prior = normalize(waterSLWRNM(prior, normalize(base)));
  vec3 displacement = (displacement0 + displacement1) * nearWeight * waterSLWVelocity.x;
  vec2 firstUV = worldCm.xy * 1e-6 * waterSLWDetailWave02.zw +
    (displacement.xy * waterSLWVelocity.y + seconds * waterSLWWaveSpeed.y) * waterSLWDetailWave02.xy;
  vec3 d2 = waterSLWDecodeNormal(texture2D(waterSLWDetailNormal, firstUV).rg);
  vec3 d1 = waterSLWDecodeNormal(texture2D(waterSLWDetailNormal, waterSLWWaveUV(worldCm.xy, waterSLWDetailWave01, waterSLWWaveSpeed.y, seconds)).rg);
  vec3 detail = waterSLWRNM(d2, d1);
  float peak = mix(1.0, waterSLWVelocity.w, clamp(displacement.z * waterSLWVelocity.z, 0.0, 1.0));
  detail.xy *= mix(waterSLWDetailIntensity.y, waterSLWDetailIntensity.x, nearWeight) * peak;
  vec3 n = normalize(waterSLWRNM(prior, detail));
  n = mix(n, vec3(0.0, 0.0, 1.0), nearWeight * waterSLWNormalFlatten.x);
  n = mix(n, vec3(0.0, 0.0, 1.0), midWeight * waterSLWNormalFlatten.y);
  float farFlatten = waterSLWNormalFlatten.z - mix(waterSLWHeightFade.z, waterSLWHeightFade.w, heightFade);
  n = mix(n, vec3(0.0, 0.0, 1.0), fade.y * farFlatten);
  vec3 v = normalize(toCameraUE);
  float horizon = mix(clamp(v.z, 0.0, 1.0), 1.0, waterSLWHorizon.x) * waterSLWHorizon.y;
  horizon += clamp(v.z - 2.0 * dot(n, v) * n.z, 0.0, 1.0);
  n = normalize(n + v * horizon * waterSLWHorizon.z);
  return normalize(mix(n, vec3(0.0, 0.0, 1.0), waterSLWFinalFlatten));
}
`;
