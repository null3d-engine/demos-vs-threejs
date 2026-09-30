// What `bun run devices` runs, and on which browsers. Pure: tools/devices.ts runs it.

import type { SceneId } from '../../src/scenes/index';
import {
	type BenchGpu,
	type BenchItem,
	type BenchOptions,
	benchPlan,
	parseBenchArgs,
	runName,
} from './bench-plan';
import type { ItemResult, Runner } from './device-runs';
import { SCALE_SECONDS } from './scale';

export type DevicePlanName = 'bench' | 'scale';

export interface DeviceOptions {
	plan: DevicePlanName;
	/** The pages: scenes, GPU paths, counts, runs and seconds, as `bun run bench` takes them. */
	bench: BenchOptions;
	/** The scale search's frame rate; null holds each device's display rate. */
	holdFps: number | null;
	/** A browser without WebGPU skips the WebGPU pages instead of failing them. */
	allowNoWebgpu: boolean;
	/** macOS app names, such as Safari. */
	mac: string[];
	/** Browsers on the Android phone connected by USB. */
	android: string[];
	/** Runner pages that wait on the local network, named device-browser, such as ipad-safari. */
	lan: string[];
	/** Also run in Chromium on this computer's software GPU: a check of the tools themselves. */
	chromium: boolean;
	/** The run's name, which is also its folder's name. */
	run: string;
}

export const DEVICES_USAGE = `Usage: bun run devices [options] [<macOS app>...]

Runs the demo's measurements in browsers that Playwright cannot drive: apps on this Mac, browsers
on an Android phone connected by USB (reading its heat every 10 s), and runner pages that wait on
tablets and phones on the local network. Each result goes to runs/devices/<time>-<plan>.

Options:
  --plan <name>       bench (the default): fixed counts or the auto-slide, as bun run bench;
                      scale: find the largest count at which three.js holds the display rate
  --hold-fps <n>      The scale search holds this frame rate instead of the display rate
  --allow-no-webgpu   A browser without WebGPU skips the WebGPU pages instead of failing them
  --android <list>    Browsers on the Android phone: chrome, chrome-beta, brave, firefox, samsung
  --lan <list>        Runner pages that wait on the local network, as device-browser, such as
                      ipad-safari; pages on one device take turns
  --chromium          Also run in Chromium here, on the software GPU: checks the tools
  --scenes, --gpus, --counts, --runs, --seconds, --auto, --gpu-time
                      As bun run bench (see bun run bench --help)
  --help              Show this text

Examples:
  bun run devices -- --android chrome --plan scale
  bun run devices -- --lan ipad-safari --scenes city --runs 5
  bun run devices -- Safari`;

/** Options of bun run bench that take a value and pass through. */
const BENCH_VALUE_OPTIONS = ['--scenes', '--gpus', '--counts', '--runs', '--seconds'];
const BENCH_FLAGS = ['--auto', '--gpu-time'];

const list = (value: string) =>
	value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);

export function parseDeviceArgs(args: readonly string[], now = new Date()): DeviceOptions {
	const benchArgs: string[] = [];
	const options: Omit<DeviceOptions, 'bench' | 'run'> = {
		plan: 'bench',
		holdFps: null,
		allowNoWebgpu: false,
		mac: [],
		android: [],
		lan: [],
		chromium: false,
	};
	for (let i = 0; i < args.length; i++) {
		const name = args[i] as string;
		const value = () => {
			const next = args[++i];
			if (next === undefined || next.startsWith('--'))
				throw new Error(`${name} needs a value.\n\n${DEVICES_USAGE}`);
			return next;
		};
		if (name === '--') continue;
		if (name === '--help') throw new Error(DEVICES_USAGE);
		if (name === '--plan') {
			const plan = value();
			if (plan !== 'bench' && plan !== 'scale')
				throw new Error(`--plan takes bench or scale, not "${plan}".`);
			options.plan = plan;
		} else if (name === '--hold-fps') {
			const text = value();
			const fps = Number(text);
			if (!Number.isFinite(fps) || fps <= 0)
				throw new Error(`--hold-fps takes a number above 0, not "${text}".`);
			options.holdFps = fps;
		} else if (name === '--allow-no-webgpu') options.allowNoWebgpu = true;
		else if (name === '--android') options.android = list(value());
		else if (name === '--lan') options.lan = list(value()).map(slug);
		else if (name === '--chromium') options.chromium = true;
		else if (BENCH_VALUE_OPTIONS.includes(name)) benchArgs.push(name, value());
		else if (BENCH_FLAGS.includes(name)) benchArgs.push(name);
		else if (name.startsWith('--'))
			throw new Error(`Unknown option "${name}".\n\n${DEVICES_USAGE}`);
		else options.mac.push(name);
	}
	const bench = parseBenchArgs(benchArgs, now);
	if (options.plan === 'scale' && (bench.auto || bench.gpuTime || benchArgs.includes('--counts')))
		throw new Error(
			'The scale search picks its own counts: leave out --counts, --auto and --gpu-time.',
		);
	if (options.mac.length + options.android.length + options.lan.length === 0 && !options.chromium)
		throw new Error(`Name at least one browser.\n\n${DEVICES_USAGE}`);
	return { ...options, bench, run: runName(options.plan, now) };
}

export const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

/** How a runner starts. */
export type Launch =
	| { kind: 'mac'; app: string }
	| { kind: 'android'; browser: string }
	| { kind: 'lan' }
	| { kind: 'chromium' };

export type LaunchedRunner = Runner & { launch: Launch };

/**
 * The runners, each with the physical device it runs on: macOS apps and the Chromium check share
 * this computer, the phone's browsers share the phone, and a network runner's device is the first
 * part of its name.
 */
export function deviceRunners(options: DeviceOptions, phone: string | null): LaunchedRunner[] {
	const runners: LaunchedRunner[] = options.mac.map((app) => ({
		name: `mac-${slug(app)}`,
		device: 'this-computer',
		launch: { kind: 'mac', app },
	}));
	if (options.chromium)
		runners.push({ name: 'chromium', device: 'this-computer', launch: { kind: 'chromium' } });
	if (options.android.length > 0) {
		if (!phone) throw new Error('Android browsers need a connected phone.');
		for (const browser of options.android)
			runners.push({
				name: `${phone}-${browser}`,
				device: phone,
				launch: { kind: 'android', browser },
			});
	}
	for (const name of options.lan)
		runners.push({ name, device: name.split('-')[0] as string, launch: { kind: 'lan' } });
	return runners;
}

/** The one page of a scale search step: a scene on a GPU path at a count, measured briefly. */
export function scaleItem(
	options: DeviceOptions,
	scene: SceneId,
	gpu: BenchGpu,
	count: number,
): BenchItem {
	const [item] = benchPlan({
		...options.bench,
		scenes: [scene],
		gpus: [gpu],
		counts: [count],
		runs: 1,
		seconds: SCALE_SECONDS,
		auto: false,
		gpuTime: false,
	});
	return { ...(item as BenchItem), id: `scale-${scene}-${gpu}-${count}` };
}

/** Errors of a page on a browser without WebGPU (src/threejs/runtime.ts). */
const NO_WEBGPU = /has no WebGPU|could not start WebGPU/;

/**
 * A result's verdict: 'pass', 'skip' for a WebGPU page on a browser without WebGPU when that is
 * allowed, or what went wrong.
 */
export function judge(
	item: BenchItem,
	result: ItemResult | undefined,
	allowNoWebgpu: boolean,
): 'pass' | 'skip' | string {
	if (!result) return 'no result; the runner stopped before this page';
	if (result.ok) return 'pass';
	if (allowNoWebgpu && item.gpu === 'webgpu' && NO_WEBGPU.test(result.error)) return 'skip';
	return result.error;
}
