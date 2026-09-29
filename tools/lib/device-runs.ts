// Runs of the runner page on devices. A run is a plan of demo pages that each browser works
// through, one page after another, with one result file per browser and page. The command-line
// tool writes the plan, chooses which browsers may run it now, and reads the results; the runner
// page and the tools' server move everything in between. Adapted from the null3D engine
// (tests/lib/runs.ts at commit 51fb3c3).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DemoResult } from '../../src/shell/result';

/** Where device runs land: a folder per run, and in it a folder per runner. */
export const DEVICE_RUNS_DIR = 'runs/devices';
/** The run that waiting runner pages should start, and which of them may start it now. */
const CURRENT_FILE = 'current.json';

/** One page of a plan: what the runner page needs to open it. */
export interface PlanItem {
	/** The item's name, which is also its result's file name. */
	id: string;
	/** The page to open: a path on the tools' server, with its options. */
	path: string;
	/** How long the page may take to publish its result, in milliseconds. */
	timeoutMs: number;
}

export interface Plan<Item extends PlanItem = PlanItem> {
	run: string;
	createdAt: string;
	items: Item[];
}

/** The run that waiting runner pages start, and the runners that may start it now. */
export interface CurrentRun {
	run: string;
	turns: string[];
}

/** A result the runner page stored, with the time the server received it. */
export type ItemResult = DemoResult & { receivedAt?: string };

function readJson<T>(path: string): T | undefined {
	return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;
}

export function writePlan<Item extends PlanItem>(
	root: string,
	run: string,
	items: Item[],
): Plan<Item> {
	const plan: Plan<Item> = { run, createdAt: new Date().toISOString(), items };
	mkdirSync(join(root, run), { recursive: true });
	writeFileSync(join(root, run, 'plan.json'), JSON.stringify(plan, null, '\t'));
	return plan;
}

/** Lets these runners start the run; any other waiting runner page keeps waiting. */
export function setTurns(root: string, run: string, turns: string[]): void {
	mkdirSync(root, { recursive: true });
	const current: CurrentRun = { run, turns };
	writeFileSync(join(root, CURRENT_FILE), JSON.stringify(current));
}

/** The run that waiting runner pages may start, as JSON text for the runner page. */
export function currentRunText(root: string): string {
	const path = join(root, CURRENT_FILE);
	return existsSync(path) ? readFileSync(path, 'utf8') : '{}';
}

export function readResult(root: string, run: string, runner: string, id: string) {
	return readJson<ItemResult>(join(root, run, runner, `${id}.json`));
}

/** Writes a file of a runner's results, such as a result with facts added after the run. */
export function writeRunnerFile(
	root: string,
	run: string,
	runner: string,
	name: string,
	value: unknown,
): void {
	mkdirSync(join(root, run, runner), { recursive: true });
	writeFileSync(join(root, run, runner, `${name}.json`), JSON.stringify(value, null, '\t'));
}

/** When the server received a result, in milliseconds since 1970, or undefined without one. */
export function receivedAt(result: { receivedAt?: unknown } | undefined): number | undefined {
	const time = Date.parse(String(result?.receivedAt));
	return Number.isFinite(time) ? time : undefined;
}

/** What the runner page learned about its browser and device. */
export function readDevice(root: string, run: string, runner: string) {
	return readJson<Record<string, unknown>>(join(root, run, runner, 'device.json'));
}

export function finished(root: string, run: string, runner: string): boolean {
	return existsSync(join(root, run, runner, 'done.json'));
}

/** A runner page in one browser, and the physical device that browser runs on. */
export interface Runner {
	name: string;
	device: string;
}

/**
 * Batches of runners that may run at the same time: at most one per physical device, so two
 * browsers never compete for one device's processor and GPU. Batch k holds the k-th runner of each
 * device, in the order given.
 */
export function turnBatches(runners: readonly Runner[]): string[][] {
	const byDevice = new Map<string, string[]>();
	for (const { name, device } of runners)
		byDevice.set(device, [...(byDevice.get(device) ?? []), name]);
	const batches: string[][] = [];
	for (const list of byDevice.values()) {
		list.forEach((runner, k) => {
			if (!batches[k]) batches[k] = [];
			batches[k]?.push(runner);
		});
	}
	return batches;
}

/** Time a batch may take: every page's timeout, plus time to open the browser and between pages. */
export function batchTimeoutMs(items: readonly PlanItem[]): number {
	const PER_ITEM_SLACK_MS = 5_000;
	const START_MS = 120_000;
	return START_MS + items.reduce((sum, item) => sum + item.timeoutMs + PER_ITEM_SLACK_MS, 0);
}

/** Waits until every runner has finished the run, or the deadline passes; returns the finished. */
export async function waitForRunners(
	root: string,
	run: string,
	runners: readonly string[],
	timeoutMs: number,
	onFinish: (runner: string) => void = () => {},
): Promise<string[]> {
	const deadline = Date.now() + timeoutMs;
	const done = new Set<string>();
	while (done.size < runners.length && Date.now() < deadline) {
		for (const runner of runners) {
			if (!done.has(runner) && finished(root, run, runner)) {
				done.add(runner);
				onFinish(runner);
			}
		}
		if (done.size < runners.length) await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return [...done];
}
