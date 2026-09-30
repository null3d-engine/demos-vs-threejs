import { describe, expect, test } from 'bun:test';
import type { Measurement } from '../../src/engine/protocol';
import { SCENES } from '../../src/scenes/index';
import type { BenchResult } from '../../src/shell/result';
import {
	afterCount,
	type CountBounds,
	holdsRate,
	NEW_SEARCH,
	nextCount,
	roundCount,
	type ScaleSearch,
	scaleBounds,
	suggestedRamp,
} from './scale';

const BOUNDS: CountBounds = { first: 1_000, min: 100, max: 1_000_000 };

/** Runs a search on a device where three.js holds the rate up to `limit`. */
function search(limit: number, bounds = BOUNDS): { tried: number[]; found: ScaleSearch } {
	let state = NEW_SEARCH;
	let current = bounds;
	const tried: number[] = [];
	for (let count = nextCount(state, current); count !== null; count = nextCount(state, current)) {
		tried.push(count);
		({ search: state, bounds: current } = afterCount(state, current, count, count, count <= limit));
	}
	return { tried, found: state };
}

describe('the scale search', () => {
	test('doubles until a count drops, then narrows the gap between round counts', () => {
		const { tried, found } = search(12_345);
		expect(tried).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 11_000, 13_000, 12_000]);
		expect(found).toEqual({ held: 12_000, dropped: 13_000 });
		// With finer counts it stops when the gap is 5% or less.
		expect(search(300).found).toEqual({ held: 300, dropped: 310 });
	});

	test('halves the first count when it already drops', () => {
		const { tried, found } = search(300);
		expect(tried.slice(0, 3)).toEqual([1_000, 500, 250]);
		expect(found.held).toBeLessThanOrEqual(300);
		expect(found.dropped).toBeGreaterThan(300);
	});

	test('stops at the highest count when three.js holds the rate all the way', () => {
		const { tried, found } = search(Number.POSITIVE_INFINITY, {
			first: 1_000,
			min: 100,
			max: 5_000,
		});
		expect(tried).toEqual([1_000, 2_000, 4_000, 5_000]);
		expect(found).toEqual({ held: 5_000, dropped: null });
	});

	test('narrows to the count a page drew, when the page keeps it within its range', () => {
		const { search: state, bounds } = afterCount(NEW_SEARCH, BOUNDS, 8_000, 6_000, true);
		expect(state).toEqual({ held: 6_000, dropped: null });
		expect(bounds.max).toBe(6_000);
		expect(nextCount(state, bounds)).toBeNull();
		const raised = afterCount(NEW_SEARCH, BOUNDS, 100, 150, false);
		expect(raised.bounds.min).toBe(150);
		expect(raised.search).toEqual({ held: 0, dropped: 150 });
	});

	test('starts each scene at its phone start count', () => {
		for (const scene of Object.values(SCENES))
			expect(scaleBounds(scene.id)).toEqual({
				first: scene.ramp.phone.start,
				min: Math.round(scene.ramp.phone.start / 10),
				max: scene.maxCount,
			});
	});

	test('rounds counts to two significant figures', () => {
		expect(roundCount(12_345)).toBe(12_000);
		expect(roundCount(987)).toBe(990);
		expect(roundCount(7)).toBe(7);
	});
});

describe('holding the rate', () => {
	const result = (fps: number, displayHz: number) =>
		({ displayHz, measurement: { fps } as Measurement }) as BenchResult;

	test('uses the auto-slide rule: within 5% of the display rate, or of the given rate', () => {
		expect(holdsRate(result(114, 120), null)).toBe(true);
		expect(holdsRate(result(113.9, 120), null)).toBe(false);
		expect(holdsRate(result(29, 120), 30)).toBe(true);
		expect(holdsRate(result(28, 120), 30)).toBe(false);
	});

	test('suggests an auto-slide that passes the limit near second 8 and reaches 2.8 times it by second 20', () => {
		const { start, factor } = suggestedRamp(40_000);
		expect(start).toBe(20_000);
		expect(start * factor ** 8).toBeGreaterThan(39_000);
		expect(start * factor ** 8).toBeLessThan(41_000);
		expect((start * factor ** 20) / 40_000).toBeCloseTo(2.8, 1);
	});
});
