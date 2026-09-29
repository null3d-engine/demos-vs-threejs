import { describe, expect, test } from 'bun:test';
import { percentile, percentiles, ratePerSecond } from './stats';

describe('percentiles', () => {
	test('gives the count, median, percentiles and mean of the samples, in any order', () => {
		const samples = Float64Array.from({ length: 101 }, (_, i) => 100 - i);
		expect(percentiles(samples)).toEqual({ count: 101, median: 50, p95: 95, p99: 99, mean: 50 });
	});

	test('interpolates between the nearest ranks', () => {
		const sorted = Float64Array.of(1, 2, 3, 4);
		expect(percentile(sorted, 0.5)).toBe(2.5);
		expect(percentile(sorted, 0.95)).toBeCloseTo(3.85, 12);
		expect(percentile(sorted, 1)).toBe(4);
		expect(percentile(Float64Array.of(7), 0.99)).toBe(7);
	});

	test('leaves the samples unchanged', () => {
		const samples = Float64Array.of(3, 1, 2);
		const summary = percentiles(samples);
		expect(summary.median).toBe(2);
		expect([...samples]).toEqual([3, 1, 2]);
	});

	test('reports zeros for no samples', () => {
		expect(percentiles([])).toEqual({ count: 0, median: 0, p95: 0, p99: 0, mean: 0 });
	});
});

describe('ratePerSecond', () => {
	test('is the count over the time the intervals took', () => {
		expect(ratePerSecond([10, 10, 10, 10])).toBe(100);
		expect(ratePerSecond([8, 8, 8, 16])).toBeCloseTo(100, 12);
	});

	test('is null without intervals or without time', () => {
		expect(ratePerSecond([])).toBeNull();
		expect(ratePerSecond([0, 0])).toBeNull();
	});
});
