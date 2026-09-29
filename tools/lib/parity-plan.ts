// What `bun run parity` compares, and how it reports. Pure: tools/parity.ts loads the pages.

import { MAX_DIFFERENT_PERCENT, percent } from '../../src/measure/parity';
import { SCENES, type SceneId } from '../../src/scenes/index';
import { THREE_SCENES } from '../../src/threejs/scenes';

/** A page that draws hold frames: an engine on one GPU path. null3D joins at its first release. */
export const FRAME_SOURCES = ['threejs-webgl2', 'threejs-webgpu'] as const;
export type FrameSource = (typeof FRAME_SOURCES)[number];

const GPU_OF: Readonly<Record<FrameSource, 'webgl2' | 'webgpu'>> = {
	'threejs-webgl2': 'webgl2',
	'threejs-webgpu': 'webgpu',
};

/** Two sources whose frames are compared; the diff image dims the reference's frame. */
export interface FramePair {
	candidate: FrameSource;
	reference: FrameSource;
}

/**
 * three.js's two renderers on the same frame: how much two faithful drawings of a scene differ.
 * An engine passes when it differs from three.js no more than this (see passesWithBaseline).
 */
export const BASELINE_PAIR: FramePair = {
	candidate: 'threejs-webgl2',
	reference: 'threejs-webgpu',
};

export interface ParityOptions {
	scenes: SceneId[];
	/** Effect switches as page text, such as `fog,glow`; null keeps each scene's own effects. */
	effects: string | null;
	/** Where the frames, diffs and report go. */
	out: string;
	/** A site to check, such as a Cloudflare Pages preview; null builds and serves this checkout. */
	url: string | null;
	/** `software`: SwiftShader, the same on every machine. `hardware`: the machine's own GPU. */
	gpu: 'software' | 'hardware';
	/** A Chrome or Chromium to run instead of Playwright's own. */
	chrome: string | null;
}

export const PARITY_USAGE = `Usage: bun run parity [options]

Draws each scene's hold frame with three.js on WebGL2 and on WebGPU, compares them with three.js's
image rule, and writes the frames, the diff images and a report.

Options:
  --scenes <list>     Scenes, separated by commas (default: ${THREE_SCENES.join(',')})
  --effects <list>    Effect switches for every scene, such as fog,glow (default: each scene's own)
  --out <folder>      Where the files go (default: runs/parity)
  --url <address>     Check a published site instead of building this checkout
  --gpu <kind>        software (SwiftShader, the default) or hardware (this machine's GPU)
  --chrome <path>     Run this Chrome or Chromium instead of Playwright's own
  --help              Show this text`;

export function parseParityArgs(args: readonly string[]): ParityOptions {
	const options: ParityOptions = {
		scenes: [...THREE_SCENES],
		effects: null,
		out: 'runs/parity',
		url: null,
		gpu: 'software',
		chrome: null,
	};
	for (let i = 0; i < args.length; i++) {
		const name = args[i] as string;
		const value = () => {
			const next = args[++i];
			if (next === undefined || next.startsWith('--'))
				throw new Error(`${name} needs a value.\n\n${PARITY_USAGE}`);
			return next;
		};
		switch (name) {
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
			case '--effects':
				options.effects = value();
				break;
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
				throw new Error(PARITY_USAGE);
			default:
				throw new Error(`Unknown option "${name}".\n\n${PARITY_USAGE}`);
		}
	}
	return options;
}

/** The page address that draws a scene's hold frame from a source. */
export function holdPath(scene: SceneId, source: FrameSource, effects: string | null): string {
	const { hold } = SCENES[scene];
	const params = new URLSearchParams({
		scene,
		gpu: GPU_OF[source],
		count: String(hold.count),
		at: String(hold.seconds),
		hold: '1',
	});
	if (effects !== null) params.set('effects', effects);
	return `/?${params}`;
}

/** One line of the report: a scene's pair and how much its frames differ. */
export interface ParityRow {
	scene: SceneId;
	pair: FramePair;
	/** The differing pixels' share, or null when a source could not draw here. */
	share: number | null;
	/** Why there is no share, such as "no WebGPU in this browser". */
	note?: string;
}

/** The report as Markdown text. */
export function parityReport(rows: readonly ParityRow[], options: ParityOptions): string {
	const lines = [
		'# Image check',
		'',
		`GPU: ${options.gpu}. Effects: ${options.effects ?? "each scene's own"}. Rule: a pixel differs past 0.1 of the black-to-white distance; frames match under ${MAX_DIFFERENT_PERCENT}% of pixels.`,
		'',
		'| Scene | Candidate | Reference | Pixels that differ | Matches by three.js’s rule |',
		'| --- | --- | --- | --- | --- |',
	];
	for (const row of rows) {
		const share = row.share === null ? (row.note ?? 'not drawn') : percent(row.share);
		const match = row.share === null ? '-' : row.share * 100 < MAX_DIFFERENT_PERCENT ? 'yes' : 'no';
		lines.push(
			`| ${row.scene} | ${row.pair.candidate} | ${row.pair.reference} | ${share} | ${match} |`,
		);
	}
	lines.push(
		'',
		'The three.js WebGL2 against WebGPU rows are the baseline: an engine passes a GPU path when it differs from three.js by less than the rule allows, or by no more than the baseline.',
		'',
	);
	return lines.join('\n');
}
