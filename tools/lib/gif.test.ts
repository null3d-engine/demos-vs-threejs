import { describe, expect, test } from 'bun:test';
import { type Frame, gifBytes, shrink } from './gif';

/** A frame of one color. */
const solid = (width: number, height: number, rgba: number[]): Frame => {
	const pixels = new Uint8Array(width * height * 4);
	for (let p = 0; p < width * height; p++) pixels.set(rgba, p * 4);
	return { width, height, pixels };
};

describe('shrink', () => {
	test('averages the pixels each output pixel covers, and keeps the shape', () => {
		// Two columns: black and white. Shrunk to one pixel wide, they average to grey.
		const frame: Frame = { width: 2, height: 2, pixels: new Uint8Array(16) };
		frame.pixels.set([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
		const small = shrink(frame, 1);
		expect(small).toEqual({ width: 1, height: 1, pixels: new Uint8Array([128, 128, 128, 255]) });
		expect(shrink(solid(1280, 720, [10, 20, 30, 255]), 480)).toMatchObject({
			width: 480,
			height: 270,
		});
		expect(shrink(solid(1280, 720, [10, 20, 30, 255]), 480).pixels.slice(0, 4)).toEqual(
			new Uint8Array([10, 20, 30, 255]),
		);
	});

	test('leaves a frame that is already small enough as it is', () => {
		const frame = solid(4, 3, [1, 2, 3, 255]);
		expect(shrink(frame, 8)).toBe(frame);
	});
});

describe('gifBytes', () => {
	test('writes a GIF of the frames', () => {
		const bytes = gifBytes([solid(8, 4, [255, 0, 0, 255]), solid(8, 4, [0, 0, 255, 255])], 50);
		expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
		// The logical screen size, little-endian.
		expect([bytes[6], bytes[7], bytes[8], bytes[9]]).toEqual([8, 0, 4, 0]);
	});

	test('refuses frames of different sizes, and no frames', () => {
		expect(() => gifBytes([solid(8, 4, [0, 0, 0, 255]), solid(4, 4, [0, 0, 0, 255])], 50)).toThrow(
			'Frame 2 is 4x4',
		);
		expect(() => gifBytes([], 50)).toThrow('at least one frame');
	});
});
