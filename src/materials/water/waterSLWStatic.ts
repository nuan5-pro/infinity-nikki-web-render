type Vec2 = [number, number];

type Vec3 = [number, number, number];

type Vec4 = [number, number, number, number];

interface StaticFields {
	detailWave01: Vec4;
	detailWave02: Vec4;
	detailSpeed: number;
	detailIntensity: Vec2;
	distanceFade: Vec4;
	normalFlatten: Vec3;
	heightFade: Vec4;
	horizon: Vec3;
	finalFlatten: number;
	anisotropy: number;
}

export type WaterSLWStatic = StaticFields &
	(
		| { mode: 'detail'; base?: never }
		| { mode: 'base-detail'; base: { wave01: Vec4; wave02: Vec4; speed: number; intensity: Vec2 } }
	);

export function readWaterSLWStatic(value: unknown): WaterSLWStatic | null {
	if (!value || typeof value !== 'object') return null;

	const row = value as Record<string, unknown>;

	const vector = (value: unknown, size: number) =>
		Array.isArray(value) &&
		value.length === size &&
		value.every((v) => typeof v === 'number' && Number.isFinite(v));

	const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
	for (const [key, size] of Object.entries({
		detailWave01: 4,
		detailWave02: 4,
		detailIntensity: 2,
		distanceFade: 4,
		normalFlatten: 3,
		heightFade: 4,
		horizon: 3,
	})) {
		if (!vector(row[key], size)) return null;
	}

	for (const key of ['detailSpeed', 'finalFlatten', 'anisotropy'])
		if (!finite(row[key])) return null;

	if (row.mode === 'detail') return row.base === undefined ? (value as WaterSLWStatic) : null;
	if (row.mode !== 'base-detail' || !row.base || typeof row.base !== 'object') return null;

	const base = row.base as Record<string, unknown>;
	return vector(base.wave01, 4) &&
		vector(base.wave02, 4) &&
		vector(base.intensity, 2) &&
		finite(base.speed)
		? (value as WaterSLWStatic)
		: null;
}

export function waterSLWStaticUniforms(config: WaterSLWStatic) {
	const { mode: _mode, base, anisotropy: _anisotropy, ...values } = config;
	return Object.fromEntries(
		Object.entries({
			...values,
			...(base
				? {
					baseWave01: base.wave01,
					baseWave02: base.wave02,
					baseSpeed: base.speed,
					baseIntensity: base.intensity,
				}
				: {}),
		}).map(([key, value]) => [`waterSLWStatic${key[0]!.toUpperCase()}${key.slice(1)}`, { value }]),
	);
}

const saturate = (value: number) => Math.min(1, Math.max(0, value));
const mix = (a: number, b: number, weight: number) => a + (b - a) * weight;
const dot = (a: Vec3, b: Vec3) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);

const normalize = (v: Vec3): Vec3 => {
	const length = Math.hypot(...v);
	if (!Number.isFinite(length) || length === 0) throw new Error('Degenerate static SLW source normal');

	return v.map((value) => value / length) as Vec3;
};

const flatten = (v: Vec3, weight: number) => v.map((value, i) => mix(value, i === 2 ? 1 : 0, weight)) as Vec3;

const decode = (sample: Vec4) => {
	const x = sample[0] * 2 - 1;
	const y = sample[1] * 2 - 1;
	return normalize([x, y, Math.sqrt(Math.max(1 - x * x - y * y, 0))]);
};

const rnm = (base: Vec3, detail: Vec3): Vec3 => {
	const t: Vec3 = [base[0], base[1], base[2] + 1];
	const u: Vec3 = [-detail[0], -detail[1], detail[2]];
	const scale = dot(t, u) / t[2];
	return t.map((value, i) => value * scale - u[i]!) as Vec3;
};

export function waterSLWStaticUV(worldCm: Vec3, wave: Vec4, speed: number, seconds: number): Vec2 {
	// Keep the source F32 multiply order for the original-DWORD UV replay.
	const f = Math.fround;
	const time = f(f(seconds) * f(speed));
	return [0, 1].map((i) => f(f(f(f(worldCm[i]!) * f(1e-6)) * f(wave[i + 2]!)) + f(time * f(wave[i]!)))) as Vec2;
}

/** Exact 91ecd39e/7f5d6995 world-space boundary before runtime UIWS.
 * Samples are supplied by the caller; neither missing base nor UIWS is fabricated.
 */
export function waterSLWStaticSourceNormal(
	config: WaterSLWStatic,
	worldCm: Vec3,
	cameraCm: Vec3,
	toCameraUE: Vec3,
	seconds: number,
	sample: (role: 'base' | 'detail', uv: Vec2) => Vec4,
): Vec3 {
	const distance = Math.hypot(...worldCm.map((value, i) => value - cameraCm[i]!));
	const nearFade = saturate(Math.max(distance - config.distanceFade[0], 0) * config.distanceFade[1]);
	const farFade = saturate(Math.max(distance - config.distanceFade[2], 0) * config.distanceFade[3]);
	const nearWeight = 1 - nearFade;
	const midWeight = nearFade - farFade;
	let base: Vec3 | undefined;
	if (config.base) {
		const first = decode(sample('base', waterSLWStaticUV(worldCm, config.base.wave01, config.base.speed, seconds)));
		const second = decode(sample('base', waterSLWStaticUV(worldCm, config.base.wave02, config.base.speed, seconds)));
		const pair = rnm(first, second);
		const intensity = mix(config.base.intensity[0], config.base.intensity[1], midWeight);
		base = normalize([pair[0] * intensity, pair[1] * intensity, pair[2]]);
	}

	const first = decode(sample('detail', waterSLWStaticUV(worldCm, config.detailWave02, config.detailSpeed, seconds)));
	const second = decode(sample('detail', waterSLWStaticUV(worldCm, config.detailWave01, config.detailSpeed, seconds)));
	const pair = rnm(first, second);
	const intensity = mix(config.detailIntensity[1], config.detailIntensity[0], nearWeight);
	const detail: Vec3 = [pair[0] * intensity, pair[1] * intensity, pair[2]];
	let normal = normalize(base ? rnm(base, detail) : detail);
	normal = flatten(normal, nearWeight * config.normalFlatten[0]);
	normal = flatten(normal, midWeight * config.normalFlatten[1]);

	const height = saturate(Math.max(Math.abs(cameraCm[2] - worldCm[2]) - config.heightFade[0], 0) * config.heightFade[1]);
	normal = flatten(normal, farFade * (config.normalFlatten[2] - mix(config.heightFade[2], config.heightFade[3], height)));

	const view = normalize(toCameraUE);
	const horizon =
		mix(saturate(view[2]), 1, config.horizon[0]) * config.horizon[1] +
		saturate(view[2] - 2 * dot(normal, view) * normal[2]);
	normal = normalize(normal.map((value, i) => value + view[i]! * horizon * config.horizon[2]) as Vec3);
	return flatten(normal, config.finalFlatten);
}

// Only the proven static domain emits this source; old water programs never
// include it. The detail-only permutation declares no base sampler or uniforms.
export function waterSLWStaticShader(config: WaterSLWStatic): string {
	return /* glsl */ `
uniform sampler2D waterSLWStaticDetailNormal;
uniform vec4 waterSLWStaticDetailWave01, waterSLWStaticDetailWave02;
uniform float waterSLWStaticDetailSpeed;
uniform vec2 waterSLWStaticDetailIntensity;
uniform vec4 waterSLWStaticDistanceFade, waterSLWStaticHeightFade;
uniform vec3 waterSLWStaticNormalFlatten, waterSLWStaticHorizon;
uniform float waterSLWStaticFinalFlatten;
${
	config.base
		? `uniform sampler2D waterSLWStaticBaseNormal;
uniform vec4 waterSLWStaticBaseWave01, waterSLWStaticBaseWave02;
uniform float waterSLWStaticBaseSpeed;
uniform vec2 waterSLWStaticBaseIntensity;`
		: ''
}
vec3 waterSLWStaticDecode(vec2 rg) {
  vec2 xy = rg * 2.0 - 1.0;
  return normalize(vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))));
}
vec3 waterSLWStaticRNM(vec3 base, vec3 detail) {
  vec3 t = base + vec3(0.0, 0.0, 1.0);
  vec3 u = detail * vec3(-1.0, -1.0, 1.0);
  return t * (dot(t, u) / t.z) - u;
}
vec2 waterSLWStaticUV(vec2 worldCm, vec4 wave, float speed, float seconds) {
  return worldCm * 1e-6 * wave.zw + seconds * speed * wave.xy;
}
vec3 waterSLWStaticSourceNormal(vec3 worldCm, vec3 cameraCm, vec3 toCameraUE, float seconds) {
  float distanceCm = length(worldCm - cameraCm);
  vec2 fade = clamp(max(vec2(distanceCm) - waterSLWStaticDistanceFade.xz, vec2(0.0)) * waterSLWStaticDistanceFade.yw, 0.0, 1.0);
  float nearWeight = 1.0 - fade.x, midWeight = fade.x - fade.y;
  ${
		config.base
			? `vec3 b1 = waterSLWStaticDecode(texture2D(waterSLWStaticBaseNormal, waterSLWStaticUV(worldCm.xy, waterSLWStaticBaseWave01, waterSLWStaticBaseSpeed, seconds)).rg);
  vec3 b2 = waterSLWStaticDecode(texture2D(waterSLWStaticBaseNormal, waterSLWStaticUV(worldCm.xy, waterSLWStaticBaseWave02, waterSLWStaticBaseSpeed, seconds)).rg);
  vec3 base = waterSLWStaticRNM(b1, b2);
  base.xy *= mix(waterSLWStaticBaseIntensity.x, waterSLWStaticBaseIntensity.y, midWeight);
  base = normalize(base);`
			: ''
	}
  vec3 d2 = waterSLWStaticDecode(texture2D(waterSLWStaticDetailNormal, waterSLWStaticUV(worldCm.xy, waterSLWStaticDetailWave02, waterSLWStaticDetailSpeed, seconds)).rg);
  vec3 d1 = waterSLWStaticDecode(texture2D(waterSLWStaticDetailNormal, waterSLWStaticUV(worldCm.xy, waterSLWStaticDetailWave01, waterSLWStaticDetailSpeed, seconds)).rg);
  vec3 detail = waterSLWStaticRNM(d2, d1);
  detail.xy *= mix(waterSLWStaticDetailIntensity.y, waterSLWStaticDetailIntensity.x, nearWeight);
  vec3 n = normalize(${config.base ? 'waterSLWStaticRNM(base, detail)' : 'detail'});
  n = mix(n, vec3(0.0, 0.0, 1.0), nearWeight * waterSLWStaticNormalFlatten.x);
  n = mix(n, vec3(0.0, 0.0, 1.0), midWeight * waterSLWStaticNormalFlatten.y);
  float heightFade = clamp(max(abs(cameraCm.z - worldCm.z) - waterSLWStaticHeightFade.x, 0.0) * waterSLWStaticHeightFade.y, 0.0, 1.0);
  float farFlatten = waterSLWStaticNormalFlatten.z - mix(waterSLWStaticHeightFade.z, waterSLWStaticHeightFade.w, heightFade);
  n = mix(n, vec3(0.0, 0.0, 1.0), fade.y * farFlatten);
  vec3 v = normalize(toCameraUE);
  float horizon = mix(clamp(v.z, 0.0, 1.0), 1.0, waterSLWStaticHorizon.x) * waterSLWStaticHorizon.y;
  horizon += clamp(v.z - 2.0 * dot(n, v) * n.z, 0.0, 1.0);
  n = normalize(n + v * horizon * waterSLWStaticHorizon.z);
  return mix(n, vec3(0.0, 0.0, 1.0), waterSLWStaticFinalFlatten);
}
vec3 waterSLWStaticWaveNormal(vec3 worldCm, vec3 cameraCm, vec3 toCameraUE, mat3 sourceTBN, float seconds) {
  vec3 worldNormal = waterSLWStaticSourceNormal(worldCm, cameraCm, toCameraUE, seconds);
  // 7f5d L242-244 projects world waves into the imported tangent frame;
  // L334-341 transforms the post-interaction result back to world. Keep both
  // boundaries when runtime interaction/rain/View overrides are unavailable.
  vec3 tangentNormal = vec3(dot(sourceTBN[0], worldNormal), dot(sourceTBN[1], worldNormal), dot(sourceTBN[2], worldNormal));
  return normalize(sourceTBN * tangentNormal);
}
`;
}
