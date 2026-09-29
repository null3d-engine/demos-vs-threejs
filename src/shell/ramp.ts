// The auto-slide: it raises the count once a second by a fixed factor, so the gap between the
// engines shows within 20 seconds. The schedule follows the wall clock, so both engines reach the
// same count at the same second and their recordings line up.

import type { DeviceClass } from '../scenes/device';
import type { RampPlan } from '../scenes/index';

/** Seconds per step: the count changes once per step. */
export const STEP_SECONDS = 1;
/** Seconds at the start of each step that the measurement skips, while the new count settles. */
export const SETTLE_SECONDS = 0.3;
/** The gap should be plain by this second of the ramp. */
export const GAP_SECONDS = 20;
/** Consecutive steps a stop condition must hold. */
export const STOP_STEPS = 3;
/** A frame rate at or above this share of the display rate counts as holding the display rate. */
export const HOLD_SHARE = 0.95;

/** The frame rate under which the ramp stops, per device class. */
export const STOP_FPS: Readonly<Record<DeviceClass, number>> = {
	desktop: 20,
	tablet: 15,
	phone: 15,
};

/** The step at a ramp time. */
export function rampStep(elapsedSeconds: number): number {
	return Math.max(0, Math.floor(elapsedSeconds / STEP_SECONDS));
}

/** The count at a ramp time. */
export function rampCount(plan: RampPlan, elapsedSeconds: number): number {
	const count = plan.start * plan.factor ** rampStep(elapsedSeconds);
	return Math.min(plan.max, Math.round(count));
}

/** True during the part of a step that is measured, after the new count has settled. */
export function isMeasuring(elapsedSeconds: number): boolean {
	const within = elapsedSeconds - rampStep(elapsedSeconds) * STEP_SECONDS;
	return within >= SETTLE_SECONDS;
}

/** The first ramp second at which the count reaches `count`, or null when it never does. */
export function secondsToReach(plan: RampPlan, count: number): number | null {
	if (count <= plan.start) return 0;
	if (count > plan.max) return null;
	return Math.ceil(Math.log(count / plan.start) / Math.log(plan.factor) - 1e-9) * STEP_SECONDS;
}

export type StopReason = 'below-display-rate' | 'too-slow' | 'maximum';

/** One measured step of the ramp. */
export interface StepResult {
	step: number;
	count: number;
	/** Frames drawn per second during the measured part of the step. */
	fps: number;
	/** Median frame time in milliseconds. */
	frameMs: number;
	/** 95th percentile frame time in milliseconds. */
	frameMsP95: number;
	/** CPU milliseconds per frame on the busiest thread, where known. */
	cpuMs: number | null;
	/** The part of the CPU time that the shared scene logic took, where known. */
	logicMs?: number | null;
	/** GPU milliseconds per frame, where measured. */
	gpuMs?: number | null;
}

/**
 * Follows the measured steps of one engine's ramp: when to stop, and the highest counts held at
 * the display rate and at half of it.
 */
export class RampTracker {
	readonly steps: StepResult[] = [];
	/** The highest count measured at or above HOLD_SHARE of the display rate. */
	heldAtDisplayRate = 0;
	/** The highest count measured at or above HOLD_SHARE of half the display rate. */
	heldAtHalfRate = 0;
	stopReason: StopReason | null = null;
	private belowDisplay = 0;
	private tooSlow = 0;
	private atMaximum = 0;

	constructor(
		private readonly plan: RampPlan,
		private readonly displayHz: number,
		private readonly stopFps: number,
	) {}

	/** Adds a measured step. Returns the reason to stop, or null to go on. */
	add(result: StepResult): StopReason | null {
		if (this.stopReason) return this.stopReason;
		this.steps.push(result);
		const holdsDisplay = result.fps >= HOLD_SHARE * this.displayHz;
		if (holdsDisplay) this.heldAtDisplayRate = Math.max(this.heldAtDisplayRate, result.count);
		if (result.fps >= HOLD_SHARE * (this.displayHz / 2))
			this.heldAtHalfRate = Math.max(this.heldAtHalfRate, result.count);
		const pastGap = result.step * STEP_SECONDS >= GAP_SECONDS;
		this.belowDisplay = pastGap && !holdsDisplay ? this.belowDisplay + 1 : 0;
		this.tooSlow = result.fps < this.stopFps ? this.tooSlow + 1 : 0;
		this.atMaximum = result.count >= this.plan.max ? this.atMaximum + 1 : 0;
		if (this.tooSlow >= STOP_STEPS) this.stopReason = 'too-slow';
		else if (this.belowDisplay >= STOP_STEPS) this.stopReason = 'below-display-rate';
		else if (this.atMaximum >= STOP_STEPS) this.stopReason = 'maximum';
		return this.stopReason;
	}
}
