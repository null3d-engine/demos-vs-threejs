import { describe, expect, test } from 'bun:test';
import { SCENES } from '../../src/scenes/index';
import { parseRecordArgs, recordings } from './record-plan';

const NOW = new Date('2026-09-29T17:20:26.000Z');

describe('record options', () => {
	test('default to each scene on WebGPU, 60 frames at 20 per second, with a GIF', () => {
		expect(parseRecordArgs([], NOW)).toMatchObject({
			scenes: ['factory', 'city', 'battle'],
			gpus: ['webgpu'],
			count: null,
			from: null,
			frames: 60,
			fps: 20,
			gifWidth: 480,
			viewport: { width: 1280, height: 800 },
			out: 'runs/record/20260929-172026-record',
			gpu: 'hardware',
		});
	});

	test('take a video frame rate that is whole simulation steps, and other sizes', () => {
		const options = parseRecordArgs(
			['--', '--fps', '60', '--no-gif', '--viewport', '1920x1080', '--from', '7.5'],
			NOW,
		);
		expect(options).toMatchObject({
			fps: 60,
			gifWidth: null,
			viewport: { width: 1920, height: 1080 },
			from: 7.5,
		});
		expect(() => parseRecordArgs(['--fps', '25'], NOW)).toThrow('whole number');
		expect(() => parseRecordArgs(['--viewport', 'wide'], NOW)).toThrow('1920x1080');
		expect(() => parseRecordArgs(['--from', '-1'], NOW)).toThrow('from 0');
		expect(() => parseRecordArgs(['--scenes', 'moon'], NOW)).toThrow('not a scene');
		expect(() => parseRecordArgs(['--help'], NOW)).toThrow('Usage: bun run record');
	});
});

describe('recordings', () => {
	test('draw each frame as a hold frame, one frame step of scene time apart', () => {
		const options = parseRecordArgs(['--scenes', 'battle', '--frames', '3', '--fps', '24'], NOW);
		const [battle] = recordings(options);
		const { hold } = SCENES.battle;
		expect(battle?.name).toBe('battle-webgpu');
		expect(battle?.frames.map((frame) => frame.seconds)).toEqual([
			hold.seconds,
			hold.seconds + 5 / 120,
			hold.seconds + 10 / 120,
		]);
		expect(battle?.frames[0]?.path).toBe(
			`/?scene=battle&gpu=webgpu&count=${hold.count}&at=${hold.seconds}&hold=1&full=1`,
		);
	});

	test('keep frame times on whole simulation steps over a long run', () => {
		const options = parseRecordArgs(
			['--scenes', 'city', '--from', '1', '--frames', '600', '--fps', '60'],
			NOW,
		);
		const [city] = recordings(options);
		for (const [i, frame] of (city?.frames ?? []).entries())
			expect(Math.round(frame.seconds * 120)).toBe(120 + 2 * i);
	});

	test('refuse frames past the latest time the page draws', () => {
		const options = parseRecordArgs(['--from', '599', '--frames', '100', '--fps', '20'], NOW);
		expect(() => recordings(options)).toThrow('up to 600 s');
	});
});
