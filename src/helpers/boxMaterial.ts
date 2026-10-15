import { ShaderMaterial } from 'three';

/** Keep box borders at a fixed world-space width. */
export function createBoxMaterial(opacity: number): ShaderMaterial {
	return new ShaderMaterial({
		uniforms: {
			uOpacity: { value: opacity },
			uBorderWidth: { value: 0.6 },
		},
		vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vScale;
      varying vec3 vLocalNormal;

      void main() {
        vUv = uv;
        vLocalNormal = normal;
        
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif

        // Recover each instance axis scale.
        vec3 col0 = vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]);
        vec3 col1 = vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]);
        vec3 col2 = vec3(instanceMatrix[2][0], instanceMatrix[2][1], instanceMatrix[2][2]);
        
        vScale = vec3(length(col0), length(col1), length(col2));

        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
		fragmentShader: `
      precision highp float;

      #include <logdepthbuf_pars_fragment>
      
      uniform float uOpacity;
      uniform float uBorderWidth;
      
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vScale;
      varying vec3 vLocalNormal;

      void main() {
        // Select the physical face dimensions from its local normal.
        
        vec3 absNormal = abs(vLocalNormal);
        vec2 faceScale = vec2(1.0);
        
        if (absNormal.z > 0.5) {
          faceScale = vec2(vScale.x, vScale.y);
        } else if (absNormal.y > 0.5) {
          faceScale = vec2(vScale.x, vScale.z);
        } else {
          faceScale = vec2(vScale.z, vScale.y);
          faceScale = vec2(vScale.y, vScale.z);
        }
        
        // Convert the world-space border width into UV space.
        vec2 baseUvBorder = uBorderWidth / max(faceScale, vec2(0.001));
        
        // Smooth the border over the pixel footprint.
        vec2 f = fwidth(vUv);
        vec2 smoothing = f * 1.5;
        
        vec2 borderMin = smoothstep(baseUvBorder + smoothing, baseUvBorder, vUv);
        vec2 borderMax = smoothstep(1.0 - baseUvBorder - smoothing, 1.0 - baseUvBorder, vUv);
        
        float isBorder = max(max(borderMin.x, borderMax.x), max(borderMin.y, borderMax.y));
        isBorder = clamp(isBorder, 0.0, 1.0);

        vec3 borderColor = vColor * 0.9;
        
        vec3 finalColor = mix(vColor, borderColor, isBorder);
        
        gl_FragColor = vec4(finalColor, uOpacity);

        #include <logdepthbuf_fragment>
      }
    `,
		transparent: true,
		depthWrite: true,
		depthTest: true,
	});
}
