import { expect, type Page, test } from '@playwright/test';
import { decode } from 'fast-png';
import { factoryObjects } from '../src/scenes/factory';
import { SCENES } from '../src/scenes/index';
import { formatCount, SLIDER_STEPS, sliderToCount } from '../src/shell/slider';

/** The share of the view's pixels that differ clearly from the scene's background. */
async function drawnShare(page: Page, background: [number, number, number]): Promise<number> {
	const image = decode(await page.locator('#view').screenshot());
	const channels = image.channels;
	let drawn = 0;
	const pixels = image.width * image.height;
	for (let p = 0; p < pixels; p++) {
		const i = p * channels;
		const distance =
			Math.abs(image.data[i]! - background[0]) +
			Math.abs(image.data[i + 1]! - background[1]) +
			Math.abs(image.data[i + 2]! - background[2]);
		if (distance > 30) drawn++;
	}
	return drawn / pixels;
}

const FACTORY_BACKGROUND: [number, number, number] = [0x0e, 0x11, 0x16];
const readout = (page: Page) => page.locator('#readout');

test('the factory starts on WebGL2 in a worker and draws the scene', async ({ page }) => {
	await page.goto('/?scene=factory&gpu=webgl2');
	await expect(readout(page)).toContainText('three.js 0.186.1 · WebGL2 · worker', {
		timeout: 60_000,
	});
	await expect(readout(page)).toContainText('10,000 moving parts', { timeout: 30_000 });
	await expect(readout(page)).toContainText('Objects 14,001');
	// Wait for a drawn frame, then check that most of the view shows the scene, not the background.
	await expect
		.poll(() => drawnShare(page, FACTORY_BACKGROUND), { timeout: 30_000 })
		.toBeGreaterThan(0.3);
});

test('Auto starts three.js on one of the GPU paths', async ({ page }) => {
	await page.goto('/?scene=factory');
	await expect(readout(page)).toContainText(
		/three\.js 0\.186\.1 · (WebGPU|WebGL2) · (worker|page thread)/,
		{
			timeout: 60_000,
		},
	);
});

test('WebGPU draws the factory where the browser runs three.js WebGPU', async ({ page }) => {
	await page.goto('/?scene=factory&gpu=webgpu');
	const started = readout(page).filter({ hasText: 'WebGPU' });
	const failed = page.locator('#status', { hasText: 'could not start' });
	await expect(started.or(failed)).toBeVisible({ timeout: 60_000 });
	const status = (await page.locator('#status').textContent()) ?? '';
	// Chromium 141 knows an older form of a texture setting that three.js 0.186 sends, and refuses
	// it; newer Chromium, Safari and Firefox accept or ignore it. Skip only on that known refusal.
	test.skip(
		status.includes("'swizzle'"),
		'This Chromium refuses the texture swizzle setting of three.js 0.186.',
	);
	await expect(readout(page)).toContainText('three.js 0.186.1 · WebGPU');
	await expect
		.poll(() => drawnShare(page, FACTORY_BACKGROUND), { timeout: 30_000 })
		.toBeGreaterThan(0.3);
});

test('the count slider changes how much of the scene is drawn', async ({ page }) => {
	await page.goto('/?scene=factory&gpu=webgl2');
	await expect(readout(page)).toContainText('10,000 moving parts', { timeout: 60_000 });
	const plan = SCENES.factory.ramp.desktop;
	const count = sliderToCount(SLIDER_STEPS / 2, Math.round(plan.start / 10), plan.max);
	await page.locator('#count').fill(String(SLIDER_STEPS / 2));
	await expect(page.locator('#count-value')).toHaveText(formatCount(count));
	await expect(readout(page)).toContainText(`${formatCount(count)} moving parts`, {
		timeout: 30_000,
	});
	await expect(readout(page)).toContainText(`Objects ${formatCount(factoryObjects(count))}`);
});

test('the auto-slide measures steps and ends with a result card and a run to save', async ({
	page,
}) => {
	await page.goto('/?scene=factory&gpu=webgl2');
	await expect(readout(page)).toContainText('10,000 moving parts', { timeout: 60_000 });
	await page.locator('#auto').click();
	await expect(page.locator('#auto')).toHaveText('Stop auto-slide');
	await expect(readout(page)).toContainText('Auto-slide: second', { timeout: 10_000 });
	// The software GPU draws far under 20 frames a second, so the ramp stops after 3 steps.
	const result = page.locator('#result');
	await expect(result).toBeVisible({ timeout: 60_000 });
	await expect(result).toContainText('three.js on WebGL2');
	await expect(result).toContainText('The auto-slide stopped at second');
	await expect(page.locator('#save')).toBeEnabled();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.locator('#save').click(),
	]);
	expect(download.suggestedFilename()).toMatch(/^factory-threejs-webgl2-desktop-.*\.json$/);
});
