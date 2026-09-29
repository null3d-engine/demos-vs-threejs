import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTurns, writePlan } from './device-runs';
import { handle, type Site } from './device-server';

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A built demo with one page and one script, and an empty runs folder. */
function makeSite(): Site {
	const folder = mkdtempSync(join(tmpdir(), 'device-server-'));
	folders.push(folder);
	const dist = join(folder, 'dist');
	mkdirSync(join(dist, 'assets'), { recursive: true });
	writeFileSync(join(dist, 'index.html'), '<p>demo</p>');
	writeFileSync(join(dist, 'assets', 'page.js'), 'export {};');
	writeFileSync(join(folder, 'secret.txt'), 'not served');
	return { dist, runs: join(folder, 'runs'), runnerHtml: '<p>runner</p>', runnerJs: 'export {};' };
}

const get = (site: Site, path: string) => handle(new Request(`http://localhost${path}`), site);
const post = (site: Site, path: string, body: string) =>
	handle(new Request(`http://localhost${path}`, { method: 'POST', body }), site);

describe('the tools’ server', () => {
	test('serves the built demo and the runner page, cross-origin isolated', async () => {
		const site = makeSite();
		const page = await get(site, '/?scene=city&bench=5');
		expect(page.status).toBe(200);
		expect(await page.text()).toBe('<p>demo</p>');
		expect(page.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
		expect(page.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
		expect(await (await get(site, '/assets/page.js')).text()).toBe('export {};');
		const runner = await get(site, '/runner/?listen&runner=ipad-safari');
		expect(await runner.text()).toBe('<p>runner</p>');
		expect(runner.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
		expect((await get(site, '/runner/runner.js')).headers.get('Content-Type')).toBe(
			'text/javascript',
		);
	});

	test('serves nothing outside the built demo', async () => {
		const site = makeSite();
		expect((await get(site, '/../secret.txt')).status).toBe(404);
		expect((await get(site, '/%2e%2e/secret.txt')).status).toBe(404);
		expect((await get(site, '/missing.js')).status).toBe(404);
		expect((await get(site, '/%E0%A4%A')).status).toBe(400);
	});

	test('hands out the current run and its plan, and stores each result', async () => {
		const site = makeSite();
		expect(await (await get(site, '/__demo/runs/current')).json()).toEqual({});
		const items = [{ id: 'factory-webgl2-10000-run1', path: '/?scene=factory', timeoutMs: 1 }];
		writePlan(site.runs, 'r1', items);
		setTurns(site.runs, 'r1', ['chromium']);
		expect(await (await get(site, '/__demo/runs/current')).json()).toEqual({
			run: 'r1',
			turns: ['chromium'],
		});
		expect((await (await get(site, '/__demo/runs/r1/plan')).json()).items).toEqual(items);
		expect((await get(site, '/__demo/runs/r2/plan')).status).toBe(404);

		const path = '/__demo/runs/r1/chromium/factory-webgl2-10000-run1';
		expect((await get(site, path)).status).toBe(404);
		expect((await post(site, path, JSON.stringify({ ok: true, kind: 'bench' }))).status).toBe(204);
		const stored = JSON.parse(
			readFileSync(join(site.runs, 'r1', 'chromium', 'factory-webgl2-10000-run1.json'), 'utf8'),
		);
		expect(stored).toMatchObject({ ok: true, kind: 'bench' });
		expect(Number.isFinite(Date.parse(stored.receivedAt))).toBe(true);
		expect((await (await get(site, path)).json()).kind).toBe('bench');
	});

	test('refuses unsafe names and bodies that are not JSON objects', async () => {
		const site = makeSite();
		expect((await post(site, '/__demo/runs/r1/Chromium/x', '{}')).status).toBe(400);
		expect((await post(site, '/__demo/runs/r1/..%2f..%2fx/y', '{}')).status).toBe(400);
		expect((await post(site, '/__demo/runs/r1/chromium/x', 'not json')).status).toBe(400);
		expect((await post(site, '/__demo/runs/r1/chromium/x', '[1]')).status).toBe(400);
		expect((await post(site, '/__demo/runs/r1/chromium', '{}')).status).toBe(404);
		expect((await post(site, '/', '{}')).status).toBe(405);
	});
});
