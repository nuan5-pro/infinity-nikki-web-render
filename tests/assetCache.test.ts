import { expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ load: vi.fn(), decoderPath: vi.fn(), decoders: [] as Array<{ dispose: ReturnType<typeof vi.fn> }> }));
vi.mock('three/addons/loaders/DRACOLoader.js', () => ({ DRACOLoader: class {
	dispose = vi.fn();

	constructor() { hooks.decoders.push(this); }

	setDecoderPath(path: string) {
		hooks.decoderPath(path);
		return this;
	}
} }));
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: class {
	setDRACOLoader() { return this; }
} }));
vi.mock('../src/furniture/assets.js', () => ({
	loadGLBAsset: (...args: unknown[]) => hooks.load(...args),

	createModelAssetData: (asset: unknown) => asset,
}));
import { FurnitureAssetCache } from '../src/furniture/assetStore.js';

it('shares immutable model parses across tier owners and only evicts unused assets', async () => {
	hooks.load.mockReset();

	const asset = { meshEntries: [], dispose: vi.fn() };
	hooks.load.mockResolvedValue(asset);

	const cache = new FurnitureAssetCache();
	const acquire = () => cache.models.acquire('model-sha', signal => cache.load('/assets/', '/momo/draco/', { path: 'model.glb', bytes: 1 }, signal));
	const full = acquire();
	const liteMaterial = acquire();
	expect(await full.ready).toBe(await liteMaterial.ready);
	expect(hooks.decoderPath).toHaveBeenLastCalledWith('/momo/draco/');
	full.release();
	cache.clearUnused();
	expect(asset.dispose).not.toHaveBeenCalled();
	liteMaterial.release();

	const warm = acquire();
	expect(await warm.ready).toBe(asset);
	expect(hooks.load).toHaveBeenCalledTimes(1);
	warm.release();
	cache.clearUnused();
	expect(asset.dispose).toHaveBeenCalledTimes(1);
	cache.dispose();
});

it('retires late parse results without terminating their worker before they settle', async () => {
	hooks.load.mockReset();

	let finish!: (asset: unknown) => void;
	hooks.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));

	const cache = new FurnitureAssetCache();
	const lease = cache.models.acquire('model-sha', signal => cache.load('/assets/', 'draco/', { path: 'model.glb', bytes: 1 }, signal));
	const rejected = expect(lease.ready).rejects.toThrow('expired');
	await vi.waitFor(() => expect(finish).toBeTypeOf('function'));

	const decoder = hooks.decoders.at(-1)!;
	cache.dispose();
	expect(decoder.dispose).not.toHaveBeenCalled();

	const asset = { meshEntries: [], dispose: vi.fn() };
	finish(asset);
	await rejected;
	expect(asset.dispose).toHaveBeenCalledTimes(1);
	expect(decoder.dispose).toHaveBeenCalledTimes(1);
});
