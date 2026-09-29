import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	batchTimeoutMs,
	currentRunText,
	finished,
	readResult,
	receivedAt,
	setTurns,
	turnBatches,
	waitForRunners,
	writePlan,
	writeRunnerFile,
} from './device-runs';

const folders: string[] = [];
const tempRoot = () => {
	const folder = mkdtempSync(join(tmpdir(), 'device-runs-'));
	folders.push(folder);
	return folder;
};
afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('turnBatches', () => {
	test('lets one browser per device run at a time, in the order given', () => {
		const runners = [
			{ name: 'mac-safari', device: 'this-computer' },
			{ name: 'chromium', device: 'this-computer' },
			{ name: 'sm-s926b-chrome', device: 'sm-s926b' },
			{ name: 'sm-s926b-brave', device: 'sm-s926b' },
			{ name: 'ipad-safari', device: 'ipad' },
		];
		expect(turnBatches(runners)).toEqual([
			['mac-safari', 'sm-s926b-chrome', 'ipad-safari'],
			['chromium', 'sm-s926b-brave'],
		]);
	});
});

describe('run files', () => {
	test('hold the plan, the turns and each runner’s results', async () => {
		const root = tempRoot();
		expect(currentRunText(root)).toBe('{}');
		const items = [{ id: 'city-webgl2-150-run1', path: '/?scene=city', timeoutMs: 60_000 }];
		expect(writePlan(root, 'r1', items).items).toEqual(items);
		setTurns(root, 'r1', ['chromium']);
		expect(JSON.parse(currentRunText(root))).toEqual({ run: 'r1', turns: ['chromium'] });
		writeRunnerFile(root, 'r1', 'chromium', 'city-webgl2-150-run1', {
			ok: false,
			error: 'no result within 60 s',
			receivedAt: '2026-09-29T17:20:26.000Z',
		});
		const result = readResult(root, 'r1', 'chromium', 'city-webgl2-150-run1');
		expect(result?.ok).toBe(false);
		expect(receivedAt(result)).toBe(Date.parse('2026-09-29T17:20:26.000Z'));
		expect(receivedAt(undefined)).toBeUndefined();
		expect(finished(root, 'r1', 'chromium')).toBe(false);
		writeRunnerFile(root, 'r1', 'chromium', 'done', {});
		expect(await waitForRunners(root, 'r1', ['chromium'], 1_000)).toEqual(['chromium']);
	});

	test('a batch may take every page’s time, plus time to start and between pages', () => {
		const items = [
			{ id: 'a', path: '/', timeoutMs: 60_000 },
			{ id: 'b', path: '/', timeoutMs: 40_000 },
		];
		expect(batchTimeoutMs(items)).toBe(120_000 + 60_000 + 40_000 + 2 * 5_000);
	});
});
