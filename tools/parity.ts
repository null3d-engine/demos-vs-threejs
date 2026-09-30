// The image check: draws each scene's hold frame from each source, compares them with three.js's
// image rule, and writes the frames, diff images and a report. See tools/lib/parity-plan.ts.
// Run: bun run parity [--help]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import { decode, encode } from 'fast-png';
import { compareImages, percent, type RgbaImage, toRgba } from '../src/measure/parity';
import type { SceneId } from '../src/scenes/index';
import { launchChromium, VIEWPORT } from './lib/browser';
import {
	BASELINE_PAIR,
	type FrameSource,
	holdPath,
	type ParityOptions,
	type ParityRow,
	parityReport,
	parseParityArgs,
} from './lib/parity-plan';
import { serveBuild } from './lib/serve';

const PORT = 4175;
/** A hold frame on the software GPU can take a minute: the scene runs to its hold time first. */
const HOLD_TIMEOUT_MS = 180_000;

/** Draws a hold frame, or returns why the source could not draw here. */
async function holdFrame(
	browser: Browser,
	base: string,
	scene: SceneId,
	source: FrameSource,
	options: ParityOptions,
): Promise<RgbaImage | string> {
	const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
	try {
		await page.goto(`${base}${holdPath(scene, source, options.effects)}`);
		const held = page.locator('#view[data-held="true"]');
		const failed = page.locator('#status', { hasText: 'could not start' });
		await held.or(failed).waitFor({ timeout: HOLD_TIMEOUT_MS });
		if (await failed.isVisible()) return (await failed.textContent()) ?? 'could not start';
		return toRgba(decode(await page.locator('#view canvas').screenshot()));
	} finally {
		await page.close();
	}
}

async function main(): Promise<void> {
	let options: ParityOptions;
	try {
		options = parseParityArgs(process.argv.slice(2));
	} catch (error) {
		console.log(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	await mkdir(options.out, { recursive: true });
	const server = options.url ? null : await serveBuild(PORT);
	const base = options.url ?? (server?.url as string);
	const browser = await launchChromium(options);
	const rows: ParityRow[] = [];
	try {
		for (const scene of options.scenes) {
			const frames = new Map<FrameSource, RgbaImage | string>();
			for (const source of [BASELINE_PAIR.candidate, BASELINE_PAIR.reference]) {
				console.log(`Drawing the ${scene} hold frame with ${source}.`);
				const frame = await holdFrame(browser, base, scene, source, options);
				frames.set(source, frame);
				if (typeof frame !== 'string')
					await writeFile(join(options.out, `${scene}-${source}.png`), encode(frame));
			}
			const candidate = frames.get(BASELINE_PAIR.candidate);
			const reference = frames.get(BASELINE_PAIR.reference);
			if (
				typeof candidate === 'string' ||
				typeof reference === 'string' ||
				!candidate ||
				!reference
			) {
				const note = [candidate, reference].find((frame) => typeof frame === 'string');
				rows.push({ scene, pair: BASELINE_PAIR, share: null, note: String(note) });
				continue;
			}
			const comparison = compareImages(reference, candidate);
			await writeFile(
				join(
					options.out,
					`${scene}-${BASELINE_PAIR.candidate}-vs-${BASELINE_PAIR.reference}-diff.png`,
				),
				encode(comparison.diff),
			);
			console.log(`${scene}: ${percent(comparison.share)} of pixels differ.`);
			rows.push({ scene, pair: BASELINE_PAIR, share: comparison.share });
		}
	} finally {
		await browser.close();
		server?.stop();
	}
	const report = parityReport(rows, options);
	await writeFile(join(options.out, 'report.md'), report);
	await writeFile(
		join(options.out, 'report.json'),
		`${JSON.stringify({ options, rows }, null, '\t')}\n`,
	);
	console.log(`\n${report}`);
}

await main();
