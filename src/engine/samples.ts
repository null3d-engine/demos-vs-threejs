// Per-frame samples in fixed rings, so recording a frame allocates nothing. The engine side of each
// adapter records every frame here and summarizes a stretch when the page asks.

import { percentiles, ratePerSecond } from '../measure/stats';

/** The most frames a ring keeps: over 30 seconds at 240 frames per second. */
const CAPACITY = 8192;

export interface SampleSummary {
	frames: number;
	fps: number;
	/** Median and 95th percentile of each figure. */
	frameMs: [number, number];
	cpuMs: [number, number];
	logicMs: [number, number];
	/** Null when no GPU time was measured in the stretch. */
	gpuMs: [number, number] | null;
}

export class FrameSamples {
	private readonly time = new Float64Array(CAPACITY);
	private readonly interval = new Float64Array(CAPACITY);
	private readonly cpu = new Float64Array(CAPACITY);
	private readonly logic = new Float64Array(CAPACITY);
	private next = 0;
	private size = 0;
	private readonly gpuTime = new Float64Array(CAPACITY);
	private readonly gpu = new Float64Array(CAPACITY);
	private gpuNext = 0;
	private gpuSize = 0;

	/**
	 * Records one drawn frame: its timestamp, the time since the last frame, its CPU time, and the
	 * part of that time the shared scene logic took.
	 */
	record(timestampMs: number, intervalMs: number, cpuMs: number, logicMs: number): void {
		this.time[this.next] = timestampMs;
		this.interval[this.next] = intervalMs;
		this.cpu[this.next] = cpuMs;
		this.logic[this.next] = logicMs;
		this.next = (this.next + 1) % CAPACITY;
		if (this.size < CAPACITY) this.size++;
	}

	/** Records a frame's GPU time, which arrives later than the frame. */
	recordGpu(timestampMs: number, gpuMs: number): void {
		this.gpuTime[this.gpuNext] = timestampMs;
		this.gpu[this.gpuNext] = gpuMs;
		this.gpuNext = (this.gpuNext + 1) % CAPACITY;
		if (this.gpuSize < CAPACITY) this.gpuSize++;
	}

	/**
	 * Summarizes the frames recorded at or after `sinceMs`: frames per second from their
	 * intervals, and the median and 95th percentile of each figure. Allocates: call it a few times
	 * a second at most.
	 */
	summarize(sinceMs: number): SampleSummary {
		const intervals: number[] = [];
		const cpu: number[] = [];
		const logic: number[] = [];
		for (let k = 1; k <= this.size; k++) {
			const i = (this.next - k + CAPACITY) % CAPACITY;
			if ((this.time[i] as number) < sinceMs) break;
			intervals.push(this.interval[i] as number);
			cpu.push(this.cpu[i] as number);
			logic.push(this.logic[i] as number);
		}
		const gpu: number[] = [];
		for (let k = 1; k <= this.gpuSize; k++) {
			const i = (this.gpuNext - k + CAPACITY) % CAPACITY;
			if ((this.gpuTime[i] as number) < sinceMs) break;
			gpu.push(this.gpu[i] as number);
		}
		const frame = percentiles(intervals);
		const work = percentiles(cpu);
		const scene = percentiles(logic);
		const draw = percentiles(gpu);
		return {
			frames: intervals.length,
			fps: ratePerSecond(intervals) ?? 0,
			frameMs: [frame.median, frame.p95],
			cpuMs: [work.median, work.p95],
			logicMs: [scene.median, scene.p95],
			gpuMs: gpu.length > 0 ? [draw.median, draw.p95] : null,
		};
	}
}
