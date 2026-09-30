// Shrinking frames and joining them into an animated GIF with one shared palette, so colors do not
// flicker between frames. Adapted from the null3D engine's README animation (bench/readme-media.ts
// at commit 51fb3c3).

import { applyPalette, GIFEncoder, quantize } from 'gifenc';

/** An RGBA image, top row first. */
export interface Frame {
	width: number;
	height: number;
	pixels: Uint8Array;
}

/** Frames that the shared palette samples: one in this many. */
const PALETTE_SAMPLE_EVERY = 6;

/**
 * The weights of an area filter along one axis: for each output pixel, the source pixels it covers
 * and how much of each.
 */
function areaWeights(from: number, to: number): { start: number; weights: number[] }[] {
	const scale = from / to;
	return Array.from({ length: to }, (_, i) => {
		const left = i * scale;
		const right = left + scale;
		const start = Math.floor(left);
		const weights: number[] = [];
		for (let s = start; s < Math.min(from, Math.ceil(right)); s++)
			weights.push((Math.min(right, s + 1) - Math.max(left, s)) / scale);
		return { start, weights };
	});
}

/** Shrinks an image to `width` wide, keeping its shape, by averaging the pixels each covers. */
export function shrink(frame: Frame, width: number): Frame {
	if (width >= frame.width) return frame;
	const height = Math.max(1, Math.round((frame.height * width) / frame.width));
	const columns = areaWeights(frame.width, width);
	const rows = areaWeights(frame.height, height);
	const across = new Float32Array(width * frame.height * 4);
	for (let y = 0; y < frame.height; y++) {
		for (let x = 0; x < width; x++) {
			const { start, weights } = columns[x] as { start: number; weights: number[] };
			for (let c = 0; c < 4; c++) {
				let sum = 0;
				for (let k = 0; k < weights.length; k++)
					sum +=
						(weights[k] as number) *
						(frame.pixels[(y * frame.width + start + k) * 4 + c] as number);
				across[(y * width + x) * 4 + c] = sum;
			}
		}
	}
	const pixels = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const { start, weights } = rows[y] as { start: number; weights: number[] };
		for (let x = 0; x < width; x++) {
			for (let c = 0; c < 4; c++) {
				let sum = 0;
				for (let k = 0; k < weights.length; k++)
					sum += (weights[k] as number) * (across[((start + k) * width + x) * 4 + c] as number);
				pixels[(y * width + x) * 4 + c] = Math.round(sum);
			}
		}
	}
	return { width, height, pixels };
}

/** Joins frames of one size into a looping GIF that shows each frame for `delayMs`. */
export function gifBytes(frames: readonly Frame[], delayMs: number): Uint8Array {
	const first = frames[0];
	if (!first) throw new Error('A GIF needs at least one frame.');
	const { width, height } = first;
	const sampled = frames.filter((_, i) => i % PALETTE_SAMPLE_EVERY === 0);
	const joined = new Uint8Array(sampled.length * width * height * 4);
	for (const [i, frame] of sampled.entries()) joined.set(frame.pixels, i * width * height * 4);
	const palette = quantize(joined, 256);
	const gif = GIFEncoder();
	for (const [i, frame] of frames.entries()) {
		if (frame.width !== width || frame.height !== height)
			throw new Error(`Frame ${i + 1} is ${frame.width}x${frame.height}, not ${width}x${height}.`);
		// The first frame's palette becomes the GIF's global palette, which later frames use.
		gif.writeFrame(applyPalette(frame.pixels, palette), width, height, {
			palette: i === 0 ? palette : undefined,
			delay: delayMs,
		});
	}
	gif.finish();
	return gif.bytes();
}
