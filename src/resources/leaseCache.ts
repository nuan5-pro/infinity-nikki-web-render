export interface AssetLease<T> {
	ready: Promise<T>
	release(): void
}

interface CacheEntry<T> {
	refs: number
	retired: boolean
	value?: T
	ready: Promise<T>
	controller: AbortController
}

/** Decoder sources retire on their last lease; immutable data can remain warm until clear(). */
export class AssetLeaseCache<T> {
	private entries = new Map<string, CacheEntry<T>>();
	private disposeValue: (value: T) => void;
	private retainIdle: boolean;

	constructor(disposeValue: (value: T) => void, retainIdle = false) {
		this.disposeValue = disposeValue;
		this.retainIdle = retainIdle;
	}

	acquire(key: string, load: (signal: AbortSignal) => Promise<T>): AssetLease<T> {
		let entry = this.entries.get(key);
		if (!entry) {
			const created: CacheEntry<T> = {
				refs: 0,
				retired: false,
				controller: new AbortController(),
				ready: Promise.resolve()
					.then(() => {
						if (created.controller.signal.aborted) throw new Error(`Asset lease expired before loading: ${key}`);

						return load(created.controller.signal);
					})
					.then((value) => {
						if (created.retired) {
							this.disposeValue(value);
							throw new Error(`Asset lease expired while loading: ${key}`);
						}

						created.value = value;
						return value;
					})
					.catch((error) => {
						if (this.entries.get(key) === created) this.entries.delete(key);
						created.retired = true;
						throw error;
					}),
			};

			entry = created;
			this.entries.set(key, entry);
		}

		entry.refs++;

		let released = false;
		return {
			ready: entry.ready.then((value) => {
				if (released || entry.retired) throw new Error(`Asset lease is no longer active: ${key}`);

				return value;
			}),

			release: () => {
				if (released) return;

				released = true;
				entry.refs--;
				if (!entry.refs && (!this.retainIdle || entry.value === undefined)) this.retire(key, entry);
			},
		};
	}

	private retire(key: string, entry: CacheEntry<T>): void {
		if (entry.retired) return;

		entry.retired = true;
		entry.controller.abort();
		if (this.entries.get(key) === entry) this.entries.delete(key);
		if (entry.value !== undefined) this.disposeValue(entry.value);
		entry.value = undefined;
	}

	clear(): void {
		for (const [key, entry] of this.entries) this.retire(key, entry);
	}

	clearUnused(): void {
		for (const [key, entry] of this.entries) if (!entry.refs) this.retire(key, entry);
	}
}
