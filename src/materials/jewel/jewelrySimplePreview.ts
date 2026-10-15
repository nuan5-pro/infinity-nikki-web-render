// Explicit lightweight editor preview. This is not the native Masked consumer.
export const jewelrySimpleRoles = new Set(['D', 'T', 'N', 'O', 'O1']);

export const jewelrySimpleColorCore = /* glsl */ `
mat3 frame = jewelFrame(normalize(vJewelNormal));
vec3 normal = jewelFacingNormal(jewelNormal(texture2D(jewelN,vJewelUV0*jJewel_N_Tiling).rg,jJewel_N_Flatness,frame));
vec2 secondUV = mix(vJewelUV0,vJewelUV1,jJewel_2UColor_UV);
secondUV = mix(secondUV,vJewelUV2,clamp(jJewel_2UColor_UV-1.0,0.0,1.0));
secondUV = mix(secondUV,vJewelUV3,clamp(jJewel_2UColor_UV-2.0,0.0,1.0));
vec4 secondSample = texture2D(jewelT,secondUV);
vec4 bodySample = texture2D(jewelD,jewelUV(jJewel_D_UV)*vec2(jJewel_D_Tiling,jJewel_D_Tiling*jJewel_D_Tiling_Y));
vec3 body = bodySample.rgb*clamp(secondSample.rgb+vec3(jIsApplyingDIYColor),0.0,1.0);
float roughness = clamp(texture2D(jewelO1,vJewelUV0).g*jJewel_SRM_Adjust.g,0.0,1.0);
vec3 matcap = texture2D(jewelO,vec2(normal.x,-normal.y)*0.5+0.5).rgb;
matcap *= body*jJewel_MatcapColor.rgb*(1.0-roughness*jJewel_RoughnessOnSpec);
vec3 colour = body*jJewel_D_Tint.rgb+matcap;
vec3 diy = (secondSample.rgb*jDIY_UserColor.rgb+vec3(jDIY_BaseColorBias))*jDIY_BaseColorScale;
colour = mix(colour,diy*mix(colour,vec3(dot(colour,vec3(0.3,0.59,0.11))),0.9),jIsApplyingDIYColor);
vec3 jewelColor = max(colour,vec3(0));
`;
