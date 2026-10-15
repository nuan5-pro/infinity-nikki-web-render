import { Color, DoubleSide, GLSL3, ShaderMaterial, type Data3DTexture } from 'three';

export function createIconMaterial(texture: Data3DTexture, depth: number): ShaderMaterial {
	return new ShaderMaterial({
		uniforms: {
			textureArray: { value: texture },
			textureDepth: { value: depth },
			uDefaultColor: { value: new Color(0x94a3b8) },
		},
		vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      in float textureIndex;
      out vec2 vUv;
      out float vTextureIndex;
      out vec3 vInstanceColor;
      void main() {
        vUv = uv;
        vTextureIndex = textureIndex;
        #ifdef USE_INSTANCING_COLOR
          vInstanceColor = instanceColor;
        #else
          vInstanceColor = vec3(1.0);
        #endif
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
		fragmentShader: `
      precision highp sampler3D;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler3D textureArray;
      uniform float textureDepth;
      uniform vec3 uDefaultColor;
      in vec2 vUv;
      in float vTextureIndex;
      in vec3 vInstanceColor;
      out vec4 fragColor;
      void main() {
        float z = (vTextureIndex + 0.5) / textureDepth;
        vec4 texColor = texture(textureArray, vec3(vUv.x, 1.0 - vUv.y, z));
        float borderW = 0.03;
        bool isBorder = vUv.x < borderW || vUv.x > (1.0 - borderW) ||
                        vUv.y < borderW || vUv.y > (1.0 - borderW);
        bool isDefaultColor = distance(vInstanceColor, uDefaultColor) < 0.05;
        fragColor = isBorder && !isDefaultColor ? vec4(vInstanceColor, 1.0) : texColor;
        if (fragColor.a < 0.5) discard;
        #include <logdepthbuf_fragment>
      }
    `,
		transparent: false,
		depthWrite: true,
		depthTest: true,
		glslVersion: GLSL3,
		side: DoubleSide,
	});
}
