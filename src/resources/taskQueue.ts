/** Limits active work; queued tasks check their own cancellation before starting. */
export function createTaskQueue(concurrency: number) {
	let active = 0;
	const waiting: Array<() => void> = [];
	return async function run<T>(task: () => Promise<T>): Promise<T> {
		if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
		else active++;

		try {
			return await task();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	};
}
