import { NN_CLOTH_SOURCE_DOMAIN, readNNClothSourceDomain } from './nnclothSourceDomain.js';
import type { NNClothSourceBounds } from './nnclothBounds.js';

interface SourceGeometryProof {
	sourceModelSHA256?: string;
	packageSHA256?: string;
	bounds?: NNClothSourceBounds;
	sourceBinding?: {
		version?: number;
		domain?: string;
		sourceIdentity?: string;
		sourcePath?: string;
		sourceMaterialIndex?: number;
		nativeMaterialSlot?: number;
		geometrySHA256?: string;
	};
}

/** Bind geometry and source slots before restoring native streams. */
export function assertNNClothReviewedGeometry(metadata: unknown, materialIdentity?: string) {
	if (!metadata || typeof metadata !== 'object') throw new Error('[NNCloth] reviewed source geometry proof missing');

	const proof = metadata as SourceGeometryProof;
	const binding = proof.sourceBinding;
	const domain = readNNClothSourceDomain(binding?.sourceIdentity);
	if (
		!binding ||
		!domain ||
		binding.version !== 1 ||
		binding.domain !== NN_CLOTH_SOURCE_DOMAIN ||
		(materialIdentity !== undefined && domain.identity !== materialIdentity) ||
		binding.sourcePath !== domain.sourcePath ||
		binding.sourceMaterialIndex !== 0 ||
		binding.nativeMaterialSlot !== 1 ||
		binding.geometrySHA256 !== '200b6e5a3321a73a56877c5a89d8c571db66e8ab55f6c893360a2f5c20974e94' ||
		proof.sourceModelSHA256 !==
			'86f4a78a8c1d1dfb0363610adc5fea291f01d2ea4b9badf7d49388ee9737d846' ||
		proof.packageSHA256 !== '28ac568b2d847e89576ef32495b633e1f09c802c8fcd686a79789018083fb264'
	) throw new Error('[NNCloth] reviewed material/geometry/source-slot identity mismatch');

	const bounds = proof.bounds;
	if (
		!bounds ||
		bounds.source !== 'UStaticMesh.ExtendedBounds-native-cm' ||
		bounds.origin?.join(',') !== '3.9578094,-41.421417,218.51549' ||
		bounds.extent?.join(',') !== '275.8152,170.4451,220.85936' ||
		bounds.radius !== 378.1394500732422
	) throw new Error('[NNCloth] reviewed original ExtendedBounds changed');
}
