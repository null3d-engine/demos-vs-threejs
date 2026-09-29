// The count slider moves on a log scale, so every tenfold step of the count takes the same length.

/** The slider's number of positions. */
export const SLIDER_STEPS = 1000;

/** The count at a slider position, between `min` and `max`. */
export function sliderToCount(position: number, min: number, max: number): number {
	const t = Math.min(1, Math.max(0, position / SLIDER_STEPS));
	return Math.round(Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min))));
}

/** The slider position that shows a count. */
export function countToSlider(count: number, min: number, max: number): number {
	const clamped = Math.min(max, Math.max(min, count));
	return Math.round(
		((Math.log(clamped) - Math.log(min)) / (Math.log(max) - Math.log(min))) * SLIDER_STEPS,
	);
}

/** Groups a whole number's digits: 61917 becomes "61,917". */
export function formatCount(value: number): string {
	return Math.round(value).toLocaleString('en-US');
}

/** A short form for large numbers: 3,100,000 becomes "3.1M". */
export function formatShort(value: number): string {
	if (value >= 1e9) return `${(value / 1e9).toFixed(1)}G`;
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
	if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
	return formatCount(value);
}

/** Bytes in megabytes, rounded. */
export function formatMegabytes(bytes: number): string {
	return `${formatCount(bytes / (1024 * 1024))} MB`;
}
