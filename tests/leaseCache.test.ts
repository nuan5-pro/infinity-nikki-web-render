import { expect, it } from 'vitest';
import { AssetLeaseCache } from '../src/resources/leaseCache.js';

it('retains ready values but aborts pending work when its final consumer releases', async () => {
	const cache = new AssetLeaseCache<number>(() => {}, true);
	let signal: AbortSignal | undefined;
	const first = cache.acquire('pending', (value) => {
		signal = value;
		return new Promise((_resolve, reject) => value.addEventListener('abort', () => reject(new Error('aborted'))));
	});
	const second = cache.acquire('pending', async () => 2);
	const settled = Promise.allSettled([first.ready, second.ready]);
	await Promise.resolve();
	first.release();
	expect(signal?.aborted).toBe(false);
	second.release();
	expect(signal?.aborted).toBe(true);
	expect((await settled).every((result) => result.status === 'rejected')).toBe(true);

	const ready = cache.acquire('ready', async () => 3);
	expect(await ready.ready).toBe(3);
	ready.release();

	const reused = cache.acquire('ready', async () => 4);
	expect(await reused.ready).toBe(3);
	reused.release();
	cache.clear();
});
