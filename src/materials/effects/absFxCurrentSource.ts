export function absFxCurrentClock(selector: number, gameTime: number, unpausedTime: number): number {
	return Math.abs(selector) > 0.00001 && selector >= 0 ? unpausedTime : gameTime;
}

export function absFxCurrentCoverageBinding(collectionAlpha: number, suppression?: number): { bound: boolean; suppression?: number } {
	if (!Number.isFinite(collectionAlpha)) throw new Error('[ABSFX] actual collection alpha required');

	if (suppression === undefined) {
		if (collectionAlpha !== 0) throw new Error(
			'[ABSFX] loose pixel opacity suppression binding unresolved outside exact zero-coverage domain',
		);

		return { bound: false };
	}

	if (!Number.isFinite(suppression)) throw new Error('[ABSFX] explicit finite opacity suppression required');

	return { bound: true, suppression };
}

export function absFxCurrentCoverage(alpha: number, collectionAlpha: number, suppression?: number): number {
	const binding = absFxCurrentCoverageBinding(collectionAlpha, suppression);
	return binding.bound
		? alpha * collectionAlpha * Math.max(0, Math.min(1, 1 - binding.suppression!))
		: 0;
}

export const absFxCurrentMath = /* glsl */ `
float absFxPower(float x,float p){return x<=0.0?0.0:exp2(log2(x)*p);}
vec3 absFxPower(vec3 x,float p){return vec3(absFxPower(x.x,p),absFxPower(x.y,p),absFxPower(x.z,p));}
float absFxClock(float selector){return abs(selector)>.00001&&selector>=0.0?fxUnpausedTime:fxGameTime;}
vec2 absFxUV(vec2 uv,vec2 scale,vec2 offset,float clampWeight){vec2 p=uv*scale+offset;return mix(p,clamp(p,0.0,1.0),clampWeight);}
float absFxSmooth(float x){return x*x*(3.0-2.0*x);}
vec3 absFxDesaturate(vec3 c,float weight){return mix(c,vec3(dot(c,vec3(.3,.59,.11))),weight);}
vec4 absFxHash(vec2 uv,float density){
  vec4 cell=floor(vec4(uv,uv)*vec4(density,density,density*fxMaterial[0].w,density*fxMaterial[0].w))*.001;
  vec2 product=cell.xz*cell.yw,sum=cell.xz+cell.yw;
  return fract(fract(vec4(product*sum,.4*product+.6*sum)*8.31*314.216705+5.381)*63.780998);
}
vec3 absFxGlint(vec2 uv,float density,float phase,float threshold){
  vec4 h=absFxHash(uv,density);
  h*=vec4(lessThanEqual(fract(phase+h.zxwy),vec4(threshold-.0001)));
  return dot(h.yw,h.yw)*fxMaterial[2].rgb+dot(h.xz,h.xz)*fxMaterial[3].rgb;
}
float absFxTODCurve(vec4 curve,float tod){
  float x=tod*4.0;
  float value=mix(curve.y,curve.x,clamp(x,0.0,1.0));
  value=mix(value,curve.z,clamp(x-1.0,0.0,1.0));
  value=mix(value,curve.w,clamp(x-2.0,0.0,1.0));
  return mix(value,curve.y,clamp(x-3.0,0.0,1.0));
}
`;
