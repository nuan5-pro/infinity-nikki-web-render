interface Task<Input, Output> {
	create(): { input: Input; transfer: Transferable[] };
	resolve(value: Output): void;
	reject(reason: unknown): void;
	signal?: AbortSignal;
	abort(): void;
}

interface Slot<Input, Output> {
	worker: Worker;
	task?: Task<Input, Output>;
}

/** Each worker owns one job; payloads are allocated only when a slot is available. */
export class WorkerPool<Input, Output> {
	private slots: Slot<Input, Output>[] = [];
	private waiting: Task<Input, Output>[] = [];
	private disposed = false;
	private createWorker: () => Worker;
	private size: number;

	constructor(createWorker: () => Worker, size = 2) {
		this.createWorker = createWorker;
		this.size = size;
	}

	run(create: Task<Input, Output>['create'], signal?: AbortSignal): Promise<Output> {
		if (this.disposed) return Promise.reject(new Error('Worker pool disposed'));
		if (signal?.aborted) return Promise.reject(signal.reason);

		return new Promise((resolve, reject) => {
			const task: Task<Input, Output> = {
				create, resolve, reject, signal,
				abort: () => {
					const index = this.waiting.indexOf(task);
					if (index >= 0) this.waiting.splice(index, 1);
					// A running job keeps its slot until it replies; its transferred buffers
					// are no longer available to the caller, even after cancellation.
					reject(signal!.reason);
				},
			};
			signal?.addEventListener('abort', task.abort, { once: true });
			this.waiting.push(task);
			this.dispatch();
		});
	}

	private createSlot(): Slot<Input, Output> {
		const slot: Slot<Input, Output> = { worker: this.createWorker() };
		slot.worker.onmessage = ({ data }: MessageEvent<{ output?: Output; error?: string }>) => {
			const task = slot.task;
			if (!task) return;

			slot.task = undefined;
			task.signal?.removeEventListener('abort', task.abort);
			if (data.error !== undefined) task.reject(new Error(data.error));
			else task.resolve(data.output!);
			this.dispatch();
		};
		const fail = (error: Error) => {
			if (this.disposed) return;
			const task = slot.task;
			slot.task = undefined;
			slot.worker.terminate();
			this.slots.splice(this.slots.indexOf(slot), 1);
			if (task) {
				task.signal?.removeEventListener('abort', task.abort);
				task.reject(error);
			}
			this.dispatch();
		};
		slot.worker.onerror = event => fail(new Error(event.message || 'Worker failed'));
		slot.worker.onmessageerror = () => fail(new Error('Worker response could not be decoded'));
		this.slots.push(slot);
		return slot;
	}

	private dispatch(): void {
		while (!this.disposed && this.waiting.length) {
			let slot = this.slots.find(slot => !slot.task);
			if (!slot && this.slots.length >= this.size) return;

			const task = this.waiting.shift()!;
			try {
				slot ??= this.createSlot();
				const { input, transfer } = task.create();
				slot.task = task;
				slot.worker.postMessage(input, transfer);
			} catch (error) {
				if (slot) slot.task = undefined;
				task.signal?.removeEventListener('abort', task.abort);
				task.reject(error);
			}
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		const tasks = [...this.waiting, ...this.slots.flatMap(slot => slot.task ? [slot.task] : [])];
		for (const task of tasks) {
			task.signal?.removeEventListener('abort', task.abort);
			task.reject(new Error('Worker pool disposed'));
		}
		for (const slot of this.slots) slot.worker.terminate();
		this.slots = [];
		this.waiting = [];
	}
}
