import { Data3DTexture, RGBAFormat, LinearFilter, ClampToEdgeWrapping } from 'three';

/** Store resized icons and placeholder layers in a growable 3D texture. */
export function createIconAtlas(loadIcon: (id: number) => Promise<HTMLImageElement | null>) {
	const ICON_SIZE = 256;
	const INITIAL_CAPACITY = 32;
	const BLOCK_SIZE = 32;
	const MAX_CAPACITY = 2048;

	let textureArray: Data3DTexture | null = null;
	const textureIndexMap = new Map<number, number>();
	let nextIndex = 0;
	let textureData: Uint8Array | null = null;
	let currentCapacity = 0;

	/** Keep pending and failed icon layers visible. */
	function getPlaceholderPixelData(): Uint8ClampedArray {
		const canvas = document.createElement('canvas');
		canvas.width = ICON_SIZE;
		canvas.height = ICON_SIZE;

		const ctx = canvas.getContext('2d');

		if (ctx) {
			const gradient = ctx.createLinearGradient(0, 0, ICON_SIZE, ICON_SIZE);
			gradient.addColorStop(0, '#94a3b8'); // slate-400
			gradient.addColorStop(1, '#64748b'); // slate-500
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);

			ctx.strokeStyle = '#475569'; // slate-600
			const lineWidth = Math.max(4, ICON_SIZE / 32);
			ctx.lineWidth = lineWidth;

			const offset = lineWidth / 2;
			ctx.strokeRect(offset, offset, ICON_SIZE - lineWidth, ICON_SIZE - lineWidth);

			ctx.fillStyle = '#ffffff';
			ctx.font = `bold ${ICON_SIZE / 2}px Arial`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText('?', ICON_SIZE / 2, ICON_SIZE / 2);

			return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data;
		}

		// Use a solid placeholder when canvas rendering is unavailable.
		const size = ICON_SIZE * ICON_SIZE * 4;
		const data = new Uint8ClampedArray(size);
		for (let i = 0; i < size; i += 4) {
			data[i] = 148; // R
			data[i + 1] = 163; // G
			data[i + 2] = 184; // B
			data[i + 3] = 255; // A
		}

		return data;
	}

	// Reuse placeholder pixels across capacity changes.
	let cachedPlaceholderData: Uint8ClampedArray | null = null;

	function getCachedPlaceholderData() {
		if (!cachedPlaceholderData) {
			cachedPlaceholderData = getPlaceholderPixelData();
		}

		return cachedPlaceholderData;
	}

	function initTextureArray(capacity: number = INITIAL_CAPACITY): Data3DTexture {
		if (textureArray && currentCapacity >= capacity) return textureArray;

		if (textureArray) {
			textureArray.dispose();
			textureArray = null;
		}

		// Grow in fixed blocks to limit unused texture memory.
		const alignedCapacity = Math.ceil(capacity / BLOCK_SIZE) * BLOCK_SIZE;
		currentCapacity = Math.min(alignedCapacity, MAX_CAPACITY);

		const size = ICON_SIZE * ICON_SIZE * currentCapacity * 4;
		textureData = new Uint8Array(size);

		const placeholderData = getCachedPlaceholderData();
		const layerSize = ICON_SIZE * ICON_SIZE * 4;

		for (let i = 0; i < currentCapacity; i++) {
			textureData.set(placeholderData, i * layerSize);
		}

		textureArray = new Data3DTexture(textureData, ICON_SIZE, ICON_SIZE, currentCapacity);
		textureArray.format = RGBAFormat;
		textureArray.minFilter = LinearFilter;
		textureArray.magFilter = LinearFilter;
		textureArray.wrapS = ClampToEdgeWrapping;
		textureArray.wrapT = ClampToEdgeWrapping;
		textureArray.wrapR = ClampToEdgeWrapping;
		textureArray.needsUpdate = true;

		const memoryMB = (size / (1024 * 1024)).toFixed(2);
		console.log(`[IconManager] Texture ready: ${ICON_SIZE}x${ICON_SIZE}x${currentCapacity}, ${memoryMB} MiB`);

		return textureArray;
	}

	function expandCapacity(newCapacity: number): boolean {
		if (!textureData || !textureArray) {
			console.error('[IconManager] Texture initialization required');
			return false;
		}

		if (newCapacity <= currentCapacity) return true;

		if (newCapacity > MAX_CAPACITY) {
			console.warn(`[IconManager] Capacity ${newCapacity} exceeds ${MAX_CAPACITY}`);
			newCapacity = MAX_CAPACITY;
			if (currentCapacity >= MAX_CAPACITY) return false;
		}

		const alignedCapacity = Math.ceil(newCapacity / BLOCK_SIZE) * BLOCK_SIZE;
		const targetCapacity = Math.min(alignedCapacity, MAX_CAPACITY);

		console.log(`[IconManager] Capacity: ${currentCapacity} -> ${targetCapacity}`);

		const oldData = textureData;
		const oldCapacity = currentCapacity;

		const newSize = ICON_SIZE * ICON_SIZE * targetCapacity * 4;
		textureData = new Uint8Array(newSize);

		const oldSize = ICON_SIZE * ICON_SIZE * oldCapacity * 4;
		textureData.set(oldData.subarray(0, oldSize));

		// Fill newly allocated layers before asynchronous icon loads finish.
		const placeholderData = getCachedPlaceholderData();
		const layerSize = ICON_SIZE * ICON_SIZE * 4;

		for (let i = oldCapacity; i < targetCapacity; i++) {
			textureData.set(placeholderData, i * layerSize);
		}

		textureArray.dispose();

		textureArray = new Data3DTexture(textureData, ICON_SIZE, ICON_SIZE, targetCapacity);
		textureArray.format = RGBAFormat;
		textureArray.minFilter = LinearFilter;
		textureArray.magFilter = LinearFilter;
		textureArray.wrapS = ClampToEdgeWrapping;
		textureArray.wrapT = ClampToEdgeWrapping;
		textureArray.wrapR = ClampToEdgeWrapping;
		textureArray.needsUpdate = true;

		currentCapacity = targetCapacity;

		const memoryMB = (newSize / (1024 * 1024)).toFixed(2);
		console.log(`[IconManager] Texture resized: ${memoryMB} MiB`);

		return true;
	}

	function ensureCapacity(requiredCapacity: number): boolean {
		if (currentCapacity >= requiredCapacity) return true;

		return expandCapacity(requiredCapacity);
	}

	async function addIconToArray(itemId: number): Promise<boolean> {
		if (!textureData || !textureArray) {
			console.error('[IconManager] Texture initialization required');
			return false;
		}

		if (textureIndexMap.has(itemId)) return true;

		if (nextIndex >= currentCapacity) {
			const success = ensureCapacity(nextIndex + 1);
			if (!success) {
				console.warn(`[IconManager] Icon ${itemId} exceeds capacity ${MAX_CAPACITY}`);
				return false;
			}
		}

		const targetIndex = nextIndex;
		// Reserve the slot before loading so concurrent requests keep distinct layers.
		textureIndexMap.set(itemId, targetIndex);
		nextIndex++;

		try {
			const icon = await loadIcon(itemId);

			if (!textureData || !textureArray) return false;

			if (!icon || !icon.complete) {
				console.warn(`[IconManager] Icon ${itemId} keeps its placeholder`);
				return false;
			}

			const canvas = document.createElement('canvas');
			canvas.width = ICON_SIZE;
			canvas.height = ICON_SIZE;

			const ctx = canvas.getContext('2d');

			if (!ctx) {
				console.error('[IconManager] Canvas context required');
				return false;
			}

			ctx.drawImage(icon, 0, 0, ICON_SIZE, ICON_SIZE);

			const imageData = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
			const pixels = imageData.data;

			const layerOffset = targetIndex * ICON_SIZE * ICON_SIZE * 4;

			textureData.set(pixels, layerOffset);

			textureArray.needsUpdate = true;
			return true;
		} catch (error) {
			console.error(`[IconManager] Icon ${itemId} failed`, error);
			return false;
		}
	}

	function getUnloadedIcons(itemIds: number[]): number[] {
		const uniqueIds = Array.from(new Set(itemIds));
		return uniqueIds.filter((id) => !textureIndexMap.has(id));
	}

	async function preloadIcons(itemIds: number[], onProgress?: (current: number, total: number, failed: number) => void): Promise<void> {
		const uniqueIds = Array.from(new Set(itemIds));

		const unloadedIds = uniqueIds.filter((id) => !textureIndexMap.has(id));

		if (unloadedIds.length === 0) {
			// Report completion for an already populated atlas.
			onProgress?.(0, 0, 0);
			return;
		}

		// Reserve all pending layers in one capacity change.
		const requiredCapacity = textureIndexMap.size + unloadedIds.length;
		if (!ensureCapacity(requiredCapacity)) {
			console.warn('[IconManager] Pending icons exceed atlas capacity');
		}

		let completed = 0;
		let failed = 0;

		const promises = unloadedIds.map(async (id) => {
			try {
				const success = await addIconToArray(id);
				if (!success) {
					failed++;
				}

				completed++;
				onProgress?.(completed, unloadedIds.length, failed);
			} catch (error) {
				console.error(`[IconManager] Error loading icon ${id}:`, error);
				failed++;
				completed++;
				onProgress?.(completed, unloadedIds.length, failed);
			}
		});

		await Promise.all(promises);

		const successCount = completed - failed;
		console.log(`[IconManager] Icons ready: ${successCount}/${unloadedIds.length}`);
	}

	/** Unknown icons use the placeholder layer. */
	function getTextureIndex(itemId: number): number {
		return textureIndexMap.get(itemId) ?? 0;
	}

	function getTextureArray(): Data3DTexture | null {
		return textureArray;
	}

	function getCurrentCapacity(): number {
		return currentCapacity;
	}

	function getStats() {
		const memoryMB = currentCapacity > 0 ? (ICON_SIZE * ICON_SIZE * currentCapacity * 4) / (1024 * 1024) : 0;
		return {
			currentCapacity,
			maxCapacity: MAX_CAPACITY,
			usedTextures: nextIndex,
			loadedIcons: textureIndexMap.size,
			iconSize: ICON_SIZE,
			memoryMB: memoryMB.toFixed(2),
		};
	}

	function dispose() {
		if (textureArray) {
			textureArray.dispose();
			// Release the CPU buffer retained by the texture image.
			if (textureArray.image) {
				textureArray.image.data = null;
			}

			textureArray = null;
		}

		textureData = null;
		textureIndexMap.clear();
		cachedPlaceholderData = null;
		nextIndex = 0;
		console.log('[IconManager] Atlas disposed');
	}

	return {
		initTextureArray,
		addIconToArray,
		getUnloadedIcons,
		preloadIcons,
		getTextureIndex,
		getTextureArray,
		getCurrentCapacity,
		getStats,
		dispose,
	};
}
