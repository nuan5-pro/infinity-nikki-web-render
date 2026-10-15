import {
	WebGLRenderTarget,
	Scene,
	OrthographicCamera,
	PlaneGeometry,
	ShaderMaterial,
	Mesh,
	Color,
	LinearFilter,
	InstancedMesh,
	DoubleSide,
	DynamicDrawUsage,
	Sphere,
	Vector3,
	CustomBlending,
	MaxEquation,
	OneFactor,
	Matrix4,
	type WebGLRenderer,
	type Camera,
} from 'three';
import { nextInstancedPoolCapacity } from './instanceCapacity.js';

const MODEL_FALLBACK_MESH_KEY = '-1';

const SELECTED_COLOR = new Color(0x60a5fa);
const HOVER_COLOR = new Color(0xf59e0b);

/** Render constant-pixel outlines from an offscreen selection mask. */
export function createSelectionOutline() {
	const scratchColor = new Color();
	// Size the offscreen target to the drawing buffer during rendering.
	const maskRT = new WebGLRenderTarget(1, 1, {
		minFilter: LinearFilter,
		magFilter: LinearFilter,
	});

	const maskScene = new Scene();

	const maskMeshMap = new Map<string, InstancedMesh>();
	// Source instance indices in packed mask-slot order (1=selected, 2=hover).
	let maskStateByKey = new Map<string, Map<number, number>>();
	const maskMatrix = new Matrix4();

	// Encode selection in R and hover in G. Depth stays independent of scene occlusion.
	const maskMaterial = new ShaderMaterial({
		vertexShader: `
        varying vec3 vInstanceColor;
        void main() {
          // Instance colors carry the mask state when available.
          #ifdef USE_INSTANCING_COLOR
            vInstanceColor = instanceColor;
          #else
            vInstanceColor = vec3(0.0);
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
		fragmentShader: `
        varying vec3 vInstanceColor;
        void main() {
          // Keep highlighted fragments.
          if (vInstanceColor.r < 0.001 && vInstanceColor.g < 0.001) {
            discard;
          }
          gl_FragColor = vec4(vInstanceColor, 1.0);
        }
      `,
		side: DoubleSide,
		depthTest: false,
		depthWrite: false,
		// Preserve both mask channels where highlighted instances overlap.
		blending: CustomBlending,
		blendEquation: MaxEquation,
		blendSrc: OneFactor,
		blendDst: OneFactor,
	});

	const overlayScene = new Scene();
	const overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

	// Cache mask visibility across frames.
	let hasMaskContent = false;

	const outlineShader = new ShaderMaterial({
		uniforms: {
			uMask: { value: maskRT.texture },
			uResolution: { value: [1, 1] },
			uSelectedColor: { value: SELECTED_COLOR },
			uHoverColor: { value: HOVER_COLOR },
			uOutlineWidth: { value: 5.0 },
			uCoreWidth: { value: 2.5 },
		},
		vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
		fragmentShader: `
      precision highp float;
      
      uniform sampler2D uMask;
      uniform vec2 uResolution;
      uniform vec3 uSelectedColor;
      uniform vec3 uHoverColor;
      uniform float uOutlineWidth;
      uniform float uCoreWidth;
      
      varying vec2 vUv;
      
      void main() {
        vec2 texel = 1.0 / uResolution;
        
        // Read the selected and hovered center state.
        vec2 centerMask = texture2D(uMask, vUv).rg;
        bool isInSelected = centerMask.r > 0.5;
        bool isInHovered = centerMask.g > 0.5;
        
        // Hover uses an exterior outline.
        if (isInHovered) {
          discard;
        }
        
        float selectedDist = 1000.0;
        float hoverDist = 1000.0;
        bool hasSelected = false;
        bool hasHover = false;
        
        int maxW = int(ceil(uOutlineWidth));
        
        for (int x = -maxW; x <= maxW; x++) {
          for (int y = -maxW; y <= maxW; y++) {
            if (x == 0 && y == 0) continue;
            
            vec2 offset = vec2(float(x), float(y)) * texel;
            vec2 val = texture2D(uMask, vUv + offset).rg;
            float dist = length(vec2(float(x), float(y)));
            
            // Hover edges remain visible inside selected objects.
            if (val.g > 0.5 && dist <= uOutlineWidth && dist < hoverDist) {
              hoverDist = dist;
              hasHover = true;
            }
            
            // Selection uses an exterior outline.
            if (!isInSelected) {
              if (val.r > 0.5 && dist <= uOutlineWidth && dist < selectedDist) {
                selectedDist = dist;
                hasSelected = true;
              }
            }
          }
        }
        
        // Keep interior pixels only for overlapping hover edges.
        if (isInSelected && !hasHover) {
          discard;
        }
        
        if (!hasSelected && !hasHover) {
          discard;
        }
        
        vec3 finalColor = vec3(0.0);
        float finalAlpha = 0.0;
        
        // Selection forms the base outline.
        if (hasSelected) {
          float selectedAlpha;
          if (selectedDist <= uCoreWidth) {
            selectedAlpha = 1.0;
          } else {
            float range = uOutlineWidth - uCoreWidth;
            float d = selectedDist - uCoreWidth;
            selectedAlpha = pow(clamp(1.0 - d / range, 0.0, 1.0), 2.0);
          }
          finalColor = uSelectedColor;
          finalAlpha = selectedAlpha;
        }
        
        // Hover takes color priority over selection.
        if (hasHover) {
          float hoverAlpha;
          if (hoverDist <= uCoreWidth) {
            hoverAlpha = 1.0;
          } else {
            float range = uOutlineWidth - uCoreWidth;
            float d = hoverDist - uCoreWidth;
            hoverAlpha = pow(clamp(1.0 - d / range, 0.0, 1.0), 2.0);
          }
          finalColor = uHoverColor;
          finalAlpha = max(finalAlpha, hoverAlpha);
        }
        
        gl_FragColor = vec4(finalColor, finalAlpha);
      }
    `,
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});

	const overlayQuad = new Mesh(new PlaneGeometry(2, 2), outlineShader);
	overlayScene.add(overlayQuad);

	/** Reuse masks while source geometry and capacity remain compatible. */
	function initMaskMesh(meshKey: string, originalMesh: InstancedMesh, requiredCount: number = 1): InstancedMesh {
		const existingMask = maskMeshMap.get(meshKey);

		if (existingMask) {
			const geometryMatch = existingMask.geometry === originalMesh.geometry;
			const capacityMatch = existingMask.instanceMatrix.count >= requiredCount;

			if (geometryMatch && capacityMatch) return existingMask;

			disposeMaskMesh(meshKey);
		}

		const capacity = nextInstancedPoolCapacity(requiredCount, existingMask?.instanceMatrix.count ?? 0);
		const maskMesh = new InstancedMesh(originalMesh.geometry, maskMaterial, capacity);

		maskMesh.frustumCulled = false;
		maskMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity);
		maskMesh.instanceMatrix.setUsage(DynamicDrawUsage);
		maskMesh.setColorAt(0, scratchColor.setRGB(0, 0, 0));
		maskMesh.instanceColor!.setUsage(DynamicDrawUsage);
		maskMesh.count = 0;
		maskMesh.visible = false;

		const raw = maskMesh;
		maskMeshMap.set(meshKey, raw);
		maskScene.add(raw);

		return raw;
	}

	/** Retire stale masks and rebuild changed geometry on demand. */
	function reconcileMaskMeshes(meshMap: Map<string, InstancedMesh>, fallbackMesh: InstancedMesh | null) {
		const activeKeys = new Set<string>(meshMap.keys());
		if (fallbackMesh) {
			activeKeys.add(MODEL_FALLBACK_MESH_KEY);
		}

		for (const meshKey of Array.from(maskMeshMap.keys())) {
			if (!activeKeys.has(meshKey)) {
				disposeMaskMesh(meshKey);
			}
		}

		// Allocate masks for highlighted groups.
		for (const [meshKey, maskMesh] of maskMeshMap) {
			const source = meshKey === MODEL_FALLBACK_MESH_KEY ? fallbackMesh : meshMap.get(meshKey);
			if (source && maskMesh.geometry !== source.geometry) {
				disposeMaskMesh(meshKey);
			}
		}
	}

	function updateMatrices(meshMap: Map<string, InstancedMesh>, fallbackMesh: InstancedMesh | null) {
		for (const [meshKey, state] of maskStateByKey) {
			const source = meshKey === MODEL_FALLBACK_MESH_KEY ? fallbackMesh : meshMap.get(meshKey);
			const maskMesh = maskMeshMap.get(meshKey);
			if (!source || !maskMesh || !maskMesh.visible) continue;

			let slot = 0;
			for (const localIndex of state.keys()) {
				source.getMatrixAt(localIndex, maskMatrix);
				maskMesh.setMatrixAt(slot++, maskMatrix);
			}

			maskMesh.instanceMatrix.needsUpdate = true;
		}
	}

	/** Combine selection and hover bits for each highlighted instance. */
	function updateMasks(
		selectedIds: Set<string>,
		hoveredIds: Set<string> | null,
		meshMap: Map<string, InstancedMesh>,
		internalIdToMeshInfo: Map<string, { meshKey: string; localIndex: number }>,
		fallbackMesh: InstancedMesh | null,
	) {
		const nextStateByKey = new Map<string, Map<number, number>>();

		const setNextMaskState = (id: string, bit: number) => {
			const info = internalIdToMeshInfo.get(id);
			if (!info) return;

			const { meshKey, localIndex } = info;
			const source = meshKey === MODEL_FALLBACK_MESH_KEY ? fallbackMesh : meshMap.get(meshKey);
			if (!source || localIndex < 0 || localIndex >= source.count) return;

			let stateMap = nextStateByKey.get(meshKey);
			if (!stateMap) {
				stateMap = new Map<number, number>();
				nextStateByKey.set(meshKey, stateMap);
			}

			const prev = stateMap.get(localIndex) ?? 0;
			stateMap.set(localIndex, prev | bit);
		};

		for (const id of selectedIds) {
			setNextMaskState(id, 1);
		}

		if (hoveredIds && hoveredIds.size > 0) {
			for (const hoveredId of hoveredIds) {
				setNextMaskState(hoveredId, 2);
			}
		}

		const setMaskColorFromBits = (maskMesh: InstancedMesh, localIndex: number, bits: number) => {
			if (bits === 0) {
				scratchColor.setRGB(0.0, 0.0, 0.0);
			} else if (bits === 1) {
				scratchColor.setRGB(1.0, 0.0, 0.0);
			} else if (bits === 2) {
				scratchColor.setRGB(0.0, 1.0, 0.0);
			} else {
				scratchColor.setRGB(1.0, 1.0, 0.0);
			}

			maskMesh.setColorAt(localIndex, scratchColor);
		};

		for (const [meshKey, maskMesh] of maskMeshMap) {
			if (nextStateByKey.has(meshKey)) continue;
			maskMesh.count = 0;
			maskMesh.visible = false;
		}

		// Pack highlighted instances to limit vertex work and draw submission.
		for (const [meshKey, state] of nextStateByKey) {
			const source = meshKey === MODEL_FALLBACK_MESH_KEY ? fallbackMesh! : meshMap.get(meshKey)!;
			const maskMesh = initMaskMesh(meshKey, source, state.size);
			maskMesh.count = state.size;
			maskMesh.visible = true;

			let slot = 0;
			for (const bits of state.values()) {
				setMaskColorFromBits(maskMesh, slot++, bits);
			}

			maskMesh.instanceColor!.needsUpdate = true;
		}

		maskStateByKey = nextStateByKey;
		updateMatrices(meshMap, fallbackMesh);
		hasMaskContent = nextStateByKey.size > 0;
	}

	/** Render the mask before the main scene. Canvas dimensions use CSS pixels. */
	function renderMaskPass(renderer: WebGLRenderer, camera: Camera, canvasWidth: number, canvasHeight: number) {
		if (!hasMaskContent) return false;

		// Match the drawing buffer's pixel ratio.
		const pixelRatio = renderer.getPixelRatio();
		const width = Math.floor(canvasWidth * pixelRatio);
		const height = Math.floor(canvasHeight * pixelRatio);

		if (maskRT.width !== width || maskRT.height !== height) {
			maskRT.setSize(width, height);
			if (outlineShader.uniforms.uResolution) {
				outlineShader.uniforms.uResolution.value = [width, height];
			}
		}

		const oldRT = renderer.getRenderTarget();
		const oldClearColor = renderer.getClearColor(new Color());
		const oldClearAlpha = renderer.getClearAlpha();

		renderer.setRenderTarget(maskRT);
		renderer.setClearColor(0x000000, 0);
		renderer.clear();
		renderer.render(maskScene, camera);

		renderer.setRenderTarget(oldRT);
		renderer.setClearColor(oldClearColor, oldClearAlpha);

		return true;
	}

	/** Composite outlines onto the current target after the main scene. */
	function renderOverlay(renderer: WebGLRenderer) {
		const oldAutoClear = renderer.autoClear;
		renderer.autoClear = false;
		renderer.render(overlayScene, overlayCamera);
		renderer.autoClear = oldAutoClear;
	}

	/** Match the source scene's Y reflection. */
	function syncSceneTransform(scaleY: number) {
		maskScene.scale.set(1, scaleY, 1);
		maskScene.updateMatrixWorld(true);
	}

	function disposeMaskMesh(meshKey: string) {
		const mesh = maskMeshMap.get(meshKey);
		if (mesh) {
			maskScene.remove(mesh);
			mesh.dispose();
			mesh.geometry = null as any;
			mesh.material = null as any;
			maskMeshMap.delete(meshKey);
			maskStateByKey.delete(meshKey);
		}
	}

	function dispose() {
		for (const [meshKey] of maskMeshMap.entries()) {
			disposeMaskMesh(meshKey);
		}

		maskMeshMap.clear();
		maskStateByKey.clear();

		maskRT.dispose();
		maskMaterial.dispose();
		outlineShader.dispose();
		overlayQuad.geometry.dispose();
	}

	return {
		initMaskMesh,
		reconcileMaskMeshes,
		updateMasks,
		updateMatrices,
		renderMaskPass,
		renderOverlay,
		syncSceneTransform,
		disposeMaskMesh,
		dispose,
		maskScene,
		overlayScene,
	};
}
