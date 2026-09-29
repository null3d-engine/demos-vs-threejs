import { describe, expect, test } from 'bun:test';
import {
	countRange,
	countToSlider,
	formatCount,
	formatMegabytes,
	formatShort,
	MAX_START_SECONDS,
	SLIDER_STEPS,
	sliderToCount,
	startCount,
	startSeconds,
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

	test('runs from a tenth of the start count to the ramp maximum', () => {
		expect(countRange({ start: 1_000, max: 20_000 })).toEqual({ min: 100, max: 20_000 });
		expect(countRange({ start: 4, max: 50 })).toEqual({ min: 1, max: 50 });
	});
});

describe('start count', () => {
	const plan = { start: 1_000, max: 20_000 };

	test('is the ramp start without an address option', () => {
		expect(startCount(null, plan)).toBe(1_000);
	});

	test('follows a whole-number option inside the slider range', () => {
		expect(startCount('250', plan)).toBe(250);
		expect(startCount('20000', plan)).toBe(20_000);
	});

	test('keeps an option outside the range at its ends', () => {
		expect(startCount('3', plan)).toBe(100);
		expect(startCount('-5', plan)).toBe(100);
		expect(startCount('900000', plan)).toBe(20_000);
	});

	test('ignores an option that is not a whole number', () => {
		for (const option of ['', ' ', 'ten', '12.5', 'NaN', 'Infinity']) {
			expect(startCount(option, plan)).toBe(1_000);
		}
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

describe('start time', () => {
	test('is 0 without an address option or with one that is not a number', () => {
		for (const option of [null, '', 'soon', 'NaN', 'Infinity'])
			expect(startSeconds(option)).toBe(0);
	});

	test('follows the option, kept between 0 and the most', () => {
		expect(startSeconds('42.5')).toBe(42.5);
		expect(startSeconds('-3')).toBe(0);
		expect(startSeconds('100000')).toBe(MAX_START_SECONDS);
	});
});
