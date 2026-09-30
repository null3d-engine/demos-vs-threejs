// The benchmark: each scene with three.js at fixed counts, or with the auto-slide, a fresh tab per
// run, on this machine's GPU in Google Chrome. See tools/lib/bench-plan.ts for the protocol.
// Run: bun run bench [--help]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import type { DemoResult } from '../src/shell/result';
import {
	type BenchItem,
	type BenchOptions,
	benchPlan,
	benchReport,
	parseBenchArgs,
	summarizePlan,
} from './lib/bench-plan';
import { launchChromium, VIEWPORT } from './lib/browser';
import { serveBuild } from './lib/serve';

const PORT = 4176;

/** Runs one item in a fresh tab and returns the page's result. */
async function runItem(browser: Browser, base: string, item: BenchItem): Promise<DemoResult> {
	const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
	const page = await context.newPage();
	try {
		await page.goto(`${base}${item.path}`);
		const handle = await page.waitForFunction(
			() => (globalThis as { __demoResult?: unknown }).__demoResult,
			undefined,
			{ timeout: item.timeoutMs },
		);
		return (await handle.jsonValue()) as DemoResult;
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	} finally {
		await context.close();
	}
}

function describe(result: DemoResult): string {
	if (!result.ok) return `failed: ${result.error}`;
	if (result.kind === 'auto')
		return `held the display rate up to ${result.run.heldAtDisplayRate.toLocaleString('en-US')}`;
	const m = result.measurement;
	const gpu = m.gpuMsMedian === null ? '' : `, GPU ${m.gpuMsMedian.toFixed(2)} ms`;
	return `${m.fps.toFixed(1)} fps, CPU ${m.cpuMsMedian.toFixed(2)} ms (scene logic ${m.logicMsMedian.toFixed(2)} ms)${gpu}`;
}

async function main(): Promise<void> {
	let options: BenchOptions;
	try {
		options = parseBenchArgs(process.argv.slice(2));
	} catch (error) {
		console.log(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	await mkdir(options.out, { recursive: true });
	const plan = benchPlan(options);
	const server = options.url ? null : await serveBuild(PORT);
	const base = options.url ?? (server?.url as string);
	const browser = await launchChromium(options);
	const results = new Map<string, DemoResult>();
	try {
		for (const [index, item] of plan.entries()) {
			const result = await runItem(browser, base, item);
			results.set(item.id, result);
			await writeFile(
				join(options.out, `${item.id}.json`),
				`${JSON.stringify(result, null, '\t')}\n`,
			);
			console.log(`[${index + 1}/${plan.length}] ${item.id}: ${describe(result)}`);
		}
	} finally {
		await browser.close();
		server?.stop();
	}
	const { pages, failed } = summarizePlan(plan, (id) => results.get(id));
	const report = benchReport(pages, options, failed);
	await writeFile(join(options.out, 'summary.md'), report);
	await writeFile(
		join(options.out, 'summary.json'),
		`${JSON.stringify({ options, pages, failed }, null, '\t')}\n`,
	);
	console.log(`\n${report}\nFiles: ${options.out}`);
}

await main();
