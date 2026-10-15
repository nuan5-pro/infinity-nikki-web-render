export type CharacterJewelVec3 = readonly [number, number, number];

export type CharacterJewelVec4 = readonly [number, number, number, number];

export type CharacterJewelVec2 = readonly [number, number];

/** Directions and the frame use the same source space. The environment owner
 * supplies the actual editor primary light and explicit source-MPC values. */
export interface CharacterJewelLighting {
	primaryDirection: CharacterJewelVec3
	primaryColor: CharacterJewelVec3
	ready: number
	dirLightVectorLimited: CharacterJewelVec3
	resolvedSunColor: CharacterJewelVec3
	fillIntensity: number
	fillSkyColor: CharacterJewelVec3
	fillGroundColor: CharacterJewelVec3
}

export interface CharacterJewelFrame {
	tangent: CharacterJewelVec3
	bitangent: CharacterJewelVec3
	normal: CharacterJewelVec3
}

const dot = (a: CharacterJewelVec3, b: CharacterJewelVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const normalize = (v: CharacterJewelVec3): CharacterJewelVec3 => {
	const length = Math.sqrt(dot(v, v));
	if (!Number.isFinite(length) || length === 0) throw new Error('[CharacterJewel] finite nonzero source direction required');

	return [v[0] / length, v[1] / length, v[2] / length];
};

const saturate = (v: number) => Math.min(1, Math.max(0, v));
const positivePower = (v: number, power: number) => (v <= 0 ? 0 : Math.pow(v, power));

const rgb = (component: (channel: 0 | 1 | 2) => number): CharacterJewelVec3 => [
	component(0),
	component(1),
	component(2),
];

/** UV1 is unconditionally sampled by T_Jewel_2UColor. Neither an all-UV0
 * diffuse selector nor its white default texture makes the source stream optional. */
export function characterJewelTextureCoordinates(
	uv: readonly [CharacterJewelVec2, CharacterJewelVec2, CharacterJewelVec2, CharacterJewelVec2],
	weights: CharacterJewelVec4,
	diffuseTiling: number,
	normalTiling: number,
	normalHeight: number,
	bumpTiling: number,
	bumpHeight: number,
	frame: CharacterJewelFrame,
	view: CharacterJewelVec3,
): {
	diffuse: CharacterJewelVec2
	twoUColor: CharacterJewelVec2
	normal: CharacterJewelVec2
	refractionNormal: CharacterJewelVec2
	bump: CharacterJewelVec2
} {
	const ray = [dot(frame.tangent, view), dot(frame.bitangent, view)] as const;
	const normal = [uv[0][0] * normalTiling, uv[0][1] * normalTiling] as const;

	const colorUV = (channel: 0 | 1) =>
		(uv[0][channel] * weights[0] +
			uv[1][channel] * weights[1] +
			uv[2][channel] * weights[2] +
			uv[3][channel] * weights[3]) *
		diffuseTiling;

	return {
		diffuse: [colorUV(0), colorUV(1)],
		twoUColor: uv[1],
		normal,
		refractionNormal: [
			normal[0] + ray[0] * (normalHeight * 0.1 - 0.05),
			normal[1] + ray[1] * (normalHeight * 0.1 - 0.05),
		],
		bump: [
			uv[0][0] * bumpTiling + ray[0] * (bumpHeight * 0.1 - 0.05),
			uv[0][1] * bumpTiling + ray[1] * (bumpHeight * 0.1 - 0.05),
		],
	};
}

/** The second normal sample bypasses flatness, face-fix and View normal override.
 * It is deliberately not the surface normal used for the reflection/highlights. */
export function characterJewelRefractionDirection(
	rg: CharacterJewelVec2,
	frame: CharacterJewelFrame,
	view: CharacterJewelVec3,
	distortion: number,
): CharacterJewelVec3 {
	const x = rg[0] * 2 - 1;
	const y = rg[1] * 2 - 1;
	const z = Math.sqrt(Math.max(1 - x * x - y * y, 0));
	return normalize(
		rgb(
			(i) =>
				-(
					view[i] +
					(x * frame.tangent[i] + y * frame.bitangent[i] + z * frame.normal[i]) * distortion
				),
		),
	);
}

/** PS59–62/67–70: negative Ready and |Ready| <= 1e-5 both use View.
 * A provider must convert the chosen editor light to this source space. */
export function characterJewelLight(lighting: CharacterJewelLighting): {
	direction: CharacterJewelVec3
	color: CharacterJewelVec3
} {
	const values = [
		lighting.ready,
		lighting.fillIntensity,
		...lighting.primaryDirection,
		...lighting.primaryColor,
		...lighting.dirLightVectorLimited,
		...lighting.resolvedSunColor,
		...lighting.fillSkyColor,
		...lighting.fillGroundColor,
	];

	if (!values.every(Number.isFinite)) throw new Error('[CharacterJewel] explicit finite View/MPC lighting required');

	const useCollection = Math.abs(lighting.ready) > 0.00001 && lighting.ready >= 0;
	return {
		direction: useCollection ? lighting.dirLightVectorLimited : lighting.primaryDirection,
		color: useCollection ? lighting.resolvedSunColor : lighting.primaryColor,
	};
}

/** Current opaque and two-sided PS decode RG, flatten before TBN, then normalize.
 * nativeSign is the actual culling * primitive-determinant * front-face sign.
 * The two-sided shader applies it both before and after the TBN conversion. */
export function characterJewelNormal(
	rg: readonly [number, number],
	flatness: number,
	frame: CharacterJewelFrame,
	nativeSign: 1 | -1,
	fixTwoSide: number,
	twoSided: boolean,
	viewNormalOverride: CharacterJewelVec4,
): CharacterJewelVec3 {
	const x = rg[0] * 2 - 1;
	const y = rg[1] * 2 - 1;
	const z = Math.sqrt(Math.max(1 - x * x - y * y, 0));
	const sign = twoSided ? nativeSign : 1;
	const fix = twoSided ? sign + (1 - sign) * fixTwoSide : 1;
	const tangentNormal = normalize([
		x * (1 - flatness) * fix * viewNormalOverride[3] + viewNormalOverride[0],
		y * (1 - flatness) * fix * viewNormalOverride[3] + viewNormalOverride[1],
		(z + (1 - z) * flatness) * fix * viewNormalOverride[3] + viewNormalOverride[2],
	]);
	const normal = normalize(
		rgb(
			(i) =>
				tangentNormal[0] * frame.tangent[i] +
				tangentNormal[1] * frame.bitangent[i] +
				tangentNormal[2] * frame.normal[i],
		),
	);
	return [normal[0] * sign, normal[1] * sign, normal[2] * sign];
}

/** Unlike sphere's half-vector, strip normalizes light + .01, not light itself.
 * Compiler CB2[7/8].yzw already contain each source colour's alpha multiplier. */
export function characterJewelHighlights(
	normal: CharacterJewelVec3,
	view: CharacterJewelVec3,
	lighting: CharacterJewelLighting,
	strip: CharacterJewelVec4,
	sphere: CharacterJewelVec4,
): CharacterJewelVec3 {
	const light = characterJewelLight(lighting).direction;

	const reflection: CharacterJewelVec3 = [
		2 * dot(normal, view) * normal[0] - view[0],
		2 * dot(normal, view) * normal[1] - view[1],
		2 * dot(normal, view) * normal[2] - view[2],
	];

	const stripLight = normalize([light[0] + 0.01, light[1] + 0.01, light[2] + 0.01]);
	const stripAmount = positivePower(1 - Math.abs(dot(stripLight, reflection)), strip[0]);
	const half = normalize([view[0] + light[0], view[1] + light[1], view[2] + light[2]]);
	const sphereAmount = positivePower(saturate(dot(half, normal)), sphere[0]);
	return [
		stripAmount * strip[1] + sphereAmount * sphere[1],
		stripAmount * strip[2] + sphereAmount * sphere[2],
		stripAmount * strip[3] + sphereAmount * sphere[3],
	];
}

/** PS474–487: source Z selects the hemispheres; this is not the editor's sky
 * tint or hemisphere light. The source multiplies by min(length(light>=.12),1). */
export function characterJewelFill(normalSourceZ: number, lighting: CharacterJewelLighting): CharacterJewelVec3 {
	const light = characterJewelLight(lighting).color;
	const t = saturate(normalSourceZ + 0.5);
	const blend = t * t * (3 - 2 * t);
	const lightScale = Math.min(Math.hypot(Math.max(light[0], 0.12), Math.max(light[1], 0.12), Math.max(light[2], 0.12)), 1);
	return rgb(
		(i) =>
			(lighting.fillGroundColor[i] +
				(lighting.fillSkyColor[i] - lighting.fillGroundColor[i]) * blend) *
			lighting.fillIntensity *
			lightScale,
	);
}

export interface CharacterJewelGlintInput {
	/** PS primitive WorldToLocal result, in source centimetres. */
	localPositionCM: CharacterJewelVec3
	maskGreen: number
	normalDotView: number
	distanceBlend: number
	vertexFactor: number
	gameTime: number
	aaMethod: number
	globalAttributeFactor: number
	swapLightFactor: number
	/** Evaluated CB2[10].w, [11].xyz, [12], [13], [14].xy, [15].rgb. */
	maskScale: number
	attributes: CharacterJewelVec3
	distanceScale: CharacterJewelVec4
	intensityAndDLSS: CharacterJewelVec4
	aaRates: CharacterJewelVec2
	color: CharacterJewelVec3
	diffuse: CharacterJewelVec3
}

/** PS143–232. Hash arithmetic wraps at uint32; source negative cells are not
 * replaced by abs(position). All clock/primitive/AA inputs remain explicit. */
export function characterJewelGlint(input: CharacterJewelGlintInput): CharacterJewelVec3 {
	const f = Math.fround;

	const attributes: CharacterJewelVec4 = [
		input.attributes[0],
		f(input.maskGreen * input.maskScale),
		input.attributes[1],
		input.attributes[2],
	];

	const a = attributes.map((value, i) => f(value + f(f(f(value * input.distanceScale[i]!) - value) * input.distanceBlend)));
	const cells = input.localPositionCM.map((value) => Math.floor(f(value * a[0]!)));
	const imad = (x: number, y: number, z: number) => (Math.imul(x, y) + z) | 0;
	let x = imad(cells[0]!, 1664525, 1013904223);
	let y = imad(cells[1]!, 1664525, 1013904223);
	let z = imad(cells[2]!, 1664525, 1013904223);
	x = imad(y, z, x);
	y = imad(z, x, y);
	z = imad(x, y, z);
	x = imad(y, z, x);
	y = imad(z, x, y);
	z = imad(x, y, z);

	const random = [x >>> 16, y >>> 16, z >>> 16].map((value) => f(value / 65536));
	const phase = f(a[3]! * input.gameTime);
	const weights = random.map((value, i) => {
		const sample = f(value + phase);
		const phase1 = f(sample - Math.floor(sample));
		const angle = f(f(phase1 * input.normalDotView) * 6);
		const triangle = f(Math.abs(f(f(angle - Math.floor(angle)) - 0.5)) * 2);
		const denominator = Math.max(f(f(triangle * f(f(a[2]! * triangle) - triangle)) + 1), 0.005);
		const weight = f(a[2]! / f(denominator * f(denominator * Math.fround(Math.PI))));
		return a[1]! >= random[(i + 2) % 3]! ? weight : 0;
	});
	let intensity = f(f(f(weights[0]! * weights[0]!) + f(weights[1]! * weights[1]!)) + f(weights[2]! * weights[2]!));
	intensity = f(intensity * f(f(f(input.intensityAndDLSS[0] - 1) * input.distanceBlend) + 1));

	const method = Math.trunc(input.aaMethod);
	if (method === 9) intensity = Math.min(intensity, 50);
	const scale = f(intensity / Math.max(intensity, 0.001));
	const capped99999 = f(Math.min(Math.max(intensity, 0.001), 99999) * scale);
	const capped15 = f(Math.min(Math.max(intensity, 0.001), 15) * scale);
	const sign = f(intensity / Math.sqrt(Math.max(f(intensity * intensity), 0.001)));
	let result = intensity;
	if (method === 5) {
		const rate = f(
			f(f(input.intensityAndDLSS[1] - input.intensityAndDLSS[2]) * input.vertexFactor) +
				input.intensityAndDLSS[2],
		);
		result = f(
			intensity *
				f(
					f(f(rate - input.intensityAndDLSS[3]) * input.globalAttributeFactor) +
						input.intensityAndDLSS[3],
				),
		);
	}

	if (method === 1)
		result = Math.min(f(sign * f(f(f(input.swapLightFactor + 1) * 0.5) * 50 + 50)), f(intensity * input.aaRates[0]));

	if (method === 9) result = Math.min(intensity, f(sign * input.aaRates[1]));
	if (method === 11) result = capped99999;
	if (method === 10) result = capped15;
	return rgb((i) => f(result * f(input.diffuse[i] * input.color[i])));
}

export interface CharacterJewelSamples {
	diffuse: CharacterJewelVec4
	twoUColor: CharacterJewelVec3
	refraction: CharacterJewelVec3
	reflection: CharacterJewelVec3
	bump: CharacterJewelVec3
}

/** Compiler-material ABI for PS86–343, after preshader evaluation. Keeping the
 * evaluated inputs prevents alpha/intensity and blend direction being guessed
 * from similarly named author parameters. Cube samples are source-linear RGB. */
export interface CharacterJewelColorParameters {
	twoUBias: number
	specFollowDiffuse: number
	hueRadians: number
	hdrDesaturation: number
	refractionContrast: number
	refractionTint: CharacterJewelVec3
	diffuseTint: CharacterJewelVec3
	refractionAmount: number
	reflectionExponent: number
	reflectionScale: number
	reflectionBase: number
	reflectionTint: CharacterJewelVec3
	reflectionFollowDiffuse: number
	useRGBBump: number
	bumpTint: CharacterJewelVec3
	bumpFollowDiffuse: number
}

function characterJewelHDR(sample: CharacterJewelVec3, radians: number, desaturation: number): CharacterJewelVec3 {
	const axis = 0.57735;
	const center = (sample[0] + sample[1] + sample[2]) * axis * axis;
	const centered: CharacterJewelVec3 = [sample[0] - center, sample[1] - center, sample[2] - center];

	const cross: CharacterJewelVec3 = [
		axis * (centered[2] - centered[1]),
		axis * (centered[0] - centered[2]),
		axis * (centered[1] - centered[0]),
	];

	const rotated = rgb((i) => centered[i] * Math.cos(radians) + cross[i] * Math.sin(radians) + center);
	const gray = rotated[0] * 0.3 + rotated[1] * 0.59 + rotated[2] * 0.11;
	return rgb((i) => rotated[i] + (gray - rotated[i]) * desaturation);
}

/** Actual colour subgraph before DIY/TOD, emission adaptation and GBuffer
 * lighting. glint is the source primitive/clock-dependent result, not a default.
 * This function alone does not admit a material or constitute a model renderer. */
export function characterJewelColorCore(
	samples: CharacterJewelSamples,
	p: CharacterJewelColorParameters,
	normalDotView: number,
	highlights: CharacterJewelVec3,
	glint: CharacterJewelVec3,
): CharacterJewelVec3 {
	const base = rgb((i) => saturate(samples.twoUColor[i] + p.twoUBias) * samples.diffuse[i]);
	const refraction = characterJewelHDR(samples.refraction, p.hueRadians, p.hdrDesaturation);
	const reflection = characterJewelHDR(samples.reflection, p.hueRadians, p.hdrDesaturation);
	const edge = Math.max(Math.abs(1 - Math.max(normalDotView, 0)), 0.0001);
	const reflectionAmount = Math.pow(edge, p.reflectionExponent) * p.reflectionScale + p.reflectionBase;
	const diffuseAmount = samples.diffuse[3] * p.refractionAmount;
	return rgb((i) => {
		const v = base[i];
		const refracted = v * positivePower(refraction[i], p.refractionContrast) * p.refractionTint[i];
		const refractionBlend = refracted + (v * p.diffuseTint[i] - refracted) * diffuseAmount;
		const reflectionTint = p.reflectionTint[i] * (1 + (v - 1) * p.reflectionFollowDiffuse);
		const bump = samples.bump[0] + (samples.bump[i] - samples.bump[0]) * p.useRGBBump;
		const bumpTint = p.bumpTint[i] * (1 + (v - 1) * p.bumpFollowDiffuse);
		const spec = highlights[i] * (1 + (v - 1) * p.specFollowDiffuse);
		return (
			refractionBlend +
			reflection[i] * reflectionAmount * reflectionTint +
			bump * bumpTint +
			spec +
			glint[i]
		);
	});
}

/** Shared GPU equations; the material and scene provider own texture sampling
 * and current primitive/View/TOD inputs. */
export const characterJewelNativeMath = /* glsl */ `
vec3 characterJewelSourceLight(vec3 primary, vec3 limited, float ready) {
  return abs(ready)>0.00001 && ready>=0.0 ? limited : primary;
}
float characterJewelPositivePower(float value, float exponent) {
  return value<=0.0 ? 0.0 : exp2(log2(value)*exponent);
}
vec3 characterJewelSourceNormal(vec2 rg, float flatness, mat3 frame,
    float nativeSign, float fixTwoSide, bool twoSided, vec4 normalOverride) {
  vec2 xy=rg*2.0-1.0;
  vec3 n=vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));
  n=mix(n,vec3(0.0,0.0,1.0),flatness);
  float sign=twoSided?nativeSign:1.0;
  float fix=twoSided?mix(sign,1.0,fixTwoSide):1.0;
  n=normalize(n*fix*normalOverride.w+normalOverride.xyz);
  return normalize(frame*n)*sign;
}
vec3 characterJewelSourceRefractionDirection(vec2 rg, mat3 frame, vec3 view, float distortion) {
  vec2 xy=rg*2.0-1.0;
  vec3 n=vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));
  return -normalize(view+frame*n*distortion);
}
vec3 characterJewelSourceHighlights(vec3 n, vec3 view, vec3 light, vec4 strip, vec4 sphere) {
  vec3 reflected=2.0*dot(n,view)*n-view;
  float stripAmount=characterJewelPositivePower(1.0-abs(dot(normalize(light+0.01),reflected)),strip.x);
  float sphereAmount=characterJewelPositivePower(clamp(dot(normalize(view+light),n),0.0,1.0),sphere.x);
  return stripAmount*strip.yzw+sphereAmount*sphere.yzw;
}
vec3 characterJewelSourceFill(float sourceNormalZ, vec3 sky, vec3 ground, float intensity, vec3 lightColor) {
  float t=clamp(sourceNormalZ+0.5,0.0,1.0);
  float blend=t*t*(3.0-2.0*t);
  return mix(ground,sky,blend)*intensity*min(length(max(lightColor,vec3(0.12))),1.0);
}
vec3 characterJewelSourceGlint(vec3 localCM, float maskGreen, float ndotv, float distanceBlend,
    float vertexFactor, float gameTime, int aaMethod, float globalFactor, float swapLightFactor,
    vec3 diffuse, vec4 material[39]) {
  vec4 a=vec4(material[11].x,maskGreen*material[10].w,material[11].yz);
  a=mix(a,a*material[12],distanceBlend);
  uvec3 cell=uvec3(ivec3(floor(localCM*a.x)));
  cell=cell*1664525u+1013904223u;
  cell.x+=cell.y*cell.z;
  cell.y+=cell.z*cell.x;
  cell.z+=cell.x*cell.y;
  cell.x+=cell.y*cell.z;
  cell.y+=cell.z*cell.x;
  cell.z+=cell.x*cell.y;
  vec3 random=vec3(cell>>16u)*(1.0/65536.0);
  vec3 gate=step(random.zxy,vec3(a.y));
  vec3 triangle=abs(fract(fract(random+a.w*gameTime)*ndotv*6.0)-0.5)*2.0;
  vec3 denominator=max(triangle*(triangle*a.z-triangle)+1.0,vec3(0.005));
  vec3 weights=a.z/(denominator*denominator*3.141592653589793)*gate;
  float intensity=dot(weights,weights)*mix(1.0,material[13].x,distanceBlend);
  if(aaMethod==9) intensity=min(intensity,50.0);
  float scale=intensity/max(intensity,0.001);
  float sign=intensity*inversesqrt(max(intensity*intensity,0.001));
  float result=intensity;
  if(aaMethod==5) result*=mix(material[13].w,mix(material[13].z,material[13].y,vertexFactor),globalFactor);
  if(aaMethod==1) result=min(sign*((swapLightFactor+1.0)*0.5*50.0+50.0),intensity*material[14].x);
  if(aaMethod==9) result=min(intensity,sign*material[14].y);
  if(aaMethod==11) result=min(max(intensity,0.001),99999.0)*scale;
  if(aaMethod==10) result=min(max(intensity,0.001),15.0)*scale;
  return result*diffuse*material[15].rgb;
}
vec3 characterJewelSourceHDR(vec3 sampleColor, float hueRadians, float desaturation) {
  vec3 axis=vec3(0.57735);
  vec3 center=axis*dot(axis,sampleColor);
  vec3 c=sampleColor-center;
  c=c*cos(hueRadians)+cross(axis,c)*sin(hueRadians)+center;
  return mix(c,vec3(dot(c,vec3(0.3,0.59,0.11))),desaturation);
}
vec3 characterJewelSourceColor(vec4 diffuse, vec3 twoUColor, vec3 refraction, vec3 reflection,
    vec3 bump, float ndotv, vec3 highlights, vec3 glint, vec4 material[39]) {
  vec3 base=clamp(twoUColor+material[9].x,0.0,1.0)*diffuse.rgb;
  refraction=characterJewelSourceHDR(refraction,material[15].w,material[16].z);
  refraction=vec3(characterJewelPositivePower(refraction.r,material[16].w),
    characterJewelPositivePower(refraction.g,material[16].w),characterJewelPositivePower(refraction.b,material[16].w));
  vec3 color=mix(base*refraction*material[17].xyz,base*material[18].xyz,diffuse.a*material[18].w);
  reflection=characterJewelSourceHDR(reflection,material[15].w,material[16].z);
  float edge=max(abs(1.0-max(ndotv,0.0)),0.0001);
  float amount=exp2(log2(edge)*material[19].x)*material[19].y+material[19].z;
  color+=reflection*amount*material[20].rgb*mix(vec3(1.0),base,material[20].a);
  color+=mix(bump.rrr,bump,material[21].z)*material[22].rgb*mix(vec3(1.0),base,material[22].a);
  return color+highlights*mix(vec3(1.0),base,material[10].z)+glint;
}
`;

export interface CharacterJewelSurfaceInputs {
	uniforms: readonly CharacterJewelVec4[]
	colorCore: CharacterJewelVec3
	twoUColor: CharacterJewelVec3
	normalDotView: number
	normalDotLight: number
	bumpAlpha: number
	maskRed: number
	dissolveNoise: number
	spatialDissolve: number
	edgeMask: number
	sourceNormalZ: number
	lighting: CharacterJewelLighting
	globalFactor: number
	inversePreExposure: number
	preExposure: number
	vfxBaseAttenuation: boolean
}

/** Current PS DIY/TOD, material emission and GBuffer inputs. Deferred lighting
 * is deliberately separate: a preview can replace that pass without losing
 * the animated glint, actual MPC selection or the source material equations. */
export function characterJewelSurface(input: CharacterJewelSurfaceInputs): {
	baseColor: CharacterJewelVec3
	emission: CharacterJewelVec3
	metalness: number
	specular: number
	roughness: number
} {
	const m = input.uniforms;
	if (m.length !== 39 || !m.every((row) => row.length === 4 && row.every(Number.isFinite))) throw new Error('[CharacterJewel] current 39-row source ABI required');

	const luma = (c: CharacterJewelVec3) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
	const coreLuma = luma(input.colorCore);
	let color = rgb((i) => {
		const diy =
			(input.twoUColor[i] * m[23]![i] + m[23]![3]) *
			m[24]![0] *
			(input.colorCore[i] + (coreLuma - input.colorCore[i]) * 0.9);
		const value = input.colorCore[i] + (diy - input.colorCore[i]) * m[9]![0];
		return value * (input.vfxBaseAttenuation ? 1 - m[24]![1] : 1);
	});
	const saturation = 1 + (m[25]![0] - 1) * input.globalFactor;
	const brightness = 1 + (m[25]![1] - 1) * input.globalFactor;
	const contrast = 1 + (m[25]![2] - 1) * input.globalFactor;
	const specular = 1 + (m[25]![3] - 1) * input.globalFactor;
	const gray = luma(color);
	color = rgb((i) => positivePower((gray + (color[i] - gray) * saturation) * brightness, contrast));

	const light = characterJewelLight(input.lighting).color;
	const attenuation = (saturate(input.normalDotLight) * (1 - m[26]![0]) + m[26]![0]) * m[26]![1];
	let emission = rgb((i) => color[i] * Math.min(1, Math.max(0.15, light[i])) * attenuation * input.inversePreExposure);
	const edge = Math.max(Math.abs(1 - Math.max(input.normalDotView, 0)), 0.0001);
	const force = rgb((i) => m[28]![i] + (m[27]![i] - m[28]![i]) * edge ** 3);
	emission = rgb((i) => emission[i] + (force[i] * 2 - emission[i]) * m[28]![3]);

	const spatial = input.spatialDissolve + (1 - 2 * input.spatialDissolve) * m[30]![1];
	const maskedSpatial = saturate(spatial - input.dissolveNoise * m[30]![2]);
	const noise = input.dissolveNoise + (maskedSpatial - input.dissolveNoise) * m[30]![3];
	const threshold = m[32]![0] * m[32]![1] + m[32]![2];
	const d = saturate((noise - threshold - m[33]![0]) / (m[32]![3] - m[33]![0]));
	const dissolve = d * d * (3 - 2 * d);
	emission = rgb(
		(i) =>
			m[33]![i + 1]! +
			(emission[i] - m[33]![i + 1]!) * dissolve +
			2 ** (Math.log2(edge) * m[34]![0]) * m[34]![i + 1]! * m[35]![0] * input.edgeMask * m[35]![1],
	);

	const exposureDivisor = Math.max(0.1, 1 + (input.preExposure - 1) * m[35]![2]);
	if (input.preExposure > 1) emission = rgb((i) => emission[i] / exposureDivisor);
	color = rgb((i) => {
		const forced = color[i] + (force[i] - color[i]) * m[28]![3];
		const dissolved = m[33]![i + 1]! + (forced - m[33]![i + 1]!) * dissolve;
		return saturate(dissolved * (1 + (m[36]![i] - 1) * m[36]![3] * m[35]![1]));
	});

	const metalness = saturate(m[37]![1] + (m[37]![0] - m[37]![1]) * input.bumpAlpha);
	const fill = characterJewelFill(input.sourceNormalZ, input.lighting);
	emission = rgb((i) => {
		const c = color[i];
		const energy = Math.max(1, 2.0404 * c - 0.3324 - 4.7951 * c + 2.7552 * c + 1.332);
		const value = emission[i] + energy * (1 - metalness) * fill[i] * c;
		return Math.max(value + (m[38]![i] - value) * m[37]![2], 0);
	});
	return {
		baseColor: color,
		emission,
		metalness,
		specular: saturate(specular),
		roughness: saturate(input.maskRed * m[38]![3]),
	};
}
