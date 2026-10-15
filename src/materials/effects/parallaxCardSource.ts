/** Exact skeletal PS6908 source colour/coverage ABI. The caller supplies the
 * reviewed native frame/facing and explicit clock; this is not legacy dispatch. */
export interface ParallaxCardRuntime {
	gameTime: number;
	swapLightFactor: number;
	materialTextureMipBias: number;
	preExposure: number;
	outputClamp: number;
	nativeCullingSign: 1 | -1;
	nativePrimitiveDeterminantSign: 1 | -1;
	nativeFrontFaceParity: 1 | -1;
}

export function validateParallaxCardRuntime(value: ParallaxCardRuntime): void {
	const numbers = [
		value.gameTime,
		value.swapLightFactor,
		value.materialTextureMipBias,
		value.preExposure,
		value.outputClamp,
		value.nativeCullingSign,
		value.nativePrimitiveDeterminantSign,
		value.nativeFrontFaceParity,
	];

	if (
		!numbers.every(Number.isFinite) ||
		value.preExposure <= 0 ||
		value.outputClamp <= 0 ||
		![
			value.nativeCullingSign,
			value.nativePrimitiveDeterminantSign,
			value.nativeFrontFaceParity,
		].every((sign) => sign === 1 || sign === -1)
	) throw new Error('[ModelManager][ParallaxCard] explicit native frame/view/clock ABI required');
}

// Input T/N/B are the actual VS-normalized then linearly interpolated frame.
// Do not normalize again per fragment, use abs(NdotV), clamp the signed ray,
// freeze the clock, or turn Character.a into geometry opacity.
export const parallaxCardNativeCore = /* glsl */ `
vec4 parallaxCardNativeColor(vec2 uv, vec3 nativeT, vec3 nativeB, vec3 nativeN, vec3 view) {
  float face=(gl_FrontFacing?1.0:-1.0)*cardNativeFrontFaceParity;
  float facing=clamp(cardNativeCullingSign*cardNativePrimitiveDeterminantSign*face,0.0,1.0);
  float signedNdotV=dot(nativeN,view)*(1.0-2.0*facing);
  vec2 tangentView=vec2(dot(nativeT,view),dot(nativeB,view));
  vec2 bgUV=uv*cardTilingBG+tangentView*(cardDepthBG/signedNdotV);
  vec3 bg=texture2D(cardD,bgUV,cardMipBias).rgb;
  vec3 bgEmissive=texture2D(cardT,bgUV,cardMipBias).rgb;
  float night=clamp(1.0-cardSwapLightFactor,0.0,1.0);
  bg=bg*mix(cardBaseDay,cardBaseNight,night)+bgEmissive*mix(cardBGDay,cardBGNight,night);
  vec2 charUV=uv*cardTilingCharacter+tangentView*(cardDepth/signedNdotV)+cardCharacterOffset;
  vec3 charEmissive=texture2D(cardT1,charUV,cardMipBias).rgb;
  vec4 character=texture2D(cardD1,charUV,cardMipBias);
  vec2 window=vec2(1.0)-min(abs(floor(charUV)),vec2(1.0));
  character*=window.x*window.y;
  vec3 charColor=charEmissive*mix(cardCharacterDay,cardCharacterNight,night)+character.rgb;
  float noise=texture2D(cardO,charUV+cardGameTime*cardNoiseSpeed,cardMipBias).r;
  charColor*=noise*cardNoiseIntensity*cardCharacterColor;
  vec3 color=mix(bg,charColor,character.a);
  color=mix(color,cardSelectionColor.rgb,cardSelectionColor.a);
  color=min(max(color,vec3(0.0))*cardPreExposure,vec3(cardOutputClamp));
  return vec4(color,1.0);
}
`;

export interface ParallaxCardSamples {
	bg: [number, number, number];
	bgEmissive: [number, number, number];
	character: [number, number, number, number];
	characterEmissive: [number, number, number];
	/** Decoded native sRGB texture R, not a guessed linear/noise-default value. */
	noiseR: number;
}

export interface ParallaxCardColors {
	'Emissive Base Color': number[];
	'Emissive Base Color Night': number[];
	'Emissive BG Color': number[];
	'Emissive BG Color Night': number[];
	'Emissive Character Color': number[];
	'Emissive Character Color Night': number[];
	CharacterColor: number[];
	SelectionColor: number[];
}

/** CPU counterpart of ASM86–118, for native-equation regression only. It does
 * not substitute a synthetic sample set for an actual model render. */
export function parallaxCardSampleColor(
	colors: ParallaxCardColors,
	samples: ParallaxCardSamples,
	charUV: [number, number],
	noiseIntensity: number,
	runtime: ParallaxCardRuntime,
): [number, number, number, number] {
	validateParallaxCardRuntime(runtime);

	const night = Math.max(0, Math.min(1, 1 - runtime.swapLightFactor));
	const window = charUV.reduce((value, coord) => value * (1 - Math.min(Math.abs(Math.floor(coord)), 1)), 1);
	const alpha = samples.character[3] * window;
	const selection = colors.SelectionColor;
	const channels = [0, 1, 2].map((i) => {
		const blend = (day: string, dusk: string) => {
			const typedDay = day as keyof ParallaxCardColors;
			const typedDusk = dusk as keyof ParallaxCardColors;
			return colors[typedDay][i]! * (1 - night) + colors[typedDusk][i]! * night;
		};

		const bg =
			samples.bg[i]! * blend('Emissive Base Color', 'Emissive Base Color Night') +
			samples.bgEmissive[i]! * blend('Emissive BG Color', 'Emissive BG Color Night');
		const character =
			(samples.characterEmissive[i]! *
				blend('Emissive Character Color', 'Emissive Character Color Night') +
				samples.character[i]! * window) *
			samples.noiseR *
			noiseIntensity *
			colors.CharacterColor[i]!;
		const color = bg * (1 - alpha) + character * alpha;
		return Math.min(
			Math.max(color * (1 - selection[3]!) + selection[i]! * selection[3]!, 0) *
				runtime.preExposure,
			runtime.outputClamp,
		);
	});
	return [channels[0]!, channels[1]!, channels[2]!, 1];
}
