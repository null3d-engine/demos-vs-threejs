// What `bun run bench` measures, in what order, and how it sums up. Pure: tools/bench.ts runs it.
// The protocol follows the null3D engine's benchmark (bench/run.ts at commit 51fb3c3): each page
// runs five times, each run in a fresh tab, a 5 s warm-up then 30 s measured, and a summary takes
// the median of the runs' medians with the lowest and highest run.

import type { Measurement } from '../../src/engine/protocol';
import { SCENES, type SceneId } from '../../src/scenes/index';
import type { AutoResult, BenchResult, DemoResult } from '../../src/shell/result';
import { THREE_SCENES } from '../../src/threejs/scenes';

export type BenchGpu = 'webgpu' | 'webgl2';

export interface BenchOptions {
	scenes: SceneId[];
	gpus: BenchGpu[];
	/** Counts for every scene; null uses each scene's desktop auto-slide start count. */
	counts: number[] | null;
	runs: number;
	/** Measured seconds per run, after the page's 5 s warm-up. */
	seconds: number;
	/** Run the whole auto-slide instead of fixed counts. */
	auto: boolean;
	/** Add one run per page that measures GPU time with timestamp queries. */
	gpuTime: boolean;
	out: string;
	url: string | null;
	gpu: 'software' | 'hardware';
	chrome: string | null;
}

export const BENCH_USAGE = `Usage: bun run bench [options]

Measures each scene with three.js at fixed counts (or with the auto-slide) in a fresh tab per run,
and writes each run's result and a summary to runs/bench/<time>-bench.

Options:
  --scenes <list>     Scenes, separated by commas (default: ${THREE_SCENES.join(',')})
  --gpus <list>       GPU paths: webgpu, webgl2 (default: both)
  --counts <list>     Counts for every scene (default: each scene's auto-slide start count)
  --runs <n>          Runs per page (default: 5)
  --seconds <n>       Measured seconds per run, after a 5 s warm-up (default: 30)
  --auto              Run the auto-slide instead of fixed counts
  --gpu-time          Add one run per page that measures GPU time (timestamp queries)
  --out <folder>      Where the files go (default: runs/bench/<time>-bench)
  --url <address>     Measure a published site instead of building this checkout
  --gpu <kind>        hardware (this machine's GPU in Google Chrome, the default) or software
  --chrome <path>     Run this Chrome or Chromium instead
  --help              Show this text`;

function positive(name: string, text: string): number {
	const value = Number(text);
	if (!Number.isFinite(value) || value <= 0)
		throw new Error(`${name} takes a number above 0, not "${text}".`);
	return value;
}

/** A run folder's name from the time it starts, such as `20260929-172026-bench`. */
export function runName(kind: string, now = new Date()): string {
	const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
	return `${stamp}-${kind}`.toLowerCase();
}

export function parseBenchArgs(args: readonly string[], now = new Date()): BenchOptions {
	const options: BenchOptions = {
		scenes: [...THREE_SCENES],
		gpus: ['webgpu', 'webgl2'],
		counts: null,
		runs: 5,
		seconds: 30,
		auto: false,
		gpuTime: false,
		out: `runs/bench/${runName('bench', now)}`,
		url: null,
		gpu: 'hardware',
		chrome: null,
	};
	for (let i = 0; i < args.length; i++) {
		const name = args[i] as string;
		const value = () => {
			const next = args[++i];
			if (next === undefined || next.startsWith('--'))
				throw new Error(`${name} needs a value.\n\n${BENCH_USAGE}`);
			return next;
		};
		switch (name) {
			case '--':
				break;
			case '--scenes': {
				const scenes = value()
					.split(',')
					.map((scene) => scene.trim());
				for (const scene of scenes)
					if (!(THREE_SCENES as readonly string[]).includes(scene))
						throw new Error(`"${scene}" is not a scene with a three.js version.`);
				options.scenes = scenes as SceneId[];
				break;
			}
			case '--gpus': {
				const gpus = value()
					.split(',')
					.map((gpu) => gpu.trim());
				for (const gpu of gpus)
					if (gpu !== 'webgpu' && gpu !== 'webgl2')
						throw new Error(`--gpus takes webgpu and webgl2, not "${gpu}".`);
				options.gpus = gpus as BenchGpu[];
				break;
			}
			case '--counts':
				options.counts = value()
					.split(',')
					.map((count) => Math.round(positive('--counts', count)));
				break;
			case '--runs':
				options.runs = Math.round(positive('--runs', value()));
				break;
			case '--seconds':
				options.seconds = positive('--seconds', value());
				break;
			case '--auto':
				options.auto = true;
				break;
			case '--gpu-time':
				options.gpuTime = true;
				break;
			case '--out':
				options.out = value();
				break;
			case '--url':
				options.url = value().replace(/\/+$/, '');
				break;
			case '--gpu': {
				const gpu = value();
				if (gpu !== 'software' && gpu !== 'hardware')
					throw new Error(`--gpu takes software or hardware, not "${gpu}".`);
				options.gpu = gpu;
				break;
			}
			case '--chrome':
				options.chrome = value();
				break;
			case '--help':
				throw new Error(BENCH_USAGE);
			default:
				throw new Error(`Unknown option "${name}".\n\n${BENCH_USAGE}`);
		}
	}
	return options;
}

/** One page run of the plan. */
export interface BenchItem {
	/** A name for the item's result file, such as `city-webgpu-1000-run2`. */
	id: string;
	/** The page (scene, GPU path, count) the item measures; runs of it share this key. */
	key: string;
	scene: SceneId;
	gpu: BenchGpu;
	/** The count, or null for an auto-slide. */
	count: number | null;
	run: number;
	gpuTime: boolean;
	path: string;
	/** How long the page may take, in milliseconds. */
	timeoutMs: number;
}

const WARMUP_SECONDS = 5;

/**
 * The runs in order. Run 1 of every page comes before run 2 of any, so a device that warms up
 * slows every page alike. A GPU-time run of each page comes last.
 */
export function benchPlan(options: BenchOptions): BenchItem[] {
	const pages: { scene: SceneId; gpu: BenchGpu; count: number | null }[] = [];
	for (const scene of options.scenes)
		for (const gpu of options.gpus)
			for (const count of options.auto
				? [null]
				: (options.counts ?? [SCENES[scene].ramp.desktop.start]))
				pages.push({ scene, gpu, count });
	const item = (page: (typeof pages)[number], run: number, gpuTime: boolean): BenchItem => {
		const key = `${page.scene}-${page.gpu}-${page.count ?? 'auto'}`;
		const params = new URLSearchParams({ scene: page.scene, gpu: page.gpu });
		if (page.count !== null) {
			params.set('count', String(page.count));
			params.set('bench', String(options.seconds));
		} else {
			params.set('auto', '1');
		}
		if (gpuTime) params.set('gputime', '1');
		const seconds = page.count === null ? 120 : options.seconds;
		return {
			id: `${key}-${gpuTime ? 'gpu-time' : `run${run}`}`,
			key,
			...page,
			run,
			gpuTime,
			path: `/?${params}`,
			timeoutMs: (WARMUP_SECONDS + seconds) * 1000 + 90_000,
		};
	};
	const items: BenchItem[] = [];
	for (let run = 1; run <= options.runs; run++)
		for (const page of pages) items.push(item(page, run, false));
	if (options.gpuTime) for (const page of pages) items.push(item(page, 0, true));
	return items;
}

export function median(values: readonly number[]): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** One page's runs summed up: medians of the runs' medians, with the lowest and highest run. */
export interface PageSummary {
	key: string;
	scene: SceneId;
	gpu: BenchGpu;
	count: number | null;
	renderer: string;
	runs: number;
	fps: number;
	frameMs: number;
	cpuMs: { median: number; min: number; max: number };
	cpuP95Ms: number;
	logicMs: number;
	/** CPU time minus the shared scene logic: the engine's own work. */
	engineMs: number;
	/** From the GPU-time run, or null. */
	gpuMs: number | null;
	drawCalls: number;
	objects: number;
	triangles: number;
	/** Auto-slide runs: the highest counts held at the display rate and at half of it. */
	heldAtDisplayRate?: number;
	heldAtHalfRate?: number;
}

export function summarizePage(
	item: BenchItem,
	results: readonly (BenchResult | AutoResult)[],
	gpuRun: BenchResult | null,
): PageSummary | null {
	const bench = results.filter((result): result is BenchResult => result.kind === 'bench');
	const auto = results.filter((result): result is AutoResult => result.kind === 'auto');
	const first = bench[0] ?? null;
	const measurements: Measurement[] = bench.map((result) => result.measurement);
	if (measurements.length === 0 && auto.length === 0) return null;
	const cpu = measurements.map((m) => m.cpuMsMedian);
	const summary: PageSummary = {
		key: item.key,
		scene: item.scene,
		gpu: item.gpu,
		count: item.count,
		renderer: first?.renderer ?? auto[0]?.run.renderer ?? '',
		runs: results.length,
		fps: median(measurements.map((m) => m.fps)),
		frameMs: median(measurements.map((m) => m.frameMsMedian)),
		cpuMs: { median: median(cpu), min: Math.min(...cpu), max: Math.max(...cpu) },
		cpuP95Ms: median(measurements.map((m) => m.cpuMsP95)),
		logicMs: median(measurements.map((m) => m.logicMsMedian)),
		engineMs: median(measurements.map((m) => m.cpuMsMedian - m.logicMsMedian)),
		gpuMs: gpuRun?.measurement.gpuMsMedian ?? null,
		drawCalls: median(measurements.map((m) => m.drawCalls)),
		objects: first?.measurement.objects ?? 0,
		triangles: first?.measurement.triangles ?? 0,
	};
	if (auto.length > 0) {
		summary.heldAtDisplayRate = median(auto.map((result) => result.run.heldAtDisplayRate));
		summary.heldAtHalfRate = median(auto.map((result) => result.run.heldAtHalfRate));
	}
	return summary;
}

const ms = (value: number | null) =>
	value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(2);
const whole = (value: number) =>
	Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : 'n/a';

/** Sums up a plan's results page by page, and lists the runs that failed. */
export function summarizePlan(
	plan: readonly BenchItem[],
	resultOf: (id: string) => DemoResult | undefined,
): { pages: PageSummary[]; failed: string[] } {
	const pages: PageSummary[] = [];
	const failed: string[] = [];
	for (const key of new Set(plan.map((item) => item.key))) {
		const items = plan.filter((item) => item.key === key);
		const measured = items
			.filter((item) => !item.gpuTime)
			.map((item) => resultOf(item.id))
			.filter((result): result is BenchResult | AutoResult => result?.ok === true);
		const gpuItem = items.find((item) => item.gpuTime);
		const gpuResult = gpuItem ? resultOf(gpuItem.id) : undefined;
		for (const item of items) {
			const result = resultOf(item.id);
			if (result && !result.ok) failed.push(`${item.id}: ${result.error}`);
		}
		const summary = summarizePage(
			items[0] as BenchItem,
			measured,
			gpuResult?.ok && gpuResult.kind === 'bench' ? gpuResult : null,
		);
		if (summary) pages.push(summary);
	}
	return { pages, failed };
}

/** The summary as Markdown text, under a title. */
export function benchReport(
	pages: readonly PageSummary[],
	options: BenchOptions,
	failed: readonly string[],
	title = 'three.js benchmark',
): string {
	const lines = [
		`# ${title}`,
		'',
		`GPU: ${options.gpu}. Runs per page: ${options.runs}, each a 5 s warm-up then ${options.auto ? 'the auto-slide' : `${options.seconds} s measured`}. Figures are the median of the runs' medians.`,
		'',
	];
	if (options.auto) {
		lines.push(
			'| Scene | GPU path | Renderer | Runs | Held at display rate | Held at half rate |',
			'| --- | --- | --- | --- | --- | --- |',
		);
		for (const page of pages)
			lines.push(
				`| ${page.scene} | ${page.gpu} | ${page.renderer} | ${page.runs} | ${whole(page.heldAtDisplayRate ?? Number.NaN)} | ${whole(page.heldAtHalfRate ?? Number.NaN)} |`,
			);
	} else {
		lines.push(
			'| Scene | GPU path | Renderer | Count | Runs | fps | Frame ms | CPU ms (lowest to highest run) | CPU p95 | Scene logic ms | Engine ms | GPU ms | Draw calls | Objects | Triangles |',
			'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		);
		for (const page of pages)
			lines.push(
				`| ${page.scene} | ${page.gpu} | ${page.renderer} | ${whole(page.count ?? Number.NaN)} | ${page.runs} | ${page.fps.toFixed(1)} | ${ms(page.frameMs)} | ${ms(page.cpuMs.median)} (${ms(page.cpuMs.min)} to ${ms(page.cpuMs.max)}) | ${ms(page.cpuP95Ms)} | ${ms(page.logicMs)} | ${ms(page.engineMs)} | ${ms(page.gpuMs)} | ${whole(page.drawCalls)} | ${whole(page.objects)} | ${whole(page.triangles)} |`,
			);
	}
	if (failed.length > 0) lines.push('', 'Failed:', ...failed.map((line) => `- ${line}`));
	lines.push('');
	return lines.join('\n');
}
