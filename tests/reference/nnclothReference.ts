/** Independent instruction interpreter for native material-body conformance.
 * It consumes original DWORD operands; it never calls the generated GLSL body.
 * A fixture supplies every live input/primitive word and the actual GPU sampler.
 */
export interface NNTokenOperand {
	type: number;
	numComponents: number;
	selectionMode: number;
	selection: number | number[];
	modifier: number;
	indices: { immediate?: number; relative?: NNTokenOperand }[];
	literalWords: number[];
}

export interface NNTokenInstruction {
	asmLine: number;
	op: string;
	saturate: boolean;
	operands: NNTokenOperand[];
	rawWords?: string[];
}

export interface NNReferenceFixture {
	registers: Record<string, number[]>;
	primitiveWords: number[][];
	sample: (request: {
		line: number;
		resource: string;
		sampler: string;
		coordinate: number[];
		op: string;
		level: number;
	}) => Promise<number[]>;
}

const wordBuffer = new ArrayBuffer(4);
const words = new Uint32Array(wordBuffer);
const floats = new Float32Array(wordBuffer);

const fromBits = (value: number) => {
	words[0] = value;
	return floats[0]!;
};

const toBits = (value: number) => {
	floats[0] = value;
	return words[0]!;
};

const signed = (value: number) => value | 0;
// SM4/5 MIN/MAX return the other operand when exactly one input is NaN;
// consequently the native _sat modifier maps NaN to zero.
const nativeMin = (a: number, b: number) => Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.min(a, b);

const nativeMax = (a: number, b: number) => Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a, b);

const saturated = (value: number) => nativeMin(1, nativeMax(0, value));

export async function replayNNClothTokens(instructions: NNTokenInstruction[], fixture: NNReferenceFixture, endLine = 1256, coverage = false) {
	const registers = new Map(Object.entries(fixture.registers).map(([name, value]) => [name, value.slice()]));
	const samples: { line: number; resource: string; coordinate: number[]; rgba: number[] }[] = [];
	const checkpoints: { line: number; register: string; words: number[] }[] = [];
	const discards: { line: number; operand: number; rejected: boolean }[] = [];

	const index = (entry: NNTokenOperand['indices'][number]): number => {
		return (entry.immediate ?? 0) + (entry.relative ? read(entry.relative)[0]! : 0);
	};

	const key = (operand: NNTokenOperand) => {
		const indices = operand.indices.map(index);
		if (operand.type === 8) return `cb${indices[0]}[${indices[1]}]`;

		const prefix = (
			{ 0: 'r', 1: 'v', 2: 'o', 3: 'x', 6: 's', 7: 't', 9: 'icb', 12: 'oDepth' } as Record<number, string>
		)[operand.type];
		if (!prefix) throw new Error(`[NNReference] unsupported register type ${operand.type}`);

		return operand.type === 3 || operand.type === 9
			? `${prefix}[${indices.join(',')}]`
			: `${prefix}${indices.join('')}`;
	};

	const read = (operand: NNTokenOperand, integer = false): number[] => {
		let values: number[];
		if (operand.type === 4) {
			values =
				operand.literalWords.length === 1
					? Array(4).fill(operand.literalWords[0])
					: operand.literalWords.slice();
		} else {
			const name = key(operand);
			const original = registers.get(name);
			if (!original) throw new Error(`[NNReference] missing explicit input ${name}`);

			if (operand.selectionMode === 1)
				values = (operand.selection as number[]).map((lane) => original[lane]!);
			else if (operand.selectionMode === 2)
				values = Array(4).fill(original[operand.selection as number]);
			else values = original.slice();
		}

		return values.map((value) => {
			if (!operand.modifier) return value;

			if (integer) {
				if (operand.modifier !== 1) throw new Error('[NNReference] unsupported integer absolute modifier');

				return -value >>> 0;
			}

			const number = fromBits(value);
			return toBits(
				operand.modifier === 1
					? -number
					: operand.modifier === 2
						? Math.abs(number)
						: -Math.abs(number),
			);
		});
	};

	const write = (operand: NNTokenOperand, value: number[], saturation: boolean) => {
		const name = key(operand);
		const old = registers.get(name) ?? Array(4).fill(0);
		const mask =
			operand.numComponents === 1
				? 1
				: operand.selectionMode === 0
					? (operand.selection as number)
					: 1 << (operand.selection as number);
		for (let lane = 0; lane < 4; lane++) {
			if (mask & (1 << lane))
				old[lane] = saturation ? toBits(saturated(fromBits(value[lane]!))) : value[lane]!;
		}

		registers.set(name, old);
		return name;
	};

	const roundEven = (value: number) => {
		const lower = Math.floor(value);
		const delta = value - lower;
		return delta === 0.5 ? (lower % 2 === 0 ? lower : lower + 1) : Math.round(value);
	};

	for (const instruction of instructions) {
		if (instruction.asmLine > endLine) break;
		let operands = instruction.operands;
		const op = instruction.op;
		if (op === 'ret') break;
		if (op === 'discard') {
			const operand = read(operands[0]!)[0]!;
			if (!instruction.rawWords?.length) throw new Error('[NNReference] native discard control DWORD missing');

			const nonzero = (parseInt(instruction.rawWords[0]!, 16) & 0x40000) !== 0;
			discards.push({
				line: instruction.asmLine,
				operand,
				rejected: nonzero ? operand !== 0 : operand === 0,
			});
			continue;
		}

		if (op === 'udiv') {
			const dividend = read(operands[2]!);
			const divisor = read(operands[3]!);
			for (let resultIndex = 0; resultIndex < 2; resultIndex++) {
				const destination = operands[resultIndex]!;
				if (destination.type === 13) continue;
				const result = dividend.map((value, lane) =>
					divisor[lane] === 0
						? 0xffffffff
						: resultIndex
							? value % divisor[lane]!
							: Math.floor(value / divisor[lane]!),
				);
				const register = write(destination, result, false);
				checkpoints.push({
					line: instruction.asmLine,
					register,
					words: registers.get(register)!.slice(),
				});
			}

			continue;
		}

		if (op === 'imul') {
			if (operands[0]!.type !== 13) throw new Error('[NNReference] high multiply result unsupported');

			operands = operands.slice(1);
		}

		const integer = [
			'and',
			'or',
			'xor',
			'ineg',
			'imul',
			'imad',
			'iadd',
			'imax',
			'imin',
			'ishl',
			'ushr',
			'ieq',
			'ine',
			'itof',
			'utof',
		].includes(op);
		const source = op.startsWith('sample')
			? [read(operands[1]!), [], [], operands[4] ? read(operands[4]) : []]
			: op === 'ld_structured'
				? [read(operands[1]!), read(operands[2]!)]
				: operands.slice(1).map((operand) => read(operand, integer));
		const numbers = source.map((value) => value.map(fromBits));
		let result: number[];
		if (op.startsWith('sample')) {
			const resource = key(operands[2]!);
			const sampler = key(operands[3]!);
			const rgba = await fixture.sample({
				line: instruction.asmLine,
				resource,
				sampler,
				coordinate: numbers[0]!,
				op,
				level: numbers[3]?.[0] ?? 0,
			});
			const selection = operands[2]!.selection as number[];
			result = selection.map((lane) => toBits(rgba[lane]!));
			samples.push({ line: instruction.asmLine, resource, coordinate: numbers[0]!, rgba });
		} else if (op === 'ld_structured') {
			const word = source[0]![0]! * 4 + source[1]![0]! / 4;
			const raw = Array.from({ length: 4 }, (_, lane) => {
				const address = word + lane;
				const row = fixture.primitiveWords[Math.floor(address / 4)];
				if (!row) throw new Error(`[NNReference] missing primitive word ${address}`);

				return row[address % 4]!;
			});
			result = (operands[3]!.selection as number[]).map((lane) => raw[lane]!);
		} else if (op.startsWith('dp')) {
			const count = Number(op.slice(-1));
			let value = 0;
			for (let lane = 0; lane < count; lane++)
				value = Math.fround(value + Math.fround(numbers[0]![lane]! * numbers[1]![lane]!));

			result = Array(4).fill(toBits(value));
		} else {
			result = Array.from({ length: 4 }, (_, lane) => {
				const a = numbers[0]?.[lane] ?? 0;
				const b = numbers[1]?.[lane] ?? 0;
				const c = numbers[2]?.[lane] ?? 0;
				const wa = source[0]?.[lane] ?? 0;
				const wb = source[1]?.[lane] ?? 0;
				const wc = source[2]?.[lane] ?? 0;
				switch (op) {
				case 'mov':
					return wa;
				case 'movc':
					return wa !== 0 ? wb : wc;
				case 'add':
					return toBits(a + b);
				case 'mul':
					return toBits(a * b);
				case 'div':
					return toBits(a / b);
				case 'mad':
					return toBits(a * b + c);
				case 'min':
					return toBits(nativeMin(a, b));
				case 'max':
					return toBits(nativeMax(a, b));
				case 'sqrt':
					return toBits(Math.sqrt(a));
				case 'rsq':
					return toBits(1 / Math.sqrt(a));
				case 'log':
					return toBits(Math.log2(a));
				case 'exp':
					return toBits(2 ** a);
				case 'frc':
					return toBits(a - Math.floor(a));
				case 'round_ni':
					return toBits(Math.floor(a));
				case 'round_ne':
					return toBits(roundEven(a));
				case 'round_z':
					return toBits(Math.trunc(a));
				case 'ftou':
					return Math.trunc(a) >>> 0;
				case 'ftoi':
					return Math.trunc(a) >>> 0;
				case 'utof':
					return toBits(wa);
				case 'itof':
					return toBits(signed(wa));
				case 'ieq':
					return wa === wb ? 0xffffffff : 0;
				case 'ine':
					return wa !== wb ? 0xffffffff : 0;
				case 'eq':
					return a === b ? 0xffffffff : 0;
				case 'ne':
					return a !== b ? 0xffffffff : 0;
				case 'ge':
					return a >= b ? 0xffffffff : 0;
				case 'lt':
					return a < b ? 0xffffffff : 0;
				case 'and':
					return (wa & wb) >>> 0;
				case 'or':
					return (wa | wb) >>> 0;
				case 'xor':
					return (wa ^ wb) >>> 0;
				case 'iadd':
					return (wa + wb) >>> 0;
				case 'ineg':
					return -wa >>> 0;
				case 'imax':
					return Math.max(signed(wa), signed(wb)) >>> 0;
				case 'imin':
					return Math.min(signed(wa), signed(wb)) >>> 0;
				case 'umax':
					return Math.max(wa, wb);
				case 'umin':
					return Math.min(wa, wb);
				case 'ishl':
					return (wa << (wb & 31)) >>> 0;
				case 'ushr':
					return wa >>> (wb & 31);
				case 'imul':
					return Math.imul(signed(wa), signed(wb)) >>> 0;
				case 'imad':
					return (Math.imul(signed(wa), signed(wb)) + signed(wc)) >>> 0;
				default:
					throw new Error(`[NNReference] unimplemented native opcode ${op} at ${instruction.asmLine}`);
				}
			});
		}

		const destination = write(operands[0]!, result, instruction.saturate);
		checkpoints.push({
			line: instruction.asmLine,
			register: destination,
			words: registers.get(destination)!.slice(),
		});
	}

	const output = (name: string, lanes: number[]) => {
		const words = registers.get(name);
		if (!words) throw new Error(`[NNReference] missing output ${name}`);

		return lanes.map((lane) => fromBits(words[lane]!));
	};

	const outputs = coverage
		? Object.fromEntries(
			[...registers]
				.filter(([name]) => /^o\d+$|^oDepth$/.test(name))
				.map(([name, words]) => [name, words.map(fromBits)]),
		)
		: {
			baseColor: output('r0', [0, 1, 2]),
			roughness: output('r0', [3]),
			metalness: output('r7', [0]),
			specular: output('r7', [1]),
			worldNormal: output('r16', [0, 1, 2]),
			emission: output('r8', [0, 1, 2]),
			subsurfaceColor: output('r5', [0, 1, 2]),
			subsurfaceOpacity: output('o4', [3]),
		};
	return {
		outputs,
		samples,
		checkpoints,
		discards,
		rejected: discards.some((value) => value.rejected),
	};
}
