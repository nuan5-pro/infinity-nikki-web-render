import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import {
	replayNNClothTokens,
	type NNTokenOperand,
} from '../reference/nnclothReference.js';

const literal = (word: number): NNTokenOperand => ({
	type: 4,
	numComponents: 1,
	selectionMode: 0,
	selection: 0,
	modifier: 0,
	indices: [],
	literalWords: [word],
});

const output: NNTokenOperand = {
	type: 2,
	numComponents: 2,
	selectionMode: 0,
	selection: 15,
	modifier: 0,
	indices: [{ immediate: 0 }],
	literalWords: [],
};

const fixture = {
	registers: {},
	primitiveWords: [],

	sample: async () => {
		throw new Error('unexpected sample');
	},
};

test('native DWORD interpreter retains exact float32 literals and native NaN min/sat rules', async () => {
	const exact = await replayNNClothTokens(
		[{ asmLine: 1, op: 'mov', saturate: false, operands: [output, literal(0x3eaaaaab)] }],
		fixture,
		Infinity,
		true,
	);
	assert.equal(exact.outputs.o0?.[0], Math.fround(1 / 3));

	const minimum = await replayNNClothTokens(
		[
			{
				asmLine: 1,
				op: 'min',
				saturate: false,
				operands: [output, literal(0x7fc00000), literal(0x3f800000)],
			},
		],
		fixture,
		Infinity,
		true,
	);
	assert.deepEqual(minimum.outputs.o0, [1, 1, 1, 1]);

	const saturate = await replayNNClothTokens(
		[{ asmLine: 1, op: 'mov', saturate: true, operands: [output, literal(0x7fc00000)] }],
		fixture,
		Infinity,
		true,
	);
	assert.deepEqual(saturate.outputs.o0, [0, 0, 0, 0]);
});

test('native discard tests raw word control and integer negation is not float sign flipping', async () => {
	const negate = { ...literal(10), modifier: 1 };
	const value = await replayNNClothTokens(
		[
			{ asmLine: 1, op: 'imax', saturate: false, operands: [output, negate, literal(0xfffffff0)] },
			{
				asmLine: 2,
				op: 'discard',
				saturate: false,
				rawWords: ['0104000d'],
				operands: [literal(1)],
			},
		],
		fixture,
		Infinity,
		true,
	);
	const bits = new Uint32Array(new Float32Array(value.outputs.o0).buffer);
	assert.equal(bits[0], 0xfffffff6);
	assert.equal(value.rejected, true);
});
