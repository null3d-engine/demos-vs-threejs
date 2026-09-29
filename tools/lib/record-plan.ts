// What `bun run record` draws. Pure: tools/record.ts loads the pages. Each frame is a hold frame
// at a later scene time, so every frame is exact however slowly it draws, and a recording can have
// any frame rate.

import { SIM_STEP } from '../../src/scenes/common';
import { SCENES, type SceneId } from '../../src/scenes/index';
import { MAX_START_SECONDS } from '../../src/shell/slider';
import { THREE_SCENES } from '../../src/threejs/scenes';
import type { BenchGpu } from './bench-plan';
import { runName } from './bench-plan';

export interface RecordOptions {
	scenes: SceneId[];
	gpus: BenchGpu[];
	/** The count for every scene; null uses each scene's hold count. */
	count: number | null;
	/** The scene time of the first frame in seconds; null uses each scene's hold time. */
	from: number | null;
	frames: number;
	/** Frames per second of scene time; each frame is a whole number of simulation steps. */
	fps: number;
	/** Effect switches as page text, such as `fog,glow`; null keeps each scene's own effects. */
	effects: string | null;
	/** The GIF's width in pixels, or null for no GIF. */
	gifWidth: number | null;
	viewport: { width: number; height: number };
	out: string;
	url: string | null;
	gpu: 'software' | 'hardware';
	chrome: string | null;
}

export const RECORD_USAGE = `Usage: bun run record [options]

Draws a run of hold frames, one page load per frame at a later scene time, and saves them as PNG
files (for a video: ffmpeg -framerate <fps> -i frame-%04d.png ...) and as a GIF. The scene fills
the page, so each frame is the viewport's size.

Options:
  --scenes <list>     Scenes, separated by commas (default: ${THREE_SCENES.join(',')})
  --gpus <list>       GPU paths: webgpu, webgl2 (default: webgpu)
  --count <n>         The count for every scene (default: each scene's hold count)
  --from <seconds>    Scene time of the first frame (default: each scene's hold time)
  --frames <n>        Frames to draw (default: 60)
  --fps <n>           Frames per second of scene time; 120 / fps must be a whole number
                      (default: 20)
  --effects <list>    Effect switches, such as fog,glow (default: each scene's own)
  --gif <width>       The GIF's width in pixels (default: 480)
  --no-gif            Save PNG files only
  --viewport <WxH>    The page size in CSS pixels, which is each frame's size (default: 1280x800)
  --out <folder>      Where the files go (default: runs/record/<time>-record)
  --url <address>     Record a published site instead of building this checkout
  --gpu <kind>        hardware (this machine's GPU in Google Chrome, the default) or software
  --chrome <path>     Run this Chrome or Chromium instead
  --help              Show this text`;

function positive(name: string, text: string): number {
	const value = Number(text);
	if (!Number.isFinite(value) || value <= 0)
		throw new Error(`${name} takes a number above 0, not "${text}".`);
	return value;
}

/** Steps of the fixed-step simulation per second. */
const STEPS_PER_SECOND = Math.round(1 / SIM_STEP);

export function parseRecordArgs(args: readonly string[], now = new Date()): RecordOptions {
	const options: RecordOptions = {
		scenes: [...THREE_SCENES],
		gpus: ['webgpu'],
		count: null,
		from: null,
		frames: 60,
		fps: 20,
		effects: null,
		gifWidth: 480,
		viewport: { width: 1280, height: 800 },
		out: `runs/record/${runName('record', now)}`,
		url: null,
		gpu: 'hardware',
		chrome: null,
	};
	for (let i = 0; i < args.length; i++) {
		const name = args[i] as string;
		const value = () => {
			const next = args[++i];
			if (next === undefined || next.startsWith('--'))
				throw new Error(`${name} needs a value.\n\n${RECORD_USAGE}`);
			return next;
		};
		switch (name) {
			case '--':
				break;
			case '--scenes': {
				const scenes = value()
					.split(',')
					.map((scene) => scene.trim());
				for (const scene of scenes)
					if (!(THREE_SCENES as readonly string[]).includes(scene))
						throw new Error(`"${scene}" is not a scene with a three.js version.`);
				options.scenes = scenes as SceneId[];
				break;
			}
			case '--gpus': {
				const gpus = value()
					.split(',')
					.map((gpu) => gpu.trim());
				for (const gpu of gpus)
					if (gpu !== 'webgpu' && gpu !== 'webgl2')
						throw new Error(`--gpus takes webgpu and webgl2, not "${gpu}".`);
				options.gpus = gpus as BenchGpu[];
				break;
			}
			case '--count':
				options.count = Math.round(positive(name, value()));
				break;
			case '--from': {
				const text = value();
				const from = Number(text);
				if (!Number.isFinite(from) || from < 0)
					throw new Error(`--from takes a number of seconds from 0, not "${text}".`);
				options.from = from;
				break;
			}
			case '--frames':
				options.frames = Math.round(positive(name, value()));
				break;
			case '--fps': {
				const fps = positive(name, value());
				if (!Number.isInteger(STEPS_PER_SECOND / fps))
					throw new Error(
						`--fps ${fps}: ${STEPS_PER_SECOND} / fps must be a whole number, so that each frame is whole simulation steps (such as 120, 60, 30, 24, 20, 12 or 10).`,
					);
				options.fps = fps;
				break;
			}
			case '--effects':
				options.effects = value();
				break;
			case '--gif':
				options.gifWidth = Math.round(positive(name, value()));
				break;
			case '--no-gif':
				options.gifWidth = null;
				break;
			case '--viewport': {
				const text = value();
				const match = /^(\d+)x(\d+)$/.exec(text);
				if (!match) throw new Error(`--viewport takes a size such as 1920x1080, not "${text}".`);
				options.viewport = { width: Number(match[1]), height: Number(match[2]) };
				break;
			}
			case '--out':
				options.out = value();
				break;
			case '--url':
				options.url = value().replace(/\/+$/, '');
				break;
			case '--gpu': {
				const gpu = value();
				if (gpu !== 'software' && gpu !== 'hardware')
					throw new Error(`--gpu takes software or hardware, not "${gpu}".`);
				options.gpu = gpu;
				break;
			}
			case '--chrome':
				options.chrome = value();
				break;
			case '--help':
				throw new Error(RECORD_USAGE);
			default:
				throw new Error(`Unknown option "${name}".\n\n${RECORD_USAGE}`);
		}
	}
	return options;
}

/** One recording: a scene on a GPU path, and the page of each of its frames. */
export interface Recording {
	/** Its folder and GIF name, such as `battle-webgpu`. */
	name: string;
	scene: SceneId;
	gpu: BenchGpu;
	count: number;
	/** The scene time of each frame, and the page that draws it. */
	frames: { seconds: number; path: string }[];
}

export function recordings(options: RecordOptions): Recording[] {
	const list: Recording[] = [];
	for (const scene of options.scenes) {
		const { hold } = SCENES[scene];
		const count = options.count ?? hold.count;
		const from = options.from ?? hold.seconds;
		// Frame times on whole simulation steps, counted in steps so that no rounding builds up.
		const firstStep = Math.round(from * STEPS_PER_SECOND);
		const stepsPerFrame = STEPS_PER_SECOND / options.fps;
		for (const gpu of options.gpus) {
			const frames = Array.from({ length: options.frames }, (_, i) => {
				const seconds = (firstStep + i * stepsPerFrame) / STEPS_PER_SECOND;
				const params = new URLSearchParams({
					scene,
					gpu,
					count: String(count),
					at: String(seconds),
					hold: '1',
					full: '1',
				});
				if (options.effects !== null) params.set('effects', options.effects);
				return { seconds, path: `/?${params}` };
			});
			const last = frames.at(-1)?.seconds ?? 0;
			if (last > MAX_START_SECONDS)
				throw new Error(
					`${scene}: the last frame falls at ${last} s; the page draws hold frames up to ${MAX_START_SECONDS} s.`,
				);
			list.push({ name: `${scene}-${gpu}`, scene, gpu, count, frames });
		}
	}
	return list;
}
