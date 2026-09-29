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

/** The part of a ramp plan that sets the slider's range. */
export interface CountPlan {
	readonly start: number;
	readonly max: number;
}

/** The slider's range: a tenth of the ramp's start count up to its maximum. */
export function countRange(plan: CountPlan): { min: number; max: number } {
	return { min: Math.max(1, Math.round(plan.start / 10)), max: plan.max };
}

/**
 * The count a scene starts with: the page address's `count` option when it is a whole number, kept
 * inside the slider's range; else the ramp's start count.
 */
export function startCount(option: string | null, plan: CountPlan): number {
	const asked = option === null || option.trim() === '' ? Number.NaN : Number(option);
	if (!Number.isInteger(asked)) return plan.start;
	const { min, max } = countRange(plan);
	return Math.min(max, Math.max(min, asked));
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
