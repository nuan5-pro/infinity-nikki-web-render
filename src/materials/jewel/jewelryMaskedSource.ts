/** Exact active kernels of de3c / LocalVF430. No derivative/CUE basis substitution. */
export const jewelryMaskedPixelShader = 'de3c099d936f36fb3e154e5091c2a7a74739f75b';
export const jewelryMaskedLocalVertexShader = '43071e5f3621a4c86ec3840d8bdf24cb9221f47d';
export const jewelryMaskedPreshader = '4f195da1b67177002ca34193c782c057fbe67436d2934179394ecb8150ac030f';

export type MaskedVec2 = readonly [number, number];

export type MaskedVec3 = readonly [number, number, number];

export type MaskedVec4 = readonly [number, number, number, number];

const f = Math.fround;
const add = (a: number, b: number) => f(f(a) + f(b));
const mul = (a: number, b: number) => f(f(a) * f(b));
const div = (a: number, b: number) => f(f(a) / f(b));
const sat = (value: number) => Math.max(0, Math.min(1, value));

const finite = (values: readonly number[]) => {
	if (!values.every(Number.isFinite)) throw new Error('[JewelryMasked] nonfinite source input');
};

const floatFromDWORD = (value: number) => new Float32Array(new Uint32Array([value]).buffer)[0]!;
// Actual instruction236 DWORD is 0x37800080, NOT 1/65536 or printed .000015.
export const jewelryMaskedHashScale = floatFromDWORD(0x37800080);
const sourcePi = floatFromDWORD(0x40490fdb);

function cross(a: MaskedVec3, b: MaskedVec3): [number, number, number] {
	return [
		add(mul(a[1], b[2]), -mul(a[2], b[1])),
		add(mul(a[2], b[0]), -mul(a[0], b[2])),
		add(mul(a[0], b[1]), -mul(a[1], b[0])),
	];
}

function normalize(value: MaskedVec3): [number, number, number] {
	const square = add(add(mul(value[0], value[0]), mul(value[1], value[1])), mul(value[2], value[2]));
	if (!(square > 0) || !Number.isFinite(square)) throw new Error('[JewelryMasked] singular source normal');

	const inverse = f(1 / Math.sqrt(square));
	return [mul(value[0], inverse), mul(value[1], inverse), mul(value[2], inverse)];
}

export interface JewelryMaskedFrame {
	tangent: MaskedVec3
	bitangent: MaskedVec3
	normal: MaskedVec3
}

export function jewelryMaskedDecodePackedBasis(packedX: number, packedZ: number): JewelryMaskedFrame {
	if (
		![packedX, packedZ].every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff)
	) throw new Error('[JewelryMasked] native DWORDs require exact UInt32 transport');

	const decode = (word: number) =>
		[0, 8, 16, 24].map((shift) => {
			const byte = (word >>> shift) & 255;
			return f(Math.max(-1, (byte >= 128 ? byte - 256 : byte) / 127));
		});

	const x = decode(packedX);
	const z = decode(packedZ);
	return jewelryMaskedLocalFrame([x[0]!, x[1]!, x[2]!], [z[0]!, z[1]!, z[2]!, z[3]!]);
}

/** Source SRV values are SNORM int8/127; v1.w preserves exact native handedness. */
export function jewelryMaskedLocalFrame(rawTangent: MaskedVec3, rawNormal: MaskedVec4): JewelryMaskedFrame {
	finite([...rawTangent, ...rawNormal]);
	if (
		![...rawTangent, ...rawNormal.slice(0, 3)].every((value) => Math.abs(value) <= 1 && f(Math.round(value * 127) / 127) === f(value))
	) throw new Error('[JewelryMasked] input requires native SNORM8');
	if (Math.abs(rawNormal[3]) !== 1) throw new Error('[JewelryMasked] unproved native handedness');

	const normal: MaskedVec3 = [rawNormal[0], rawNormal[1], rawNormal[2]];
	const first = cross(normal, rawTangent).map((value) => mul(value, rawNormal[3])) as [
		number,
		number,
		number,
	];
	const tangent = cross(first, normal).map((value) => mul(value, rawNormal[3])) as [
		number,
		number,
		number,
	];
	const bitangent = cross(normal, tangent).map((value) => mul(value, rawNormal[3])) as [
		number,
		number,
		number,
	];
	return { tangent, bitangent, normal };
}

/** PS78–81: callers provide centroid-interpolated VS outputs, not raw SRV bytes. */
export function jewelryMaskedPixelFrame(tangent: MaskedVec3, normal: MaskedVec3, handedness: number): JewelryMaskedFrame {
	finite([...tangent, ...normal, handedness]);
	if (Math.abs(handedness) > 1) throw new Error('[JewelryMasked] pixel handedness exceeds the source domain');

	const bitangent = cross(normal, tangent).map((value) => mul(value, handedness)) as [
		number,
		number,
		number,
	];
	return { tangent, normal, bitangent };
}

export function jewelryMaskedReflectionNormal(rg: MaskedVec2, frame: JewelryMaskedFrame): [number, number, number] {
	finite([...rg, ...frame.tangent, ...frame.bitangent, ...frame.normal]);

	const x = add(mul(rg[0], 2), -1);
	const y = add(mul(rg[1], 2), -1);
	const z = f(Math.sqrt(Math.max(add(1, -add(mul(x, x), mul(y, y))), 0)));
	// PS457-461 has NO normalize. G remains native; no global Three normal flip.
	return [0, 1, 2].map((i) => add(add(mul(frame.tangent[i]!, x), mul(frame.bitangent[i]!, y)), mul(frame.normal[i]!, z))) as [number, number, number];
}

export function jewelryMaskedSurfaceNormal(rg: MaskedVec2, flatten: number, override: MaskedVec4, frame: JewelryMaskedFrame): [number, number, number] {
	finite([...rg, flatten, ...override]);

	const raw = jewelryMaskedReflectionNormal(rg, {
		tangent: [1, 0, 0],
		bitangent: [0, 1, 0],
		normal: [0, 0, 1],
	});
	const local = normalize(
		raw.map((value, i) => add(mul(add(value, mul(add(i === 2 ? 1 : 0, -value), flatten)), override[3]), override[i]!)) as [number, number, number],
	);
	return normalize(
		[0, 1, 2].map((i) => add(add(mul(frame.tangent[i]!, local[0]), mul(frame.bitangent[i]!, local[1])), mul(frame.normal[i]!, local[2]))) as [number, number, number],
	);
}

export interface JewelryMaskedPomInput {
	uv: MaskedVec2
	tangentView: MaskedVec3
	heightRatio: number
	noiseR: number
	phase: number
	dx: MaskedVec2
	dy: MaskedVec2
}

export type JewelryMaskedHeightSampler = (uv: MaskedVec2, dx: MaskedVec2, dy: MaskedVec2) => number;

export function jewelryMaskedPom(input: JewelryMaskedPomInput, sample: JewelryMaskedHeightSampler) {
	finite([
		...input.uv,
		...input.tangentView,
		input.heightRatio,
		input.noiseR,
		input.phase,
		...input.dx,
		...input.dy,
	]);
	if (
		!(input.noiseR >= 0 && input.noiseR <= 1) ||
		!Number.isInteger(input.phase) ||
		input.phase < 0 ||
		input.phase > 4 ||
		input.tangentView[2] === 0
	) throw new Error('[JewelryMasked] unproved noise domain or grazing source ray');

	const jitter = sat(mul(add(add(mul(add(input.phase, input.noiseR), 0.2), -1), -0.5), 2));
	const maximum = mul(add(1, mul(jitter, 0.2)), 24);
	const steps = add(maximum, mul(Math.min(Math.abs(f(input.tangentView[2])), 1), add(8, -maximum)));
	const depthStep = div(1, steps);

	const ray: MaskedVec2 = [
		mul(mul(div(-input.tangentView[0], input.tangentView[2]), input.heightRatio), depthStep),
		mul(mul(div(-input.tangentView[1], input.tangentView[2]), input.heightRatio), depthStep),
	];

	let offset: [number, number] = [0, 0];
	let depth = 1;
	let previousDepth = 1;
	let previousHeight = 1;
	let sampledSteps = 0;
	for (let index = 0; index < Math.floor(steps) + 2; index++) {
		const height = f(sample([add(input.uv[0], offset[0]), add(input.uv[1], offset[1])], input.dx, input.dy));
		sampledSteps++;
		if (!(height >= 0 && height <= 1)) throw new Error('[JewelryMasked] height R requires a finite normalized value');

		if (depth < height) {
			const numerator = add(height, -depth);
			const denominator = add(numerator, add(previousDepth, -previousHeight));
			if (denominator === 0) throw new Error('[JewelryMasked] source POM crossing denominator zero');

			const fraction = div(numerator, denominator);
			offset = [add(offset[0], -mul(ray[0], fraction)), add(offset[1], -mul(ray[1], fraction))];
			break;
		}

		previousDepth = depth;
		previousHeight = height;
		depth = add(depth, -depthStep);
		offset = [add(offset[0], ray[0]), add(offset[1], ray[1])];
	}

	return {
		uv: [add(input.uv[0], offset[0]), add(input.uv[1], offset[1])] as MaskedVec2,
		steps,
		sampledSteps,
		jitter,
	};
}

export function jewelryMaskedIntegerHash(cell: MaskedVec3): [number, number, number] {
	if (
		!cell.every((value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)
	) throw new Error('[JewelryMasked] source ftoi cell outside int32');

	let [x, y, z] = cell.map((value) => (Math.imul(value, 1664525) + 1013904223) >>> 0) as [
		number,
		number,
		number,
	];
	x = (x + Math.imul(y, z)) >>> 0;
	y = (y + Math.imul(z, x)) >>> 0;
	z = (z + Math.imul(x, y)) >>> 0;

	const a = (x + Math.imul(y, z)) >>> 0;
	const b = (y + Math.imul(z, a)) >>> 0;
	const c = (z + Math.imul(a, b)) >>> 0;
	return [
		mul(a >>> 16, jewelryMaskedHashScale),
		mul(b >>> 16, jewelryMaskedHashScale),
		mul(c >>> 16, jewelryMaskedHashScale),
	];
}

export interface JewelryMaskedGlintInput {
	localPositionCM: MaskedVec3
	/** PS r6 = density, SRMA.B*adjust.B*threshold, sharpness, animation speed. */
	attributes: MaskedVec4
	editorTimeSeconds: number
	sourceEmissionFactor: number
}
/** PS224-256, before explicit distance/AA-branch intensity transport. */
export function jewelryMaskedGlintKernel(input: JewelryMaskedGlintInput) {
	finite([
		...input.localPositionCM,
		...input.attributes,
		input.editorTimeSeconds,
		input.sourceEmissionFactor,
	]);

	const cell = input.localPositionCM.map((value) => Math.floor(mul(value, input.attributes[0]))) as [number, number, number];
	const hash = jewelryMaskedIntegerHash(cell);
	const selection = [hash[2], hash[0], hash[1]].map((value) => input.attributes[1] >= value ? 1 : 0);
	const clock = mul(input.attributes[3], input.editorTimeSeconds);
	finite([clock]);

	const lobes = hash.map((value, i) => {
		const phase = add(value, clock);
		const wrapped = add(phase, -Math.floor(phase));
		const oscillation = mul(mul(wrapped, input.sourceEmissionFactor), 6);
		finite([oscillation]);

		const triangle = mul(Math.abs(add(add(oscillation, -Math.floor(oscillation)), -0.5)), 2);
		const width = Math.max(add(mul(triangle, add(mul(input.attributes[2], triangle), -triangle)), 1), f(0.005));
		return mul(div(input.attributes[2], mul(width, mul(width, sourcePi))), selection[i]!);
	}) as [number, number, number];
	return {
		cell,
		hash,
		lobes,
		intensity: add(add(mul(lobes[0], lobes[0]), mul(lobes[1], lobes[1])), mul(lobes[2], lobes[2])),
	};
}

export interface JewelryMaskedGlintIntensityInput {
	rawIntensity: number
	distanceBlend: number
	distanceIntensityScale: number
	aaType: number
	shadowVisibility: number
	globalAttributeFactor: number
	swapLightFactor: number
	dlssWorldRate: MaskedVec2
	dlssEmissiveRate: number
	fsrEmissiveRate: number
	xessEmissiveMaximum: number
}

/** All PS257-310 AA branches, including its source soft-sign near zero. */
export function jewelryMaskedGlintIntensity(input: JewelryMaskedGlintIntensityInput): number {
	finite([
		input.rawIntensity,
		input.distanceBlend,
		input.distanceIntensityScale,
		input.aaType,
		input.shadowVisibility,
		input.globalAttributeFactor,
		input.swapLightFactor,
		...input.dlssWorldRate,
		input.dlssEmissiveRate,
		input.fsrEmissiveRate,
		input.xessEmissiveMaximum,
	]);
	if (
		input.rawIntensity < 0 ||
		!Number.isInteger(input.aaType) ||
		input.shadowVisibility < 0 ||
		input.shadowVisibility > 1
	) throw new Error('[JewelryMasked] invalid source intensity/AA/shadow input');

	let intensity = mul(input.rawIntensity, add(mul(add(input.distanceIntensityScale, -1), input.distanceBlend), 1));
	if (input.aaType === 9) intensity = Math.min(intensity, 50);
	const denominator = Math.max(intensity, f(0.001));
	const ratio = div(intensity, denominator);
	const broad = mul(ratio, Math.min(denominator, 99999));
	const limited = mul(ratio, Math.min(denominator, 15));
	const world = add(mul(add(input.dlssWorldRate[0], -input.dlssWorldRate[1]), input.shadowVisibility), input.dlssWorldRate[1]);
	const original = intensity;
	const dlss = mul(intensity, add(mul(add(world, -input.dlssEmissiveRate), input.globalAttributeFactor), input.dlssEmissiveRate));
	const soft = mul(intensity, f(1 / Math.sqrt(Math.max(mul(intensity, intensity), f(0.001)))));
	const fsrLimit = mul(soft, add(mul(mul(add(input.swapLightFactor, 1), 0.5), 50), 50));
	if (input.aaType === 5) intensity = dlss;
	if (input.aaType === 1) intensity = Math.min(fsrLimit, mul(original, input.fsrEmissiveRate));
	if (input.aaType === 9) intensity = Math.min(intensity, mul(soft, input.xessEmissiveMaximum));
	if (input.aaType === 11) intensity = broad;
	if (input.aaType === 10) intensity = limited;
	if (!Number.isFinite(intensity)) throw new Error('[JewelryMasked] source intensity float32 overflow');

	return intensity;
}

export const jewelryMaskedActiveKernelsGLSL = /* glsl */ `
vec4 jewelryMaskedSnormDWORD(uint value) {
  ivec4 bytes=ivec4((uvec4(value)>>uvec4(0u,8u,16u,24u))&255u);
  bytes=ivec4(bytes.x>=128?bytes.x-256:bytes.x,bytes.y>=128?bytes.y-256:bytes.y,
      bytes.z>=128?bytes.z-256:bytes.z,bytes.w>=128?bytes.w-256:bytes.w);
  return max(vec4(bytes)/127.0,vec4(-1.0));
}
vec3 jewelryMaskedHash(ivec3 cell) {
  uvec3 v=uvec3(cell)*1664525u+1013904223u;
  v.x+=v.y*v.z; v.y+=v.z*v.x; v.z+=v.x*v.y;
  uvec3 w; w.x=v.x+v.y*v.z; w.y=v.y+v.z*w.x; w.z=v.z+w.x*w.y;
  return vec3(w>>16u)*uintBitsToFloat(0x37800080u);
}
vec3 jewelryMaskedGlintLobes(vec3 localCM, vec4 attributes, float editorTime, float sourceEmissionFactor) {
  vec3 cells=floor(localCM*attributes.x);
  if(any(isnan(cells))||any(isinf(cells))||any(lessThan(cells,vec3(-2147483648.0)))||
     any(greaterThanEqual(cells,vec3(2147483648.0)))) discard;
  vec3 hash=jewelryMaskedHash(ivec3(cells));
  vec3 chosen=step(hash.zxy,vec3(attributes.y));
  float clock=attributes.w*editorTime;
  if(isnan(clock)||isinf(clock)||isnan(sourceEmissionFactor)||isinf(sourceEmissionFactor)) discard;
  vec3 wave=abs(fract(fract(hash+clock)*sourceEmissionFactor*6.0)-0.5)*2.0;
  vec3 width=max(wave*(attributes.z*wave-wave)+1.0,vec3(uintBitsToFloat(0x3ba3d70au)));
  return attributes.z/(width*(width*uintBitsToFloat(0x40490fdbu)))*chosen;
}
float jewelryMaskedGlintAA(float raw, float distanceBlend, float distanceScale, int aaType, float shadow,
    float globalFactor, float swapLightFactor, vec2 dlssWorld, float dlssRate, float fsrRate, float xessMaximum) {
  float intensity=raw*((distanceScale-1.0)*distanceBlend+1.0);
  if(aaType==9) intensity=min(intensity,50.0);
  float denominator=max(intensity,0.001), ratio=intensity/denominator;
  float broad=ratio*min(denominator,99999.0), limited=ratio*min(denominator,15.0);
  float original=intensity;
  float dlss=intensity*((mix(dlssWorld.y,dlssWorld.x,shadow)-dlssRate)*globalFactor+dlssRate);
  float soft=intensity*inversesqrt(max(intensity*intensity,0.001));
  float fsr=min(soft*(((swapLightFactor+1.0)*0.5)*50.0+50.0),intensity*fsrRate);
  if(aaType==5) intensity=dlss;
  if(aaType==1) intensity=fsr;
  if(aaType==9) intensity=min(original,soft*xessMaximum);
  if(aaType==11) intensity=broad;
  if(aaType==10) intensity=limited;
  return intensity;
}
vec2 jewelryMaskedPOM(vec2 uv, vec3 tangentView, float heightRatio, float noiseR, float phase, vec2 dx, vec2 dy) {
  if(tangentView.z==0.0||noiseR<0.0||noiseR>1.0||isnan(noiseR)||isinf(noiseR)) discard;
  float jitter=clamp(((phase+noiseR)*0.2-1.0-0.5)*2.0,0.0,1.0);
  float maximum=(1.0+jitter*0.2)*24.0;
  float steps=maximum+min(abs(tangentView.z),1.0)*(8.0-maximum);
  float depthStep=1.0/steps;
  vec2 ray=(-tangentView.xy/tangentView.z)*heightRatio*depthStep, offset=vec2(0.0);
  float depth=1.0, previousDepth=1.0, previousHeight=1.0;
  for(int index=0;index<31;index++) {
    if(float(index)>=floor(steps)+2.0) break;
    float height=textureGrad(jewelD1,uv+offset,dx,dy).r;
    if(isnan(height)||isinf(height)||height<0.0||height>1.0) discard;
    if(depth<height) {
      float numerator=height-depth, denominator=numerator+previousDepth-previousHeight;
      if(denominator==0.0) discard;
      offset-=ray*(numerator/denominator); break;
    }
    previousDepth=depth; previousHeight=height; depth-=depthStep; offset+=ray;
  }
  return uv+offset;
}
vec3 jewelryMaskedReflectionRG(vec2 rg, mat3 frame) {
  vec2 xy=rg*2.0-1.0;
  return frame*vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));
}
`;
