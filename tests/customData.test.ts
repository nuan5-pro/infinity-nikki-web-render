import { describe, expect, it } from 'vitest';
import { CustomDataBuffer, hbcLayer, validatePaperCustomData } from '../src/furniture/customData.js';

describe('native PaperCustomData', () => {
	it('rounds the complete HBC coordinate to nearest-even before physical depth clamp', () => {
		expect(hbcLayer(25, 0, 0, 9)).toBe(2);
		expect(hbcLayer(35, 0, 0, 9)).toBe(4);
		expect(hbcLayer(25, 1, 0, 9)).toBe(4);
		expect(hbcLayer(125, 0, 0, 9)).toBe(2);
		expect(hbcLayer(26, 0, 1, 9)).toBe(6);
		expect(hbcLayer(26, 0, 1, 3)).toBe(2);
		expect(hbcLayer(25, -10, 0, 9)).toBe(0);
	});

	it('keeps full integer identity rather than truncating raw into a byte or float', () => {
		expect(() => validatePaperCustomData([0xffffffff], 1)).not.toThrow();
		for (const value of [-1, 0.5, NaN, 0x100000000]) {
			expect(() => validatePaperCustomData([value], 1)).toThrow();
		}

		expect(() => validatePaperCustomData([0, 1], 1)).toThrow();
	});

	it('updates only changed RGBA texels and never uploads across a texture row', () => {
		const buffer = new CustomDataBuffer(new Uint32Array(20), 8, 8);
		const values = new Uint32Array(20);
		values[0] = 158;
		values[4] = 26;
		values[19] = 0xffffffff;
		buffer.set(1, values);
		expect(buffer.flush()).toBe(true);

		const ranges = buffer.texture.updateRanges;
		expect(ranges.reduce((sum, range) => sum + range.count, 0)).toBe(12);
		for (const { start, count } of ranges) {
			const rowWords = buffer.texture.image.width * 4;
			expect(start % 4).toBe(0);
			expect(Math.floor(start / rowWords)).toBe(Math.floor((start + count - 1) / rowWords));
		}

		expect(buffer.set(1, values)).toBe(false);
		expect(buffer.flush()).toBe(false);
		buffer.dispose();
	});

	it('preserves every source component through swap-delete and capacity growth', () => {
		const buffer = new CustomDataBuffer([0, 0, 0, 0, 0], 3, 8);
		buffer.set(2, [1, 26, 158, 0xffffffff, 4]);
		buffer.copySlot(2, 0);

		const larger = new CustomDataBuffer([0, 0, 0, 0, 0], 8, 8);
		buffer.copyTo(larger, 2);
		expect(larger.set(0, [1, 26, 158, 0xffffffff, 4])).toBe(false);
		expect(larger.set(1, [0, 0, 0, 0, 0])).toBe(false);
		buffer.dispose();
		expect(() => buffer.set(0, [0, 0, 0, 0, 0])).toThrow('disposed');
		expect(() => larger.set(8, [0, 0, 0, 0, 0])).toThrow('slot');
		larger.dispose();
	});

	it('rejects a batch that exceeds the actual device texture limit', () => {
		expect(() => new CustomDataBuffer(new Uint32Array(20), 4, 4)).toThrow('MAX_TEXTURE_SIZE');
	});
});
