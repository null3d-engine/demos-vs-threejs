import { describe, expect, test } from 'bun:test';
import type { Measurement } from '../../src/engine/protocol';
import type { BenchResult } from '../../src/shell/result';
import {
	benchPlan,
	benchReport,
	median,
	parseBenchArgs,
	runName,
	summarizePage,
} from './bench-plan';

const NOW = new Date('2026-09-29T17:20:26.000Z');

describe('bench options', () => {
	test('default to every scene on both GPU paths, five runs of 30 s, on this machine’s GPU', () => {
		const options = parseBenchArgs([], NOW);
		expect(options).toMatchObject({
			scenes: ['factory', 'city', 'battle'],
			gpus: ['webgpu', 'webgl2'],
			counts: null,
			runs: 5,
			seconds: 30,
			auto: false,
			gpuTime: false,
			gpu: 'hardware',
			out: 'runs/bench/20260929-172026-bench',
		});
	});

	test('read each option', () => {
		const options = parseBenchArgs(
			[
				'--',
				'--scenes',
				'city',
				'--gpus',
				'webgl2',
				'--counts',
				'100,400',
				'--runs',
				'3',
				'--seconds',
				'2',
				'--gpu-time',
				'--gpu',
				'software',
			],
			NOW,
		);
		expect(options).toMatchObject({
			scenes: ['city'],
			gpus: ['webgl2'],
			counts: [100, 400],
			runs: 3,
			seconds: 2,
			gpuTime: true,
			gpu: 'software',
		});
	});

	test('refuse bad values', () => {
		expect(() => parseBenchArgs(['--gpus', 'metal'])).toThrow('webgpu and webgl2');
		expect(() => parseBenchArgs(['--runs', '0'])).toThrow('above 0');
		expect(() => parseBenchArgs(['--scenes', 'ocean'])).toThrow('not a scene');
	});

	test('name a run folder by its start time', () => {
		expect(runName('bench', NOW)).toBe('20260929-172026-bench');
	});
});

describe('bench plan', () => {
	test('runs every page once before any page runs again', () => {
		const plan = benchPlan(
			parseBenchArgs(['--scenes', 'city', '--counts', '100,400', '--runs', '2'], NOW),
		);
		expect(plan.map((item) => item.id)).toEqual([
			'city-webgpu-100-run1',
			'city-webgpu-400-run1',
			'city-webgl2-100-run1',
			'city-webgl2-400-run1',
			'city-webgpu-100-run2',
			'city-webgpu-400-run2',
			'city-webgl2-100-run2',
			'city-webgl2-400-run2',
		]);
		expect(plan[0]?.path).toBe('/?scene=city&gpu=webgpu&count=100&bench=30');
	});

	test('uses the scene’s auto-slide start count, and adds GPU-time runs last', () => {
		const plan = benchPlan(
			parseBenchArgs(['--scenes', 'battle', '--gpus', 'webgpu', '--runs', '1', '--gpu-time'], NOW),
		);
		expect(plan.map((item) => item.id)).toEqual([
			'battle-webgpu-500-run1',
			'battle-webgpu-500-gpu-time',
		]);
		expect(plan[1]?.path).toContain('gputime=1');
	});

	test('an auto-slide plan runs the auto-slide page', () => {
		const plan = benchPlan(
			parseBenchArgs(['--scenes', 'factory', '--gpus', 'webgl2', '--runs', '1', '--auto'], NOW),
		);
		expect(plan).toHaveLength(1);
		expect(plan[0]?.path).toBe('/?scene=factory&gpu=webgl2&auto=1');
		expect(plan[0]?.count).toBeNull();
	});
});

function measurement(cpu: number, logic: number, gpu: number | null = null): Measurement {
	return {
		frames: 3600,
		fps: 120,
		frameMsMedian: 8.3,
		frameMsP95: 9,
		cpuMsMedian: cpu,
		cpuMsP95: cpu + 1,
		logicMsMedian: logic,
		logicMsP95: logic,
		gpuMsMedian: gpu,
		gpuMsP95: gpu,
		drawCalls: 43,
		objects: 63_001,
		triangles: 876_000,
		count: 1000,
	};
}

function result(m: Measurement): BenchResult {
	return {
		ok: true,
		kind: 'bench',
		scene: 'city',
		engine: 'threejs',
		engineVersion: 'three.js 0.186.1',
		gpu: 'webgpu',
		renderer: 'WebGPURenderer',
		inWorker: true,
		deviceClass: 'desktop',
		displayHz: 120,
		count: 1000,
		effects: 'fog,glow',
		crowd: 'draw',
		gpuTime: m.gpuMsMedian !== null,
		warmupSeconds: 5,
		seconds: 30,
		measurement: m,
		userAgent: 'test',
	};
}

describe('bench summary', () => {
	test('the median of an even count is the mean of the middle two', () => {
		expect(median([4, 1, 3, 2])).toBe(2.5);
		expect(median([5, 1, 3])).toBe(3);
	});

	test('takes the median of the runs, the lowest and highest run, and splits off the scene logic', () => {
		const [item] = benchPlan(
			parseBenchArgs(
				['--scenes', 'city', '--gpus', 'webgpu', '--counts', '1000', '--runs', '3'],
				NOW,
			),
		);
		const summary = summarizePage(
			item as NonNullable<typeof item>,
			[result(measurement(5, 1)), result(measurement(7, 1)), result(measurement(6, 2))],
			result(measurement(6.5, 1, 3.2)),
		);
		expect(summary).toMatchObject({
			runs: 3,
			cpuMs: { median: 6, min: 5, max: 7 },
			logicMs: 1,
			// Each run's own work (4, 6 and 4 ms), then the median: not 6 - 1.
			engineMs: 4,
			gpuMs: 3.2,
			renderer: 'WebGPURenderer',
			drawCalls: 43,
		});
		const report = benchReport(
			[summary as NonNullable<typeof summary>],
			parseBenchArgs([], NOW),
			[],
		);
		expect(report).toContain(
			'| city | webgpu | WebGPURenderer | 1,000 | 3 | 120.0 | 8.30 | 6.00 (5.00 to 7.00) |',
		);
	});
});
