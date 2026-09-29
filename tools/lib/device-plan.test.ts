import { describe, expect, test } from 'bun:test';
import type { BenchResult } from '../../src/shell/result';
import type { BenchItem } from './bench-plan';
import { deviceRunners, judge, parseDeviceArgs, scaleItem, slug } from './device-plan';

const NOW = new Date('2026-09-29T17:20:26.000Z');

describe('device options', () => {
	test('run the bench plan on the named browsers, with the bench tool’s page options', () => {
		const options = parseDeviceArgs(
			['--', '--android', 'chrome,brave', '--lan', 'iPad Safari', '--scenes', 'city', 'Safari'],
			NOW,
		);
		expect(options).toMatchObject({
			plan: 'bench',
			holdFps: null,
			allowNoWebgpu: false,
			mac: ['Safari'],
			android: ['chrome', 'brave'],
			lan: ['ipad-safari'],
			chromium: false,
			run: '20260929-172026-bench',
		});
		expect(options.bench).toMatchObject({ scenes: ['city'], runs: 5, seconds: 30 });
	});

	test('take the scale search with a fixed rate', () => {
		const options = parseDeviceArgs(['--plan', 'scale', '--hold-fps', '30', '--chromium'], NOW);
		expect(options).toMatchObject({ plan: 'scale', holdFps: 30, chromium: true });
		expect(options.run).toBe('20260929-172026-scale');
	});

	test('refuse what does not fit', () => {
		expect(() => parseDeviceArgs([], NOW)).toThrow('Name at least one browser');
		expect(() => parseDeviceArgs(['--plan', 'parity', 'Safari'], NOW)).toThrow('bench or scale');
		expect(() => parseDeviceArgs(['--hold-fps', '0', 'Safari'], NOW)).toThrow('above 0');
		expect(() => parseDeviceArgs(['--url', 'https://example.com', 'Safari'], NOW)).toThrow(
			'Unknown option "--url"',
		);
		expect(() => parseDeviceArgs(['--plan', 'scale', '--counts', '100', 'Safari'], NOW)).toThrow(
			'picks its own counts',
		);
		expect(() => parseDeviceArgs(['--android'], NOW)).toThrow('needs a value');
		expect(() => parseDeviceArgs(['--help'], NOW)).toThrow('Usage: bun run devices');
	});
});

describe('runners', () => {
	test('share a device when they run on one, so they take turns', () => {
		const options = parseDeviceArgs(
			['Brave Browser', '--chromium', '--android', 'chrome', '--lan', 'ipad-safari,ipad-brave'],
			NOW,
		);
		expect(
			deviceRunners(options, 'sm-s926b').map(({ name, device }) => ({ name, device })),
		).toEqual([
			{ name: 'mac-brave-browser', device: 'this-computer' },
			{ name: 'chromium', device: 'this-computer' },
			{ name: 'sm-s926b-chrome', device: 'sm-s926b' },
			{ name: 'ipad-safari', device: 'ipad' },
			{ name: 'ipad-brave', device: 'ipad' },
		]);
		expect(() => deviceRunners(options, null)).toThrow('connected phone');
	});

	test('have names that are safe as file names', () => {
		expect(slug('Google Chrome Canary')).toBe('google-chrome-canary');
		expect(slug(' -SM-S926B- ')).toBe('sm-s926b');
	});
});

describe('scale items and verdicts', () => {
	const options = parseDeviceArgs(['--plan', 'scale', '--chromium'], NOW);

	test('a scale step measures one scene briefly at one count', () => {
		const item = scaleItem(options, 'battle', 'webgpu', 400);
		expect(item.id).toBe('scale-battle-webgpu-400');
		expect(item.path).toBe('/?scene=battle&gpu=webgpu&count=400&bench=5');
		expect(item.timeoutMs).toBe((5 + 5) * 1000 + 90_000);
	});

	test('a WebGPU page on a browser without WebGPU is skipped only when allowed', () => {
		const item = scaleItem(options, 'city', 'webgpu', 100);
		const failed = {
			ok: false as const,
			error: 'three.js could not start: This browser has no WebGPU.',
		};
		expect(judge(item, failed, true)).toBe('skip');
		expect(judge(item, failed, false)).toBe(failed.error);
		const webgl2: BenchItem = { ...item, gpu: 'webgl2' };
		expect(judge(webgl2, failed, true)).toBe(failed.error);
		expect(judge(item, undefined, true)).toContain('no result');
		expect(judge(item, { ok: true, kind: 'bench' } as BenchResult, false)).toBe('pass');
	});
});
