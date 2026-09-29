// The image check: two hold frames of the same scene, compared with three.js's own image rule.
// Copied from the null3D engine repository (bench/lib/parity.ts at commit 51fb3c3).
//
// The rule is the one that three.js's end-to-end test applies to its example screenshots. A pixel
// differs when the distance between its two RGB colors is more than a set share of the distance
// from black to white. Alpha does not count, and no pixel is excused as anti-aliasing. Two images
// match when strictly less than a set percentage of their pixels differ.

/** A pixel differs when its RGB distance is more than this share of the distance from black to white. */
export const PIXEL_THRESHOLD = 0.1;
/** Two images match when strictly less than this percentage of their pixels differ. */
export const MAX_DIFFERENT_PERCENT = 0.1;

/** The squared RGB distance from black to white, which scales a squared distance to [0, 1]. */
const MAX_SQUARED_DISTANCE = 255 * 255 * 3;
/** A diff image shows each matching pixel at this share of the reference pixel's value. */
const DIFF_DIM = 0.2;
const BYTES_PER_PIXEL = 4;
const OPAQUE = 255;

/** RGBA8 pixels, rows tightly packed, top row first. */
export interface RgbaImage {
	width: number;
	height: number;
	data: Uint8Array;
}

export interface ImageComparison {
	/** Pixels whose colors differ by more than the per-pixel threshold. */
	differentPixels: number;
	/** The differing pixels' share of all pixels, from 0 to 1. */
	share: number;
	/** True when the share is under three.js's limit. */
	pass: boolean;
	/** The reference image dimmed, with each differing pixel in pure red. */
	diff: RgbaImage;
}

function checkImage(image: RgbaImage, name: string): void {
	if (image.data.length !== image.width * image.height * BYTES_PER_PIXEL)
		throw new RangeError(
			`${name} holds ${image.data.length} bytes, not RGBA8 ${image.width} x ${image.height}`,
		);
}

/**
 * Compares two images with three.js's rule. The diff image dims the reference image and marks each
 * differing pixel in red. Images of different sizes are refused.
 */
export function compareImages(reference: RgbaImage, candidate: RgbaImage): ImageComparison {
	checkImage(reference, 'the reference image');
	checkImage(candidate, 'the candidate image');
	const { width, height } = reference;
	if (candidate.width !== width || candidate.height !== height) {
		throw new RangeError(
			`the images differ in size: ${width} x ${height} and ${candidate.width} x ${candidate.height}`,
		);
	}
	const a = reference.data;
	const b = candidate.data;
	const diff = new Uint8Array(a.length);
	const thresholdSquared = PIXEL_THRESHOLD * PIXEL_THRESHOLD;
	let differentPixels = 0;
	for (let i = 0; i < a.length; i += BYTES_PER_PIXEL) {
		const red = a[i] ?? 0;
		const green = a[i + 1] ?? 0;
		const blue = a[i + 2] ?? 0;
		const dr = red - (b[i] ?? 0);
		const dg = green - (b[i + 1] ?? 0);
		const db = blue - (b[i + 2] ?? 0);
		if ((dr * dr + dg * dg + db * db) / MAX_SQUARED_DISTANCE > thresholdSquared) {
			differentPixels++;
			diff[i] = 255;
		} else {
			diff[i] = red * DIFF_DIM;
			diff[i + 1] = green * DIFF_DIM;
			diff[i + 2] = blue * DIFF_DIM;
		}
		diff[i + 3] = OPAQUE;
	}
	const share = differentPixels / (width * height);
	return {
		differentPixels,
		share,
		pass: share * 100 < MAX_DIFFERENT_PERCENT,
		diff: { width, height, data: diff },
	};
}

/**
 * True when a comparison of two engines passes: under three.js's limit, or no worse than three.js's
 * own two renderers differ on the same frame (the baseline). Rasterizers disagree on edges and on
 * objects one or two pixels wide, and three.js's rule counts every such pixel. An engine that
 * matches three.js as closely as three.js's renderers match each other draws the same scene.
 */
export function passesWithBaseline(share: number, baselineShare: number | null): boolean {
	return share * 100 < MAX_DIFFERENT_PERCENT || (baselineShare !== null && share <= baselineShare);
}

/** A share of pixels as a percentage with three decimals, such as `0.042%`. */
export function percent(share: number): string {
	return `${(share * 100).toFixed(3)}%`;
}

/** An image in any channel layout (gray, gray and alpha, RGB, RGBA) as RGBA8. */
export function toRgba(image: {
	width: number;
	height: number;
	channels: number;
	data: ArrayLike<number>;
}): RgbaImage {
	const { width, height, channels, data } = image;
	const out = new Uint8Array(width * height * BYTES_PER_PIXEL);
	for (let p = 0; p < width * height; p++) {
		const at = p * channels;
		const gray = channels < 3;
		out[p * 4] = data[at] as number;
		out[p * 4 + 1] = data[gray ? at : at + 1] as number;
		out[p * 4 + 2] = data[gray ? at : at + 2] as number;
		out[p * 4 + 3] =
			channels === 2 || channels === 4 ? (data[at + channels - 1] as number) : OPAQUE;
	}
	return { width, height, data: out };
}
