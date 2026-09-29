// Per-frame samples in fixed rings, so recording a frame allocates nothing. The engine side of each
// adapter records every frame here and summarizes a stretch when the page asks.

import { percentiles, ratePerSecond } from '../measure/stats';

/** The most frames a ring keeps: over 8 seconds at 120 frames per second. */
const CAPACITY = 1024;

export class FrameSamples {
	private readonly time = new Float64Array(CAPACITY);
	private readonly interval = new Float64Array(CAPACITY);
	private readonly cpu = new Float64Array(CAPACITY);
	private next = 0;
	private size = 0;

	/** Records one drawn frame: its timestamp, the time since the last frame and its CPU time. */
	record(timestampMs: number, intervalMs: number, cpuMs: number): void {
		this.time[this.next] = timestampMs;
		this.interval[this.next] = intervalMs;
		this.cpu[this.next] = cpuMs;
		this.next = (this.next + 1) % CAPACITY;
		if (this.size < CAPACITY) this.size++;
	}

	/**
	 * Summarizes the frames recorded at or after `sinceMs`: frames per second from their
	 * intervals, and the median and 95th percentile of frame and CPU times. Allocates: call it a
	 * few times a second at most.
	 */
	summarize(sinceMs: number): { frames: number; fps: number; frameMs: number[]; cpuMs: number[] } {
		const intervals: number[] = [];
		const cpu: number[] = [];
		for (let k = 1; k <= this.size; k++) {
			const i = (this.next - k + CAPACITY) % CAPACITY;
			if ((this.time[i] as number) < sinceMs) break;
			intervals.push(this.interval[i] as number);
			cpu.push(this.cpu[i] as number);
		}
		const frame = percentiles(intervals);
		const work = percentiles(cpu);
		return {
			frames: intervals.length,
			fps: ratePerSecond(intervals) ?? 0,
			frameMs: [frame.median, frame.p95],
			cpuMs: [work.median, work.p95],
		};
	}
}
