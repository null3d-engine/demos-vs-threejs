import { describe, expect, test } from 'bun:test';
import { DEVICE_CLASSES } from '../scenes/device';
import { SCENE_IDS, SCENES } from '../scenes/index';
import {
	GAP_SECONDS,
	isMeasuring,
	RampTracker,
	rampCount,
	rampStep,
	STOP_FPS,
	type StepResult,
	secondsToReach,
} from './ramp';

/** null3D draws at most this many objects and instance rows on devices with WebGPU's default limits. */
const NULL3D_PORTABLE_LIMIT = 2_097_152;

const factoryDesktop = SCENES.factory.ramp.desktop;

function step(step: number, count: number, fps: number): StepResult {
	return { step, count, fps, frameMs: 1000 / fps, frameMsP95: 1000 / fps, cpuMs: null };
}

describe('ramp schedule', () => {
	test('the factory on desktop starts at 10,000 moving parts and grows by 20% a second', () => {
		expect(rampCount(factoryDesktop, 0)).toBe(10_000);
		expect(rampCount(factoryDesktop, 0.99)).toBe(10_000);
		expect(rampCount(factoryDesktop, 1)).toBe(12_000);
		expect(rampCount(factoryDesktop, 10)).toBe(61_917);
		expect(rampCount(factoryDesktop, 20)).toBe(383_376);
	});

	test('the count stops at the maximum', () => {
		expect(rampCount(factoryDesktop, 1_000)).toBe(factoryDesktop.max);
	});

	test('each step measures after its settle time', () => {
		expect(rampStep(4.5)).toBe(4);
		expect(isMeasuring(4.1)).toBe(false);
		expect(isMeasuring(4.35)).toBe(true);
	});

	test('secondsToReach finds the first second at a count', () => {
		expect(secondsToReach(factoryDesktop, 10_000)).toBe(0);
		expect(secondsToReach(factoryDesktop, 12_000)).toBe(1);
		expect(secondsToReach(factoryDesktop, 100_000)).toBe(13);
		expect(secondsToReach(factoryDesktop, factoryDesktop.max + 1)).toBeNull();
	});
});

describe('ramp tables', () => {
	test('every row grows at least 1.09 times a second, so the gap shows by second 20', () => {
		for (const id of SCENE_IDS) {
			for (const cls of DEVICE_CLASSES) {
				const plan = SCENES[id].ramp[cls];
				expect(plan.factor).toBeGreaterThanOrEqual(1.09);
				expect(plan.start).toBeGreaterThan(0);
				expect(plan.start).toBeLessThan(plan.max);
				expect(plan.max).toBeLessThanOrEqual(SCENES[id].maxCount);
				// From the start near half of three.js's limit to about 2.8 times that limit by second 20.
				expect(rampCount(plan, GAP_SECONDS) / plan.start).toBeGreaterThanOrEqual(5.6);
			}
		}
	});

	test("every scene's maximum fits null3D's portable object limit", () => {
		for (const id of SCENE_IDS) {
			expect(SCENES[id].objectsAt(SCENES[id].maxCount)).toBeLessThanOrEqual(NULL3D_PORTABLE_LIMIT);
		}
	});
});

describe('RampTracker', () => {
	test('records the highest counts held at the display rate and at half of it', () => {
		const tracker = new RampTracker(factoryDesktop, 120, STOP_FPS.desktop);
		tracker.add(step(0, 10_000, 120));
		tracker.add(step(1, 12_000, 115));
		tracker.add(step(2, 14_400, 90));
		tracker.add(step(3, 17_280, 50));
		expect(tracker.heldAtDisplayRate).toBe(12_000);
		expect(tracker.heldAtHalfRate).toBe(14_400);
		expect(tracker.stopReason).toBeNull();
	});

	test('stops when the rate stays under the floor for three steps', () => {
		const tracker = new RampTracker(factoryDesktop, 120, 20);
		expect(tracker.add(step(5, 50_000, 19))).toBeNull();
		expect(tracker.add(step(6, 60_000, 25))).toBeNull();
		expect(tracker.add(step(7, 70_000, 18))).toBeNull();
		expect(tracker.add(step(8, 80_000, 17))).toBeNull();
		expect(tracker.add(step(9, 90_000, 16))).toBe('too-slow');
		expect(tracker.add(step(10, 99_000, 120))).toBe('too-slow');
		expect(tracker.steps).toHaveLength(5);
	});

	test('after the gap second, stops when the display rate is lost for three steps', () => {
		const tracker = new RampTracker(factoryDesktop, 120, 20);
		// Before second 20, a lost display rate does not stop the ramp.
		for (let s = 15; s < 20; s++) expect(tracker.add(step(s, 100_000 + s, 80))).toBeNull();
		expect(tracker.add(step(20, 200_000, 80))).toBeNull();
		expect(tracker.add(step(21, 210_000, 80))).toBeNull();
		expect(tracker.add(step(22, 220_000, 80))).toBe('below-display-rate');
	});

	test('stops after three steps at the maximum', () => {
		const tracker = new RampTracker(factoryDesktop, 60, 20);
		const max = factoryDesktop.max;
		expect(tracker.add(step(30, max, 60))).toBeNull();
		expect(tracker.add(step(31, max, 60))).toBeNull();
		expect(tracker.add(step(32, max, 60))).toBe('maximum');
	});
});
