import { describe, expect, it, vi } from 'vitest';
import { AssetLeaseCache } from '../../src/resources/leaseCache.js';

describe('split asset ownership', () => {
	it('shares packs and disposes only after the last consumer releases', async () => {
		const dispose = vi.fn();
		const load = vi.fn(async () => ({ parser: 'pack' }));
		const cache = new AssetLeaseCache(dispose);
		const first = cache.acquire('pack-full:hash', load);
		const second = cache.acquire('pack-full:hash', load);
		expect(await first.ready).toBe(await second.ready);
		expect(load).toHaveBeenCalledTimes(1);
		first.release();
		first.release();
		expect(dispose).not.toHaveBeenCalled();
		second.release();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it('keeps immutable model parsing warm across material manager switches', async () => {
		const dispose = vi.fn();
		const load = vi.fn(async () => ({ geometry: 'model' }));
		const cache = new AssetLeaseCache(dispose, true);
		const fullMaterials = cache.acquire('model-full:hash', load);
		const model = await fullMaterials.ready;
		fullMaterials.release();

		const liteMaterials = cache.acquire('model-full:hash', load);
		expect(await liteMaterials.ready).toBe(model);
		expect(load).toHaveBeenCalledTimes(1);
		liteMaterials.release();
		expect(dispose).not.toHaveBeenCalled();
		cache.clear();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it('does not resurrect a retired pack when its parse completes late', async () => {
		let resolve!: (value: object) => void;
		const dispose = vi.fn();
		const cache = new AssetLeaseCache(dispose);
		const lease = cache.acquire(
			'pack:late',
			() =>
				new Promise<object>((done) => {
					resolve = done;
				}),
		);
		const rejected = expect(lease.ready).rejects.toThrow('expired');
		await Promise.resolve();
		lease.release();
		resolve({ parser: 'late' });
		await rejected;
		expect(dispose).toHaveBeenCalledTimes(1);

		const replacement = cache.acquire('pack:late', async () => ({ parser: 'new' }));
		expect(await replacement.ready).toEqual({ parser: 'new' });
		replacement.release();
	});

	it('rejects released callers even when another consumer keeps the pack alive', async () => {
		const cache = new AssetLeaseCache<object>(vi.fn());
		const first = cache.acquire('shared', async () => ({}));
		const second = cache.acquire('shared', async () => ({}));
		const rejected = expect(first.ready).rejects.toThrow('no longer active');
		first.release();
		await second.ready;
		await rejected;
		second.release();
	});

	it('does not cache failures and separates content revisions', async () => {
		const dispose = vi.fn();
		const cache = new AssetLeaseCache<object>(dispose);
		const failed = cache.acquire('model:old', async () => {
			throw new Error('missing');
		});
		await expect(failed.ready).rejects.toThrow('missing');
		failed.release();

		const retry = cache.acquire('model:old', async () => ({ revision: 'old' }));
		const next = cache.acquire('model:new', async () => ({ revision: 'new' }));
		expect(await retry.ready).not.toBe(await next.ready);
		cache.clear();
		expect(dispose).toHaveBeenCalledTimes(2);
		retry.release();
		next.release();
	});

	it('aborts in-flight pack I/O on its final release and prevents canceled queued loading', async () => {
		let signal!: AbortSignal;
		const cache = new AssetLeaseCache<object>(vi.fn());
		const lease = cache.acquire('in-flight', (input) => {
			signal = input;
			return new Promise((_resolve, reject) => input.addEventListener('abort', () => reject(new Error('aborted'))));
		});
		const rejected = expect(lease.ready).rejects.toThrow('aborted');
		await Promise.resolve();
		lease.release();
		expect(signal.aborted).toBe(true);
		await rejected;

		const load = vi.fn(async () => ({}));
		const queued = cache.acquire('queued', load);
		const canceled = expect(queued.ready).rejects.toThrow('expired before loading');
		queued.release();
		await canceled;
		expect(load).not.toHaveBeenCalled();
	});
});
