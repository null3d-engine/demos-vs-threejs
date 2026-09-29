import { describe, expect, test } from 'bun:test';
import {
	countToSlider,
	formatCount,
	formatMegabytes,
	formatShort,
	SLIDER_STEPS,
	sliderToCount,
} from './slider';

describe('count slider', () => {
	test('runs from the least to the most count on a log scale', () => {
		expect(sliderToCount(0, 1_000, 1_000_000)).toBe(1_000);
		expect(sliderToCount(SLIDER_STEPS, 1_000, 1_000_000)).toBe(1_000_000);
		expect(sliderToCount(SLIDER_STEPS / 3, 1_000, 1_000_000)).toBe(10_000);
	});

	test('a count maps to a slider position and back, to within one position', () => {
		for (const count of [1_000, 5_432, 61_917, 999_999]) {
			const position = countToSlider(count, 1_000, 1_000_000);
			expect(Math.abs(sliderToCount(position, 1_000, 1_000_000) / count - 1)).toBeLessThan(0.01);
		}
	});

	test('counts outside the range stay at its ends', () => {
		expect(countToSlider(1, 1_000, 1_000_000)).toBe(0);
		expect(countToSlider(1e9, 1_000, 1_000_000)).toBe(SLIDER_STEPS);
	});
});

describe('formatting', () => {
	test('groups digits and shortens large numbers', () => {
		expect(formatCount(61_917)).toBe('61,917');
		expect(formatShort(3_100_000)).toBe('3.1M');
		expect(formatShort(61_917)).toBe('62k');
		expect(formatShort(950)).toBe('950');
		expect(formatMegabytes(412 * 1024 * 1024)).toBe('412 MB');
	});
});
