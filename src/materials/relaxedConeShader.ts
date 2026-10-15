/** Captured Lightmass UP1 PS cone consumer. Parent supplies native raw UV and
 * tangent-space camera vector before normal mapping, and owns D/N/ORM shading.
 * R is relaxed-cone ratio; G is inverted surface height. D alpha is unrelated.
 * Four material samplers including this H sampler, one PBR pass.
 */
export const relaxedConeShader = `
vec2 furnitureRelaxedConeUV(
  sampler2D coneMap, vec2 uv, vec3 tangentView, float heightRatio, int steps
) {
  vec3 view = normalize(tangentView);
  float vz = abs(view.z);
  // Native division at exactly grazing incidence is undefined. The preview
  // retains input UV at that singularity rather than inventing height/color.
  if (vz == 0.0) return uv;
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  float grazing = 1.0 - pow(1.0 - vz, 8.0);
  vec3 ray = vec3(-view.xy * heightRatio * grazing / vz, 1.0);
  float travel = length(ray.xy);
  vec3 point = vec3(uv, 0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    vec2 cone = textureGrad(coneMap, point.xy, dx, dy).rg;
    float gap = clamp(1.0 - cone.g - point.z, 0.0, 1.0);
    float denominator = travel + cone.r;
    float delta = denominator == 0.0 ? 0.0 : gap * cone.r / denominator;
    point += ray * delta;
  }
  vec3 halfStep = ray * point.z * 0.5;
  point = vec3(uv, 0.0) + halfStep;
  for (int i = 0; i < 8; i++) {
    float height = textureGrad(coneMap, point.xy, dx, dy).g;
    halfStep *= 0.5;
    point += point.z < 1.0 - height ? halfStep : -halfStep;
  }
  return point.xy;
}
`;
