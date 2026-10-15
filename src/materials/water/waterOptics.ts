// d4a941 PS 3047-3056: Schlick phase, including its 1/(4*pi) normalization.
export const waterPhaseShader = /* glsl */ `
float waterSchlickPhase(float g, float cosine) {
  float k = 1.55 * g - 0.55 * g * g * g;
  float denominator = 1.0 + k * cosine;
  return (1.0 - k * k) / max(4.0 * PI * denominator * denominator, 1e-6);
}
`;

/** Reuse the already-shadowed sun irradiance, without another shadow lookup. */
export function waterVolumeLights(source: string): string {
	const start = source.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
	const end = source.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )', start);
	const direct = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
	const directional = source.slice(start, end);
	if (start < 0 || end < start || directional.split(direct).length !== 2) throw new Error('Water volume lighting requires the captured Three directional-light chunk');

	const augmented = directional.replace(
		direct,
		`${direct}
    {
     float waterSqrtF0 = sqrt(clamp(waterF0, 0.0, 1.0));
    float waterRelativeIOR = (1.0 - waterSqrtF0) / (1.0 + waterSqrtF0);
    vec3 waterUnderRay = refract(-geometryViewDir, geometryNormal, waterRelativeIOR);
    waterDirectionalScatter += directLight.color * waterSchlickPhase(waterAnisotropy, dot(-directLight.direction, waterUnderRay));
    }`,
	);
	return (
		'vec3 waterDirectionalScatter = vec3(0.0);\n' +
		source.slice(0, start) +
		augmented +
		source.slice(end)
	);
}
