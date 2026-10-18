import { geometryTransfers, processGeometryBuffers, type GeometryWork } from './geometryBuffers.js';

self.onmessage = ({ data }: MessageEvent<GeometryWork>) => {
	try {
		const output = processGeometryBuffers(data);
		self.postMessage({ output }, { transfer: geometryTransfers(output) });
	} catch (error) {
		self.postMessage({ error: error instanceof Error ? error.message : String(error) });
	}
};
