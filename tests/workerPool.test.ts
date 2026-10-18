import { describe, expect, it, vi } from 'vitest';
import { WorkerPool } from '../src/resources/workerPool.js';

class FakeWorker {
	onmessage?: (event: { data: unknown }) => void;
	onerror?: (event: { message: string }) => void;
	onmessageerror?: () => void;
	postMessage = vi.fn();
	terminate = vi.fn();
	complete(output: number) { this.onmessage?.({ data: { output } }); }
}

function fixture(size = 2) {
	const workers: FakeWorker[] = [];
	const pool = new WorkerPool<number, number>(() => {
		const worker = new FakeWorker();
		workers.push(worker);
		return worker as unknown as Worker;
	}, size);
	const submit = (input: number, signal?: AbortSignal) => pool.run(() => ({ input, transfer: [] }), signal);
	return { workers, pool, submit };
}

describe('CPU worker ownership', () => {
	it('reuses a bounded pool and creates queued payloads only when a slot opens', async () => {
		const { workers, pool, submit } = fixture();
		const a = submit(1), b = submit(2);
		const create = vi.fn(() => ({ input: 3, transfer: [] }));
		const c = pool.run(create);
		expect(workers).toHaveLength(2);
		expect(create).not.toHaveBeenCalled();
		workers[1]!.complete(20);
		expect(create).toHaveBeenCalledOnce();
		expect(workers[1]!.postMessage).toHaveBeenLastCalledWith(3, []);
		workers[0]!.complete(10);
		workers[1]!.complete(30);
		expect(await Promise.all([a, b, c])).toEqual([10, 20, 30]);
		pool.dispose();
		workers.forEach(worker => expect(worker.terminate).toHaveBeenCalledOnce());
	});

	it('cancels queued work without transferring buffers and drains cancelled running work before reuse', async () => {
		const { workers, pool, submit } = fixture(1);
		const active = new AbortController(), queued = new AbortController();
		const a = submit(1, active.signal);
		const create = vi.fn(() => ({ input: 2, transfer: [] }));
		const b = pool.run(create, queued.signal);
		const rejectedA = expect(a).rejects.toThrow('cancel active');
		const rejectedB = expect(b).rejects.toThrow('cancel queued');
		queued.abort(new Error('cancel queued'));
		active.abort(new Error('cancel active'));
		await Promise.all([rejectedA, rejectedB]);
		expect(create).not.toHaveBeenCalled();
		const c = submit(3);
		expect(workers[0]!.postMessage).toHaveBeenCalledTimes(1);
		workers[0]!.complete(10);
		expect(workers[0]!.postMessage).toHaveBeenLastCalledWith(3, []);
		workers[0]!.complete(30);
		expect(await c).toBe(30);
		pool.dispose();
	});

	it('replaces a crashed worker, then rejects active and queued work on disposal', async () => {
		const { workers, pool, submit } = fixture(1);
		const a = submit(1), b = submit(2), c = submit(3);
		const failed = expect(a).rejects.toThrow('decoder crashed');
		workers[0]!.onerror!({ message: 'decoder crashed' });
		await failed;
		expect(workers[0]!.terminate).toHaveBeenCalledOnce();
		expect(workers).toHaveLength(2);
		expect(workers[1]!.postMessage).toHaveBeenCalledWith(2, []);
		const disposed = [expect(b).rejects.toThrow('disposed'), expect(c).rejects.toThrow('disposed')];
		pool.dispose();
		await Promise.all(disposed);
		await expect(submit(4)).rejects.toThrow('disposed');
	});

	it('recovers after a payload cannot be posted', async () => {
		const { workers, pool, submit } = fixture(1);
		const a = submit(1);
		workers[0]!.postMessage.mockImplementationOnce(() => { throw new Error('clone failed'); });
		const b = submit(2), c = submit(3);
		const failed = expect(b).rejects.toThrow('clone failed');
		workers[0]!.complete(10);
		await failed;
		expect(workers[0]!.postMessage).toHaveBeenLastCalledWith(3, []);
		workers[0]!.complete(30);
		expect(await Promise.all([a, c])).toEqual([10, 30]);
		pool.dispose();
	});
});
