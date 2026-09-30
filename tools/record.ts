// The recorder: a run of hold frames of each scene, one page load per frame at a later scene time,
// saved as PNG files and joined into a GIF. Every frame is exact however slowly it draws, so the
// files can be made into a video at any frame rate. See tools/lib/record-plan.ts for the options.
// Run: bun run record [--help]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { decode } from 'fast-png';
import { toRgba } from '../src/measure/parity';
import { launchChromium } from './lib/browser';
import { type Frame, gifBytes, shrink } from './lib/gif';
import { parseRecordArgs, type RecordOptions, recordings } from './lib/record-plan';
import { serveBuild } from './lib/serve';

const PORT = 4179;
const HOLD_TIMEOUT_MS = 180_000;

/** Draws one hold frame and returns its PNG file. */
async function holdFrame(page: Page, url: string): Promise<Buffer> {
	await page.goto(url);
	const held = page.locator('#view[data-held="true"]');
	const failed = page.locator('#status', { hasText: 'could not start' });
	await held.or(failed).waitFor({ timeout: HOLD_TIMEOUT_MS });
	if (await failed.isVisible()) throw new Error((await failed.textContent()) ?? 'could not start');
	return page.locator('#view canvas').screenshot();
}

async function main(): Promise<void> {
	let options: RecordOptions;
	try {
		options = parseRecordArgs(process.argv.slice(2));
		recordings(options);
	} catch (error) {
		console.log(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	const server = options.url ? null : await serveBuild(PORT);
	const base = options.url ?? (server?.url as string);
	const browser = await launchChromium(options);
	try {
		const page = await browser.newPage({ viewport: options.viewport, deviceScaleFactor: 1 });
		for (const recording of recordings(options)) {
			const folder = join(options.out, recording.name);
			await mkdir(folder, { recursive: true });
			const small: Frame[] = [];
			for (const [i, frame] of recording.frames.entries()) {
				const png = await holdFrame(page, `${base}${frame.path}`);
				await writeFile(join(folder, `frame-${String(i + 1).padStart(4, '0')}.png`), png);
				if (options.gifWidth !== null) {
					const image = toRgba(decode(png));
					const full = { width: image.width, height: image.height, pixels: image.data };
					small.push(shrink(full, options.gifWidth));
				}
				process.stdout.write(`\r${recording.name}: frame ${i + 1} of ${recording.frames.length}`);
			}
			process.stdout.write('\n');
			await writeFile(
				join(folder, 'recording.json'),
				`${JSON.stringify({ ...recording, fps: options.fps, viewport: options.viewport, gpu: options.gpu }, null, '\t')}\n`,
			);
			if (small.length > 0) {
				const gif = gifBytes(small, 1000 / options.fps);
				const file = join(options.out, `${recording.name}.gif`);
				await writeFile(file, gif);
				const first = small[0] as Frame;
				console.log(
					`${file}: ${first.width}x${first.height}, ${small.length} frames, ${(gif.length / 1e6).toFixed(2)} MB`,
				);
			}
			console.log(
				`Video: ffmpeg -framerate ${options.fps} -i ${join(folder, 'frame-%04d.png')} -c:v libx264 -pix_fmt yuv420p -crf 16 ${join(options.out, `${recording.name}.mp4`)}`,
			);
		}
	} finally {
		await browser.close();
		server?.stop();
	}
}

await main();
