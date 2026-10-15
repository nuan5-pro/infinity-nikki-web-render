import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	jewelryMaskedGlintIntensity,
	jewelryMaskedGlintKernel,
	jewelryMaskedHashScale,
	jewelryMaskedIntegerHash,
	jewelryMaskedLocalFrame,
	jewelryMaskedPixelFrame,
	jewelryMaskedPom,
	jewelryMaskedReflectionNormal,
	jewelryMaskedSurfaceNormal,
} from '../../src/materials/jewel/jewelryMaskedSource.js';

describe('de3c exact active kernels', () => {
	it('uses the actual hash immediate, not its rounded disassembly or 1/65536', () => {
		expect(new Uint32Array(new Float32Array([jewelryMaskedHashScale]).buffer)[0]).toBe(0x37800080);
		expect(jewelryMaskedHashScale).not.toBe(Math.fround(0.000015));
		expect(jewelryMaskedHashScale).not.toBe(1 / 65536);
	});

	it('preserves gradient operands through every POM sample and linear crossing', () => {
		const dx = [0.01, 0.002] as const;
		const dy = [-0.003, 0.02] as const;
		const samples: number[] = [];
		const result = jewelryMaskedPom(
			{
				uv: [0.5, 0.3],
				tangentView: [0.6, 0.2, 0.7],
				heightRatio: 0.05,
				noiseR: 0.8,
				phase: 4,
				dx,
				dy,
			},
			(uv, sampleDx, sampleDy) => {
				expect(sampleDx).toBe(dx);
				expect(sampleDy).toBe(dy);
				samples.push(uv[0]);
				return 0.4;
			},
		);
		expect(result.sampledSteps).toBeGreaterThan(1);
		expect(result.uv[0]).toBeCloseTo(0.5 - (0.6 / 0.7) * 0.05 * 0.6, 6);
		expect(result.jitter).toBe(0);
		expect(samples.every(Number.isFinite)).toBe(true);
	});

	it('rejects source singularities, nonfinite/HDR height and unproved cell domains', () => {
		const input = {
			uv: [0.5, 0.3] as const,
			tangentView: [0.6, 0.2, 0] as const,
			heightRatio: 0.05,
			noiseR: 0.8,
			phase: 4,
			dx: [0.01, 0] as const,
			dy: [0, 0.01] as const,
		};

		expect(() => jewelryMaskedPom(input, () => 0.4)).toThrow('grazing');
		expect(() => jewelryMaskedPom({ ...input, tangentView: [0.6, 0.2, 0.7] }, () => 2)).toThrow('normalized');
		expect(() => jewelryMaskedIntegerHash([2147483648, 0, 0])).toThrow('int32');
		expect(() => jewelryMaskedLocalFrame([0.1, 0, 1], [0, 1, 0, 1])).toThrow('SNORM8');
		expect(() => jewelryMaskedLocalFrame([1, 0, 0], [0, 0, 1, 0.5])).toThrow('handedness');
	});

	it('does not normalize the reflection composite, but normalizes the main normal', () => {
		const frame = {
			tangent: [1, 0, 0] as const,
			bitangent: [0, 1, 0] as const,
			normal: [0, 0, 1.01] as const,
		};

		const reflection = jewelryMaskedReflectionNormal([0.5, 0.5], frame);
		expect(reflection[2]).toBe(Math.fround(1.01));
		expect(jewelryMaskedSurfaceNormal([0.5, 0.5], 0, [0, 0, 0, 1], frame)).toEqual([0, 0, 1]);
	});

	it('reconstructs B after interpolation, with reflected frame parity and no magnitude normalization', () => {
		const frame = jewelryMaskedPixelFrame([1, 0, 0], [0, 0.5, 0.5], 1);
		expect(frame.bitangent).toEqual([0, 0.5, -0.5]);

		const mirrored = jewelryMaskedPixelFrame([-1, 0, 0], [0, 0.5, 0.5], -1);
		// The source multiply by negative handedness preserves signed zero.
		expect(mirrored.bitangent).toEqual([-0, 0.5, -0.5]);
		expect(Math.hypot(...frame.normal)).not.toBe(1);
		expect(() => jewelryMaskedPixelFrame([1, 0, 0], [0, 0.5, 0.5], 2)).toThrow('handedness');
	});

	it('retains each native AA branch and the low-intensity source soft sign', () => {
		const input = {
			rawIntensity: 200,
			distanceBlend: 0,
			distanceIntensityScale: 3,
			aaType: 0,
			shadowVisibility: 0.25,
			globalAttributeFactor: 1,
			swapLightFactor: 1,
			dlssWorldRate: [0.5, 8] as const,
			dlssEmissiveRate: 0.5,
			fsrEmissiveRate: 0.5,
			xessEmissiveMaximum: 50,
		};

		expect(jewelryMaskedGlintIntensity(input)).toBe(200);
		expect(jewelryMaskedGlintIntensity({ ...input, aaType: 1 })).toBe(100);
		expect(jewelryMaskedGlintIntensity({ ...input, aaType: 5 })).toBe(1225);
		expect(jewelryMaskedGlintIntensity({ ...input, aaType: 9 })).toBe(50);
		expect(jewelryMaskedGlintIntensity({ ...input, aaType: 10 })).toBe(15);
		expect(jewelryMaskedGlintIntensity({ ...input, aaType: 11 })).toBe(200);
		expect(jewelryMaskedGlintIntensity({ ...input, aaType: 9, rawIntensity: 0.00001 })).toBeLessThan(0.001);
		expect(() => jewelryMaskedGlintIntensity({ ...input, shadowVisibility: 2 })).toThrow('shadow');
	});
});

const evidence = process.env.JEWELRY_MASKED_EVIDENCE;
describe.skipIf(!evidence)('actual R01 original/variant native source', () => {
	it('cross-links actual bytecode, actual HDR parameters and native packed basis', () => {
		const root = evidence!;
		const instructions = JSON.parse(readFileSync(join(root, 'actual-ps-instruction-words.json'), 'utf8'));
		const immediate = instructions.selectedSourceInstructions.find((row: { asmLine: number }) => row.asmLine === 236);
		expect(instructions.oneToOneInstructionAssociation).toBe(true);
		expect(instructions.dxbcSHA256).toBe('31b423793bf4db3e74a075afcb639e393af38cf4f120e57b8c9886c77c1acb3d');
		expect(immediate.wordHex).toContain('37800080');

		const overlay = JSON.parse(readFileSync(join(dirname(root), 'r01-native-material-inputs.json'), 'utf8')).materials;
		const original = overlay.M_PABJ0004_01.cooked.NativeMaterialEvidence;
		const variant = overlay.M_PABJ0004_01_1__override_e3c63cf3bce03e74.cooked.NativeMaterialEvidence;
		expect(original.pixelShader).toBe(instructions.pixelShader);
		expect(variant.pixelShader).toBe(original.pixelShader);
		expect(original.scalarValues.Jewel_DetailHeightRatio).toBe(0.05);
		expect(original.scalarValues.Jewel_GlintLighting).toBe(1);
		expect(variant.colorValues.Jewel_D_Tint.R).toBe(3.5);

		const basis = JSON.parse(readFileSync(join(root, 'current-r01-basis-domain.json'), 'utf8'));
		expect(basis.renderingVersion).toBe(48);

		const lod = basis.lods[0];
		expect(lod.precisionFields.UseHighPrecisionTangentBasis).toBe('False');

		const bytes = Buffer.from(lod.cueBasisDWORDsBase64, 'base64');

		const read = (offset: number) => {
			const word = (bytes.readUInt32LE(offset) ^ 0x80808080) >>> 0;
			return [0, 8, 16, 24].map((shift) => {
				const packed = (word >>> shift) & 255;
				return Math.fround(Math.max(-1, (packed >= 128 ? packed - 256 : packed) / 127));
			});
		};

		const tangent = read(0);
		const normal = read(4);
		const frame = jewelryMaskedLocalFrame([tangent[0]!, tangent[1]!, tangent[2]!], [normal[0]!, normal[1]!, normal[2]!, normal[3]!]);
		const reflected = jewelryMaskedReflectionNormal([0.5, 0.5], frame);
		expect(reflected).toEqual(frame.normal);
		expect(Math.hypot(...reflected)).not.toBe(1);
	});

	it('retains actual source POM effect and all normalized noise phases', () => {
		const report = JSON.parse(readFileSync(join(evidence!, 'actual-source-pom-reference.json'), 'utf8'));
		expect(report.actualHeightRatio).toBe(0.05);
		expect(report.changedProbesAbove1e_4).toBeGreaterThan(0);
		expect(report.maxDetailTermDeltaBeforeBodyMultiply).toBeGreaterThan(0.01);
		for (let phase = 0; phase < 5; phase++) {
			for (const noiseR of [0, 0.5, 1]) {
				expect(
					jewelryMaskedPom(
						{
							uv: [0.3, 0.6],
							tangentView: [0.6, 0.2, 0.7],
							heightRatio: 0.05,
							noiseR,
							phase,
							dx: [0.01, 0],
							dy: [0, 0.01],
						},
						() => 0.4,
					).jitter,
				).toBe(0);
			}
		}
	});

	it('uses actual local positions for deterministic editor-time glint, not a screen random substitute', () => {
		const basis = JSON.parse(readFileSync(join(evidence!, 'current-r01-basis-domain.json'), 'utf8'));
		const raw = Buffer.from(basis.lods[0].nativePositionsF32CmBase64, 'base64');
		const position = [raw.readFloatLE(0), raw.readFloatLE(4), raw.readFloatLE(8)] as const;
		const results = [0, 0.25, 1, 10].map((editorTimeSeconds) =>
			jewelryMaskedGlintKernel({
				localPositionCM: position,
				attributes: [1.3, 1, 0.1, 0.01],
				editorTimeSeconds,
				sourceEmissionFactor: 5,
			}),
		);
		expect(results.every((row) => Number.isFinite(row.intensity))).toBe(true);
		expect(new Set(results.map((row) => row.intensity)).size).toBeGreaterThan(1);
		expect(results[0]!.hash).toEqual(results[1]!.hash);
		expect(
			jewelryMaskedGlintKernel({
				localPositionCM: position,
				attributes: [1.3, 0, 0.1, 0.01],
				editorTimeSeconds: 0,
				sourceEmissionFactor: 5,
			}).intensity,
		).toBe(0);
	});
});
