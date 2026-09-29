import { describe, expect, test } from 'bun:test';
import { compareImages, passesWithBaseline, percent, type RgbaImage, toRgba } from './parity';

function image(width: number, height: number, rgb: [number, number, number]): RgbaImage {
	const data = new Uint8Array(width * height * 4);
	for (let p = 0; p < width * height; p++) data.set([...rgb, 255], p * 4);
	return { width, height, data };
}

describe('image check', () => {
	test('the same image has no differing pixels', () => {
		const a = image(4, 4, [10, 200, 30]);
		const result = compareImages(a, image(4, 4, [10, 200, 30]));
		expect(result.differentPixels).toBe(0);
		expect(result.pass).toBe(true);
	});

	test('a pixel differs only past a tenth of the black-to-white distance', () => {
		const reference = image(10, 10, [100, 100, 100]);
		// Distance 44 in each channel: sqrt(3 * 44²) / sqrt(3 * 255²) = 0.173, past 0.1.
		const far = image(10, 10, [100, 100, 100]);
		far.data.set([144, 144, 144, 255], 0);
		// Distance 25 in each channel: 0.098, under 0.1.
		const near = image(10, 10, [100, 100, 100]);
		near.data.set([125, 125, 125, 255], 0);
		expect(compareImages(reference, far).differentPixels).toBe(1);
		expect(compareImages(reference, near).differentPixels).toBe(0);
	});

	test('images match when under 0.1% of their pixels differ', () => {
		const reference = image(100, 100, [0, 0, 0]);
		const nine = image(100, 100, [0, 0, 0]);
		const ten = image(100, 100, [0, 0, 0]);
		for (let p = 0; p < 10; p++) {
			if (p < 9) nine.data.set([255, 255, 255, 255], p * 4);
			ten.data.set([255, 255, 255, 255], p * 4);
		}
		expect(compareImages(reference, nine).pass).toBe(true);
		expect(compareImages(reference, ten).pass).toBe(false);
		expect(percent(compareImages(reference, ten).share)).toBe('0.100%');
	});

	test('the diff marks differing pixels red and dims the rest', () => {
		const reference = image(2, 1, [200, 100, 50]);
		const candidate = image(2, 1, [200, 100, 50]);
		candidate.data.set([0, 0, 0, 255], 4);
		const { diff } = compareImages(reference, candidate);
		expect([...diff.data.slice(0, 4)]).toEqual([40, 20, 10, 255]);
		expect([...diff.data.slice(4, 8)]).toEqual([255, 0, 0, 255]);
	});

	test('images of different sizes or wrong byte counts are refused', () => {
		expect(() => compareImages(image(2, 2, [0, 0, 0]), image(2, 3, [0, 0, 0]))).toThrow(RangeError);
		expect(() =>
			compareImages({ width: 2, height: 2, data: new Uint8Array(3) }, image(2, 2, [0, 0, 0])),
		).toThrow(RangeError);
	});

	test('an engine passes under the limit or no worse than three.js against itself', () => {
		expect(passesWithBaseline(0.0005, null)).toBe(true);
		expect(passesWithBaseline(0.004, null)).toBe(false);
		expect(passesWithBaseline(0.004, 0.005)).toBe(true);
		expect(passesWithBaseline(0.006, 0.005)).toBe(false);
	});

	test('RGB and gray images become RGBA', () => {
		const rgb = toRgba({ width: 1, height: 1, channels: 3, data: [1, 2, 3] });
		expect([...rgb.data]).toEqual([1, 2, 3, 255]);
		const grayAlpha = toRgba({ width: 1, height: 1, channels: 2, data: [9, 128] });
		expect([...grayAlpha.data]).toEqual([9, 9, 9, 128]);
	});
});
