import { writeFileSync } from 'node:fs';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { decode } from 'fast-png';
import { factoryObjects } from '../src/scenes/factory';
import { SCENES, type SceneId } from '../src/scenes/index';
import { formatCount, SLIDER_STEPS, sliderToCount } from '../src/shell/slider';

/** The share of an image's pixels that differ clearly from the scene's background. */
function drawnShare(png: Buffer, background: [number, number, number]): number {
	const image = decode(png);
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

/**
 * Waits until much of the view shows the scene, not the background. The last screenshot is kept
 * with the test's results, so a reviewer can look at each scene on each GPU path. A screenshot
 * waits for the next frame, and with the glow the software GPU can take most of a minute per frame.
 */
async function expectDrawn(
	page: Page,
	background: [number, number, number],
	testInfo: TestInfo,
): Promise<void> {
	let last: Buffer | null = null;
	await expect
		.poll(
			async () => {
				last = await page.locator('#view').screenshot();
				return drawnShare(last, background);
			},
			{ timeout: 180_000 },
		)
		.toBeGreaterThan(0.3);
	if (last) writeFileSync(testInfo.outputPath('view.png'), last);
}

/** Collects console errors of the page and its worker: a shader that does not build logs one. */
function watchErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
}

const readout = (page: Page) => page.locator('#readout');

/** The objects the readout shows. */
async function shownObjects(page: Page): Promise<number> {
	const text = (await readout(page).textContent()) ?? '';
	const found = /Objects ([0-9,]+)/.exec(text);
	return found ? Number((found[1] as string).replaceAll(',', '')) : -1;
}

/**
 * Each scene with a three.js version: its background, and the count the tests start it with. The
 * software GPU can need seconds per frame, and a screenshot waits for a quiet frame, so the tests
 * use a light count. The battle's objects change as shots fly, so the test checks that it shows
 * at least its units, tanks and ground.
 */
const SCENE_CHECKS: {
	scene: SceneId;
	background: [number, number, number];
	count: number;
	exactObjects: boolean;
}[] = [
	{ scene: 'factory', background: [0x0e, 0x11, 0x16], count: 10_000, exactObjects: true },
	{ scene: 'city', background: [0x05, 0x07, 0x0d], count: 100, exactObjects: true },
	{ scene: 'battle', background: [0xa9, 0xb8, 0xc9], count: 100, exactObjects: false },
];

/** Checks the readout's count and objects for a scene at `count`. */
async function expectCounted(page: Page, scene: SceneId, count: number, exact: boolean) {
	const info = SCENES[scene];
	await expect(readout(page)).toContainText(`${formatCount(count)} ${info.countUnit}`, {
		timeout: 30_000,
	});
	const objects = await shownObjects(page);
	if (exact) expect(objects).toBe(info.objectsAt(count));
	else expect(objects).toBeGreaterThanOrEqual(info.objectsAt(count));
}

for (const { scene, background, count, exactObjects } of SCENE_CHECKS) {
	test(`the ${scene} starts on WebGL2 in a worker and draws the scene`, async ({
		page,
	}, testInfo) => {
		const errors = watchErrors(page);
		await page.goto(`/?scene=${scene}&gpu=webgl2&count=${count}`);
		await expect(readout(page)).toContainText('three.js 0.186.1 · WebGL2 · worker', {
			timeout: 60_000,
		});
		await expectCounted(page, scene, count, exactObjects);
		await expectDrawn(page, background, testInfo);
		expect(errors).toEqual([]);
	});

	test(`WebGPU draws the ${scene} where the browser runs three.js WebGPU`, async ({
		page,
	}, testInfo) => {
		const errors = watchErrors(page);
		await page.goto(`/?scene=${scene}&gpu=webgpu&count=${count}`);
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
		await expect(readout(page)).toContainText(
			'three.js 0.186.1 · WebGPU · worker · WebGPURenderer',
		);
		await expectCounted(page, scene, count, exactObjects);
		await expectDrawn(page, background, testInfo);
		expect(errors).toEqual([]);
	});
}

// Every scene has the glow on by default; these draw a scene the plain way, straight to the canvas.
for (const gpu of ['webgl2', 'webgpu'] as const) {
	test(`without the glow, the factory draws straight to the canvas on ${gpu}`, async ({
		page,
	}, testInfo) => {
		const errors = watchErrors(page);
		await page.goto(`/?scene=factory&gpu=${gpu}&effects=shadows,fog`);
		const started = readout(page).filter({ hasText: 'Draw calls' });
		const failed = page.locator('#status', { hasText: 'could not start' });
		await expect(started.or(failed)).toBeVisible({ timeout: 60_000 });
		const status = (await page.locator('#status').textContent()) ?? '';
		test.skip(
			status.includes("'swizzle'"),
			'This Chromium refuses the texture swizzle setting of three.js 0.186.',
		);
		await expect(readout(page)).toContainText(
			gpu === 'webgpu' ? 'WebGPU · worker' : 'WebGL2 · worker',
		);
		await expectDrawn(page, [0x0e, 0x11, 0x16], testInfo);
		expect(errors).toEqual([]);
	});
}

for (const [crowd, renderer] of [
	['draw', 'WebGPURenderer, WebGL2 mode'],
	['skinned', 'WebGLRenderer'],
] as const) {
	test(`on WebGL2 the battle's ${crowd} crowd draws with the ${renderer}, in the fight`, async ({
		page,
	}, testInfo) => {
		const errors = watchErrors(page);
		// At 58 seconds the armies are in range: units aim, fire, fall and get up again.
		await page.goto(`/?scene=battle&gpu=webgl2&count=100&crowd=${crowd}&at=58`);
		await expect(readout(page)).toContainText(`WebGL2 · worker · ${renderer}`, {
			timeout: 60_000,
		});
		await expectCounted(page, 'battle', 100, false);
		await expectDrawn(page, [0xa9, 0xb8, 0xc9], testInfo);
		expect(errors).toEqual([]);
	});
}

test('the hold option draws one still frame with no readout', async ({ page }) => {
	const errors = watchErrors(page);
	await page.goto('/?scene=factory&gpu=webgl2&count=2000&at=6&hold=1');
	await expect(page.locator('#view[data-held="true"]')).toBeVisible({ timeout: 60_000 });
	await expect(readout(page)).toBeHidden();
	const canvas = page.locator('#view canvas');
	const first = await canvas.screenshot();
	await page.waitForTimeout(1000);
	const second = await canvas.screenshot();
	const a = decode(first);
	expect(drawnShare(first, [0x0e, 0x11, 0x16])).toBeGreaterThan(0.3);
	expect(Buffer.from(decode(second).data).equals(Buffer.from(a.data))).toBe(true);
	expect(errors).toEqual([]);
});

test('the full option fills the window with the scene, for recordings', async ({ page }) => {
	const errors = watchErrors(page);
	await page.setViewportSize({ width: 960, height: 540 });
	await page.goto('/?scene=factory&gpu=webgl2&count=2000&at=6&hold=1&full=1');
	await expect(page.locator('#view[data-held="true"]')).toBeVisible({ timeout: 60_000 });
	const png = decode(await page.locator('#view canvas').screenshot());
	expect([png.width, png.height]).toEqual([960, 540]);
	expect(errors).toEqual([]);
});

test('the bench option measures after a warm-up and hands the figures to the tools', async ({
	page,
}) => {
	const errors = watchErrors(page);
	await page.goto('/?scene=factory&gpu=webgl2&count=2000&bench=2');
	const handle = await page.waitForFunction(
		() => (globalThis as { __demoResult?: unknown }).__demoResult,
		undefined,
		{ timeout: 60_000 },
	);
	const result = (await handle.jsonValue()) as {
		ok: boolean;
		kind: string;
		count: number;
		seconds: number;
		measurement: { frames: number; cpuMsMedian: number; logicMsMedian: number; gpuMsMedian: null };
	};
	expect(result).toMatchObject({ ok: true, kind: 'bench', count: 2000, seconds: 2 });
	expect(result.measurement.frames).toBeGreaterThan(0);
	expect(result.measurement.cpuMsMedian).toBeGreaterThan(result.measurement.logicMsMedian);
	expect(result.measurement.gpuMsMedian).toBeNull();
	await expect(page.locator('body[data-result="ready"]')).toBeAttached();
	expect(errors).toEqual([]);
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
