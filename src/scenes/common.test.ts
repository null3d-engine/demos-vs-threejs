import { describe, expect, test } from 'bun:test';
import {
	angleDifference,
	FixedClock,
	hash01,
	MAX_STEPS_PER_FRAME,
	mulberry32,
	quatMultiply,
	quatPitch,
	quatYaw,
	SIM_STEP,
	sampleCameraLoop,
	smoothstep,
	spiralCell,
	stepsUntil,
} from './common';
import { rotate } from './testing';

describe('mulberry32', () => {
	test('gives the same sequence for the same seed, in [0, 1)', () => {
		const a = mulberry32(42);
		const b = mulberry32(42);
		for (let i = 0; i < 1000; i++) {
			const value = a();
			expect(value).toBe(b());
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});
});

describe('hash01', () => {
	test('is deterministic, in [0, 1), and spreads its values', () => {
		let sum = 0;
		const seen = new Set<number>();
		for (let i = 0; i < 10_000; i++) {
			const value = hash01(3, i, 7);
			expect(value).toBe(hash01(3, i, 7));
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
			sum += value;
			seen.add(value);
		}
		expect(sum / 10_000).toBeCloseTo(0.5, 1);
		expect(seen.size).toBeGreaterThan(9_990);
	});

	test('changes with every input', () => {
		expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
		expect(hash01(1, 2, 3)).not.toBe(hash01(1, 3, 3));
		expect(hash01(1, 2, 3)).not.toBe(hash01(2, 2, 3));
	});
});

describe('FixedClock', () => {
	test('turns frame times into whole steps and carries the rest', () => {
		const clock = new FixedClock();
		expect(clock.advance(SIM_STEP)).toBe(1);
		expect(clock.advance(SIM_STEP / 2)).toBe(0);
		expect(clock.advance(SIM_STEP / 2)).toBe(1);
		expect(clock.steps).toBe(2);
		expect(clock.time).toBeCloseTo(2 * SIM_STEP, 12);
	});

	test('drops time beyond the most steps per frame, so a slow engine slows the scene', () => {
		const clock = new FixedClock();
		expect(clock.advance(1)).toBe(MAX_STEPS_PER_FRAME);
		expect(clock.advance(SIM_STEP)).toBe(1);
	});

	test('ignores negative frame times', () => {
		const clock = new FixedClock();
		expect(clock.advance(-1)).toBe(0);
		expect(clock.steps).toBe(0);
	});

	test('stepsUntil counts the steps to a scene time', () => {
		expect(stepsUntil(2)).toBe(Math.round(2 / SIM_STEP));
	});
});

describe('smoothstep and angleDifference', () => {
	test('smoothstep runs from 0 to 1 and clamps', () => {
		expect(smoothstep(-1)).toBe(0);
		expect(smoothstep(0.5)).toBe(0.5);
		expect(smoothstep(2)).toBe(1);
	});

	test('angleDifference wraps into (-π, π]', () => {
		expect(angleDifference(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2, 12);
		expect(angleDifference(Math.PI, -Math.PI)).toBeCloseTo(0, 12);
		expect(angleDifference(-3, 3)).toBeCloseTo(2 * Math.PI - 6, 12);
	});
});

describe('quaternions', () => {
	test('yaw turns +Z toward +X; pitch tips +Y toward +Z', () => {
		const q = new Float64Array(4);
		quatYaw(q, 0, Math.PI / 2);
		const turned = rotate(q, [0, 0, 1]);
		expect(turned[0]).toBeCloseTo(1, 12);
		expect(turned[2]).toBeCloseTo(0, 12);
		quatPitch(q, 0, Math.PI / 2);
		const tipped = rotate(q, [0, 1, 0]);
		expect(tipped[1]).toBeCloseTo(0, 12);
		expect(tipped[2]).toBeCloseTo(1, 12);
	});

	test('a × b applies b first', () => {
		const yaw = new Float64Array(4);
		const pitch = new Float64Array(4);
		const both = new Float64Array(4);
		quatYaw(yaw, 0, Math.PI / 2);
		quatPitch(pitch, 0, Math.PI / 2);
		quatMultiply(both, 0, yaw, 0, pitch, 0);
		// Pitch takes +Y to +Z, then yaw takes +Z to +X.
		const v = rotate(both, [0, 1, 0]);
		expect(v[0]).toBeCloseTo(1, 12);
		expect(v[1]).toBeCloseTo(0, 12);
		expect(v[2]).toBeCloseTo(0, 12);
	});
});

describe('spiralCell', () => {
	test('the first (2r+1)² cells fill the square of ring r, each once', () => {
		const cell = new Int32Array(2);
		for (const ring of [0, 1, 2, 7]) {
			const side = 2 * ring + 1;
			const seen = new Set<string>();
			for (let i = 0; i < side * side; i++) {
				spiralCell(i, cell, 0);
				expect(Math.max(Math.abs(cell[0]!), Math.abs(cell[1]!))).toBeLessThanOrEqual(ring);
				seen.add(`${cell[0]},${cell[1]}`);
			}
			expect(seen.size).toBe(side * side);
		}
	});

	test('neighbouring entries are next to each other within a ring', () => {
		const a = new Int32Array(2);
		const b = new Int32Array(2);
		for (let i = 1; i < 200; i++) {
			spiralCell(i, a, 0);
			spiralCell(i + 1, b, 0);
			const step = Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!);
			const newRing =
				Math.max(Math.abs(b[0]!), Math.abs(b[1]!)) > Math.max(Math.abs(a[0]!), Math.abs(a[1]!));
			if (!newRing) expect(step).toBe(1);
		}
	});
});

describe('sampleCameraLoop', () => {
	const loop = {
		seconds: 40,
		positions: [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10],
		targets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	};

	test('passes through every control point', () => {
		const position = new Float64Array(3);
		const target = new Float64Array(3);
		for (let k = 0; k < 4; k++) {
			sampleCameraLoop(loop, k * 10, position, target);
			expect(position[0]).toBeCloseTo(loop.positions[k * 3]!, 9);
			expect(position[2]).toBeCloseTo(loop.positions[k * 3 + 2]!, 9);
		}
	});

	test('loops: time t and t + seconds give the same point', () => {
		const a = new Float64Array(3);
		const b = new Float64Array(3);
		const target = new Float64Array(3);
		sampleCameraLoop(loop, 7.3, a, target);
		sampleCameraLoop(loop, 47.3, b, target);
		for (let axis = 0; axis < 3; axis++) expect(a[axis]).toBeCloseTo(b[axis]!, 9);
	});
});
