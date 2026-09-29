// The scale search: the largest count at which three.js still holds a frame rate on a device, for
// one scene on one GPU path. Each scene's auto-slide table for a device class starts near half of
// it (src/scenes/index.ts). The search tries one count at a time: it doubles the count until
// three.js drops below the rate, then narrows the gap between the count that held and the one that
// dropped. Adapted from the null3D engine's phone-scale search (tests/lib/scale.ts at commit
// 51fb3c3), which held 30 frames per second; here the rate is the display rate unless given.

import { SCENES, type SceneId } from '../../src/scenes/index';
import { HOLD_SHARE } from '../../src/shell/ramp';
import type { BenchResult } from '../../src/shell/result';
import { countRange } from '../../src/shell/slider';

/** The warm-up is the page's own 5 s; this is the measured time at each count. */
export const SCALE_SECONDS = 5;
/**
 * The search ends when the count that dropped is at most 5% above the count that held, or when no
 * count of two significant figures lies between them.
 */
const PRECISION = 1.05;
/**
 * The growth per second of a suggested auto-slide: 2 to the power 1/8. From half of three.js's
 * limit, the count passes the limit at second 8 and reaches 2.8 times it at second 20.
 */
export const SUGGESTED_FACTOR = 1.09;

/** What a search knows: the largest count that held the rate, and the smallest that dropped. */
export interface ScaleSearch {
	held: number;
	dropped: number | null;
}

export const NEW_SEARCH: ScaleSearch = { held: 0, dropped: null };

/** The counts a search may try: its first count, and the lowest and highest. */
export interface CountBounds {
	first: number;
	min: number;
	max: number;
}

/**
 * A scene's bounds: from the phone's start count, the smallest, up to the scene's maximum. The
 * page keeps a count within its device class's slider range, so the search narrows these to the
 * counts a page reports it drew (see `afterCount`).
 */
export function scaleBounds(scene: SceneId): CountBounds {
	const phone = SCENES[scene].ramp.phone;
	return { first: phone.start, min: countRange(phone).min, max: SCENES[scene].maxCount };
}

/** A count to two significant figures, so the counts read easily. */
export function roundCount(count: number): number {
	const step = 10 ** Math.max(0, Math.floor(Math.log10(count)) - 1);
	return Math.round(count / step) * step;
}

/**
 * The next count to try, or null when the search is done. It doubles the count until one drops,
 * halves it when the first count already drops, and then halves the gap in proportion.
 */
export function nextCount({ held, dropped }: ScaleSearch, bounds: CountBounds): number | null {
	if (dropped === null) {
		if (held >= bounds.max) return null;
		return held === 0 ? bounds.first : Math.min(held * 2, bounds.max);
	}
	if (held === 0) {
		const next = roundCount(dropped / 2);
		return next >= bounds.min && next < dropped ? next : null;
	}
	if (dropped <= held * PRECISION) return null;
	const next = roundCount(Math.sqrt(held * dropped));
	return next > held && next < dropped ? next : null;
}

/**
 * The search and its bounds after a page drew `drawn` when asked for `asked`. A page that drew
 * fewer than asked stopped at its device class's highest count, and one that drew more at its
 * lowest, so the bounds narrow to them.
 */
export function afterCount(
	search: ScaleSearch,
	bounds: CountBounds,
	asked: number,
	drawn: number,
	held: boolean,
): { search: ScaleSearch; bounds: CountBounds } {
	const narrowed = {
		...bounds,
		max: drawn < asked ? Math.min(bounds.max, drawn) : bounds.max,
		min: drawn > asked ? Math.max(bounds.min, drawn) : bounds.min,
	};
	const next = held
		? { ...search, held: Math.max(search.held, drawn) }
		: { ...search, dropped: search.dropped === null ? drawn : Math.min(search.dropped, drawn) };
	return { search: next, bounds: narrowed };
}

/** The frame rate a page must hold: the given rate, or else the display rate it measured. */
export function holdRate(result: BenchResult, holdFps: number | null): number {
	return holdFps ?? result.displayHz;
}

/** Whether a page held the rate, by the auto-slide's rule: within 5% of it. */
export function holdsRate(result: BenchResult, holdFps: number | null): boolean {
	return result.measurement.fps >= HOLD_SHARE * holdRate(result, holdFps);
}

/** An auto-slide row that starts at half the count three.js held. */
export function suggestedRamp(held: number): { start: number; factor: number } {
	return { start: roundCount(Math.max(1, held / 2)), factor: SUGGESTED_FACTOR };
}
