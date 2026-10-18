import type { Matrix4, BufferGeometry } from 'three';
import { WorkerPool } from '../resources/workerPool.js';
import { geometryTransfers, packGeometryBuffers, processGeometryBuffers, restoreGeometryBuffers, type GeometryWork } from './geometryBuffers.js';

export class GeometryProcessor {
	private workers = new WorkerPool<GeometryWork, ReturnType<typeof processGeometryBuffers>>(
		() => new Worker(new URL('./geometryProcessor.worker.ts', import.meta.url), { type: 'module' }),
	);

	async prepare(geometries: BufferGeometry[], matrices: (Matrix4 | null)[], boundsTree: boolean, signal: AbortSignal): Promise<void> {
		const result = await this.workers.run(() => {
			const input = {
				geometries: geometries.map(packGeometryBuffers),
				matrices: matrices.map(matrix => matrix?.toArray() ?? null),
				boundsTree,
			};
			return { input, transfer: geometryTransfers(input.geometries) };
		}, signal);
		signal.throwIfAborted();
		result.forEach((data, index) => restoreGeometryBuffers(geometries[index]!, data));
	}

	dispose(): void { this.workers.dispose(); }
}

export interface GeometryProcessing {
	processor: GeometryProcessor;
	signal: AbortSignal;
}

export async function prepareGeometryBuffers(
	geometries: BufferGeometry[],
	matrices: Matrix4[],
	processing?: GeometryProcessing,
	boundsTree = false,
): Promise<void> {
	if (processing) return processing.processor.prepare(geometries, matrices, boundsTree, processing.signal);

	// The offline compiler uses the same transforms without a browser worker.
	geometries.forEach((geometry, index) => geometry.applyMatrix4(matrices[index]!));
}
