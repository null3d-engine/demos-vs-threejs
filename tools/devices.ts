// Runs the demo's measurements in browsers that Playwright cannot drive, through the runner page
// (tools/runner): apps on this Mac, browsers on an Android phone connected by USB, and runner pages
// that wait on tablets and phones on the local network. One browser per device runs at a time. On
// the Android phone it reads the heat through the run, and adds to each result the heat that the
// page ran in. Adapted from the null3D engine (tests/real-browsers.ts at commit 51fb3c3).
// Run: bun run devices [--help]

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import type { BenchResult } from '../src/shell/result';
import { forwardPort, openOnPhone, phoneModel } from './lib/adb';
import { type BenchItem, benchPlan, benchReport, summarizePlan } from './lib/bench-plan';
import { launchChromium, VIEWPORT } from './lib/browser';
import {
	type DeviceOptions,
	deviceRunners,
	judge,
	type LaunchedRunner,
	parseDeviceArgs,
	scaleItem,
	slug,
} from './lib/device-plan';
import {
	batchTimeoutMs,
	DEVICE_RUNS_DIR as ROOT,
	readDevice,
	readResult,
	receivedAt,
	setTurns,
	turnBatches,
	waitForRunners,
	writePlan,
	writeRunnerFile,
} from './lib/device-runs';
import {
	CERT_DIR,
	type DeviceServer,
	HTTP_PORT,
	HTTPS_PORT,
	loadSite,
	RUNNER_PATH,
	serveSite,
} from './lib/device-server';
import { HeatLog, type HeatSample, type HeatSummary, heatText, summarizeHeat } from './lib/heat';
import { localHostName } from './lib/host';
import {
	afterCount,
	holdRate,
	holdsRate,
	NEW_SEARCH,
	nextCount,
	type ScaleSearch,
	scaleBounds,
	suggestedRamp,
} from './lib/scale';
import { buildSite } from './lib/serve';

/** Time a macOS app may take to open the runner page before its turn counts as failed. */
const OPEN_TIMEOUT_MS = 60_000;

/** Opens runner pages, and closes what it opened at the end. */
class Launcher {
	private chromium: Browser | null = null;

	constructor(
		private readonly runners: ReadonlyMap<string, LaunchedRunner>,
		private readonly localUrl: string,
	) {}

	/** Opens a run's runner page for each of these runners, and returns the ones that opened. */
	async open(names: readonly string[], run: string): Promise<string[]> {
		const opened: string[] = [];
		for (const name of names) {
			const { launch } = this.runners.get(name) as LaunchedRunner;
			const url = `${this.localUrl}${RUNNER_PATH}?run=${run}&runner=${name}`;
			if (launch.kind === 'mac') {
				try {
					// A launch that hangs, as behind a first-launch prompt, fails after a minute.
					execFileSync('open', ['-a', launch.app, url], { timeout: OPEN_TIMEOUT_MS });
				} catch (error) {
					console.log(
						`${launch.app} did not open the runner page: ${String(error).split('\n')[0]}`,
					);
					continue;
				}
			} else if (launch.kind === 'android') {
				openOnPhone(launch.browser, url);
			} else if (launch.kind === 'chromium') {
				this.chromium ??= await launchChromium({ gpu: 'software', chrome: null });
				const page = await this.chromium.newPage({ viewport: VIEWPORT });
				void page.goto(url).catch((error) => console.log(`chromium: ${String(error)}`));
			} else {
				console.log(`${name}: its turn now; bring its runner page to the front.`);
			}
			opened.push(name);
		}
		return opened;
	}

	async close(): Promise<void> {
		await this.chromium?.close();
	}
}

/**
 * Adds to each of a runner's results the heat from the previous result, or from the runner page's
 * start, to its own. Returns each item's heat.
 */
function addHeat(
	run: string,
	runner: string,
	ids: readonly string[],
	samples: readonly HeatSample[],
): Map<string, HeatSummary> {
	const byItem = new Map<string, HeatSummary>();
	let from = receivedAt(readDevice(ROOT, run, runner));
	for (const id of ids) {
		const result = readResult(ROOT, run, runner, id);
		const to = receivedAt(result);
		if (!result || from === undefined || to === undefined) continue;
		const heat = summarizeHeat(samples, from, to);
		if (heat) {
			byItem.set(id, heat);
			writeRunnerFile(ROOT, run, runner, id, { ...result, heat });
		}
		from = to;
	}
	return byItem;
}

/** The heat through all of a runner's readings, as one line. */
function wholeHeatText(samples: readonly HeatSample[]): string | undefined {
	const first = samples[0];
	const last = samples.at(-1);
	const heat = first && last && summarizeHeat(samples, first.at, last.at);
	return heat ? heatText(heat) : undefined;
}

const isPhone = (runner: LaunchedRunner | undefined) => runner?.launch.kind === 'android';

/**
 * Runs the bench plan: each batch of runners at once, one browser per device, while the phone's
 * heat is read. Writes a summary per runner; returns the number of failures.
 */
async function runBench(
	options: DeviceOptions,
	runners: ReadonlyMap<string, LaunchedRunner>,
	launcher: Launcher,
): Promise<number> {
	const { run } = options;
	const plan: BenchItem[] = benchPlan(options.bench);
	writePlan(ROOT, run, plan);
	const heatReadings = new Map<string, HeatSample[]>();
	try {
		for (const batch of turnBatches([...runners.values()])) {
			setTurns(ROOT, run, batch);
			const phone = batch.find((name) => isPhone(runners.get(name)));
			const log = phone === undefined ? undefined : new HeatLog();
			log?.start();
			try {
				await waitForRunners(
					ROOT,
					run,
					await launcher.open(batch, run),
					batchTimeoutMs(plan),
					(name) => console.log(`${name}: finished`),
				);
			} finally {
				if (phone !== undefined && log) heatReadings.set(phone, await log.stop());
			}
		}
	} finally {
		setTurns(ROOT, run, []);
	}

	let failures = 0;
	const reports: string[] = [];
	const summary: Record<string, { pass: number; skip: number; fail: number }> = {};
	for (const name of runners.keys()) {
		const samples = heatReadings.get(name);
		if (samples) writeRunnerFile(ROOT, run, name, 'heat', samples);
		const heat = samples
			? addHeat(
					run,
					name,
					plan.map((item) => item.id),
					samples,
				)
			: new Map<string, HeatSummary>();
		const counts = { pass: 0, skip: 0, fail: 0 };
		summary[name] = counts;
		if (!readDevice(ROOT, run, name)) {
			counts.fail++;
			console.log(`FAIL  ${name}: the runner page never started`);
			continue;
		}
		for (const item of plan) {
			const verdict = judge(item, readResult(ROOT, run, name, item.id), options.allowNoWebgpu);
			if (verdict === 'skip') counts.skip++;
			else if (verdict === 'pass') counts.pass++;
			else counts.fail++;
			const line = verdict === 'pass' || verdict === 'skip' ? verdict : `FAIL  ${verdict}`;
			console.log(`${name}: ${item.id}: ${line}`);
			const itemHeat = heat.get(item.id);
			if (itemHeat) console.log(`      heat: ${heatText(itemHeat)}`);
		}
		failures += counts.fail;
		const { pages, failed } = summarizePlan(plan, (id) => readResult(ROOT, run, name, id));
		// Each device draws with its own GPU; the Chromium check draws with the software GPU.
		const gpu = runners.get(name)?.launch.kind === 'chromium' ? 'software' : 'hardware';
		const bench = { ...options.bench, gpu } as const;
		const lines = [benchReport(pages, bench, failed, `three.js on ${name}`)];
		const whole = wholeHeatText(samples ?? []);
		if (whole) lines.push(`Heat through the run: ${whole}.`, '');
		reports.push(lines.join('\n'));
	}
	const report = reports.join('\n');
	writeFileSync(join(ROOT, run, 'summary.md'), report);
	writeFileSync(join(ROOT, run, 'summary.json'), JSON.stringify({ options, summary }, null, '\t'));
	console.log(`\n${report}`);
	for (const [name, counts] of Object.entries(summary))
		console.log(`${name}: ${counts.pass} passed, ${counts.skip} skipped, ${counts.fail} failed`);
	console.log(`Files: ${join(ROOT, run)}`);
	return failures;
}

/** One count that the scale search tried on a runner. */
interface ScaleStep {
	scene: string;
	gpu: string;
	/** The count asked for, and the count the page drew (the page keeps it in its range). */
	asked: number;
	count: number;
	/** The run that tried it, and its result's name there. */
	run: string;
	id: string;
	/** Frames per second drawn and the rate to hold, or null when the page failed. */
	fps: number | null;
	rate: number | null;
	held: boolean;
	error?: string;
	heat?: HeatSummary;
}

interface ScaleAnswer {
	scene: string;
	gpu: string;
	rate: number | null;
	search: ScaleSearch;
}

const searched = ({ held, dropped }: ScaleSearch) => held > 0 || dropped !== null;

/** What the search found for one scene and GPU path, in one line. */
function answerText({ scene, gpu, rate, search }: ScaleAnswer): string {
	const fps = rate === null ? 'the rate' : `${rate} frames per second`;
	const count = (value: number) => value.toLocaleString('en-US');
	const at = `${scene} on ${gpu}`;
	if (search.held === 0)
		return `${at}: three.js does not hold ${fps} even at ${count(search.dropped ?? 0)}`;
	const ramp = suggestedRamp(search.held);
	const suggestion = `suggested auto-slide: start ${count(ramp.start)}, factor ${ramp.factor}`;
	if (search.dropped === null)
		return `${at}: three.js holds ${fps} up to ${count(search.held)}, the most the page allows; ${suggestion}`;
	return `${at}: three.js holds ${fps} up to ${count(search.held)} and drops below at ${count(search.dropped)}; ${suggestion}`;
}

/**
 * Searches each runner in turn, for each scene and GPU path, for the largest count at which
 * three.js holds the rate, one count per run. Returns the number of searches without an answer.
 */
async function runScale(
	options: DeviceOptions,
	runners: ReadonlyMap<string, LaunchedRunner>,
	launcher: Launcher,
): Promise<number> {
	const base = options.run;
	let failures = 0;
	for (const runner of runners.values()) {
		const { name } = runner;
		const log = isPhone(runner) ? new HeatLog() : undefined;
		const steps: ScaleStep[] = [];
		const answers: ScaleAnswer[] = [];
		log?.start();
		try {
			for (const scene of options.bench.scenes) {
				for (const gpu of options.bench.gpus) {
					let search = NEW_SEARCH;
					let bounds = scaleBounds(scene);
					let rate: number | null = options.holdFps;
					for (
						let asked = nextCount(search, bounds);
						asked !== null;
						asked = nextCount(search, bounds)
					) {
						const run = `${base}-${slug(name)}-${steps.length + 1}`;
						const item = scaleItem(options, scene, gpu, asked);
						writePlan(ROOT, run, [item]);
						setTurns(ROOT, run, [name]);
						await waitForRunners(
							ROOT,
							run,
							await launcher.open([name], run),
							batchTimeoutMs([item]),
						);
						const result = readResult(ROOT, run, name, item.id);
						const verdict = judge(item, result, options.allowNoWebgpu);
						if (verdict === 'skip') {
							console.log(`${name}: ${scene} on ${gpu}: this browser has no WebGPU`);
							break;
						}
						const bench = result?.ok && result.kind === 'bench' ? (result as BenchResult) : null;
						const held = bench !== null && holdsRate(bench, options.holdFps);
						if (bench) rate = holdRate(bench, options.holdFps);
						const drawn = bench?.count ?? asked;
						const step: ScaleStep = {
							scene,
							gpu,
							asked,
							count: drawn,
							run,
							id: item.id,
							fps: bench?.measurement.fps ?? null,
							rate: bench ? rate : null,
							held,
							...(verdict !== 'pass' && { error: verdict }),
						};
						steps.push(step);
						console.log(
							`${name}: ${scene} on ${gpu} at ${drawn.toLocaleString('en-US')}: ${step.fps === null ? `failed: ${step.error}` : `${step.fps.toFixed(1)} of ${rate} frames per second`}`,
						);
						// A page that fails at the first count shows that the browser cannot run it at all.
						if (!bench && !searched(search)) break;
						({ search, bounds } = afterCount(search, bounds, asked, drawn, held));
					}
					if (searched(search)) answers.push({ scene, gpu, rate, search });
					else failures++;
				}
			}
		} finally {
			setTurns(ROOT, base, []);
			const samples = log ? await log.stop() : [];
			if (log)
				for (const step of steps)
					step.heat = addHeat(step.run, name, [step.id], samples).get(step.id);
			writeRunnerFile(ROOT, base, name, 'scale', { answers, steps, heat: samples });
		}
		for (const answer of answers) console.log(`${name}: ${answerText(answer)}.`);
		const heat = wholeHeatText(log?.samples ?? []);
		if (heat) console.log(`${name}, heat through the search: ${heat}`);
	}
	console.log(`Files: ${join(ROOT, base)}`);
	return failures;
}

async function main(): Promise<void> {
	let options: DeviceOptions;
	try {
		options = parseDeviceArgs(process.argv.slice(2));
	} catch (error) {
		console.log(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	const phone = options.android.length > 0 ? slug(phoneModel()) : null;
	const runners = new Map(deviceRunners(options, phone).map((runner) => [runner.name, runner]));
	if (phone) forwardPort(HTTP_PORT);
	const tls =
		options.lan.length > 0
			? {
					cert: join(CERT_DIR, 'cert.pem'),
					key: join(CERT_DIR, 'key.pem'),
					host: `${localHostName()}.local`,
				}
			: undefined;
	if (tls && !(existsSync(tls.cert) && existsSync(tls.key)))
		throw new Error('Runner pages on the network need HTTPS: run bun run dev-cert first.');

	await buildSite();
	const site = await loadSite('dist', ROOT);
	const servers: DeviceServer[] = [serveSite(site, HTTP_PORT)];
	const local = servers[0] as DeviceServer;
	if (tls) {
		const lan = serveSite(site, HTTPS_PORT, tls);
		servers.push(lan);
		console.log(`On each tablet or phone, open ${lan.url}${RUNNER_PATH}?listen&runner=<name>`);
		console.log(
			`with <name> one of ${options.lan.join(', ')}. A waiting page runs each run when its turn comes.`,
		);
	}
	const launcher = new Launcher(runners, local.url);
	let failures: number;
	try {
		failures =
			options.plan === 'scale'
				? await runScale(options, runners, launcher)
				: await runBench(options, runners, launcher);
	} finally {
		await launcher.close();
		for (const server of servers) server.stop();
	}
	process.exit(failures > 0 ? 1 : 0);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
