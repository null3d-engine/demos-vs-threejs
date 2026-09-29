// The three.js side of the demo: it starts a renderer on a canvas, builds a scene, and runs the
// frame loop. It runs in a worker with an OffscreenCanvas where the browser allows it, or on the
// page's thread otherwise. Each frame it runs the fixed simulation steps that are due, writes the
// moving objects, draws, and records the frame's CPU time.

import type * as ThreeModule from 'three';
import type { FromEngine, GpuPath, Measurement, StartOptions } from '../engine/protocol';
import { FrameSamples } from '../engine/samples';
import { FixedClock } from '../scenes/common';
import type { SceneId } from '../scenes/index';
import type { Builder, SceneBuild, Three } from './common';
import { buildFactory } from './factory';

/** The three.js version the demos pin. */
export const THREE_VERSION = '0.186.1';

const BUILDERS: Partial<Record<SceneId, Builder>> = {
	factory: buildFactory,
};

/** Scenes with a three.js version so far. */
export function hasThreeScene(scene: SceneId): boolean {
	return BUILDERS[scene] !== undefined;
}

/** How often the live readout gets new figures. */
const STATS_MS = 500;

type AnyRenderer = ThreeModule.WebGLRenderer & {
	init?: () => Promise<unknown>;
	backend?: { isWebGPUBackend?: boolean };
	info: { render: { calls?: number; drawCalls?: number } };
};

export class ThreeRuntime {
	private renderer: AnyRenderer | null = null;
	private build: SceneBuild | null = null;
	private readonly clock = new FixedClock();
	private readonly samples = new FrameSamples();
	private lastTime = -1;
	private paused = false;
	private drawCalls = 0;
	private count: number;
	private statsTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly canvas: OffscreenCanvas | HTMLCanvasElement,
		private readonly options: StartOptions,
		private readonly post: (message: FromEngine) => void,
		private readonly inWorker: boolean,
	) {
		this.count = options.count;
	}

	async start(): Promise<void> {
		const { options } = this;
		const builder = BUILDERS[options.scene];
		if (!builder) throw new Error(`The ${options.scene} scene has no three.js version yet.`);
		const { three, renderer, gpu } = await this.makeRenderer();
		this.renderer = renderer;
		renderer.setPixelRatio(options.pixelRatio);
		renderer.setSize(options.width, options.height, false);
		// The same color curve as null3D's default, set on purpose: three.js defaults to none.
		renderer.toneMapping = three.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1;
		renderer.outputColorSpace = three.SRGBColorSpace;
		renderer.shadowMap.enabled = options.effects.shadows;
		renderer.shadowMap.type = three.PCFShadowMap;
		const build = builder(three, {
			capacity: options.capacity,
			count: options.count,
			effects: options.effects,
		});
		this.build = build;
		build.camera.aspect = options.width / options.height;
		build.camera.updateProjectionMatrix();
		build.pose(0);
		// Build every GPU program before the first frame, so none is built during a measurement.
		await (
			renderer as unknown as { compileAsync: (s: unknown, c: unknown) => Promise<void> }
		).compileAsync(build.scene, build.camera);
		this.post({
			type: 'started',
			started: {
				engine: 'threejs',
				version: `three.js ${THREE_VERSION}`,
				gpu,
				inWorker: this.inWorker,
			},
		});
		this.statsTimer = setInterval(() => {
			if (!this.paused)
				this.post({ type: 'stats', measurement: this.summarize(performance.now() - STATS_MS) });
		}, STATS_MS);
		renderer.setAnimationLoop(this.frame);
	}

	private async makeRenderer(): Promise<{ three: Three; renderer: AnyRenderer; gpu: GpuPath }> {
		const { canvas, options } = this;
		const nav = (globalThis as { navigator?: { gpu?: unknown } }).navigator;
		if (options.gpu !== 'webgl2' && nav?.gpu) {
			const webgpu = await import('three/webgpu');
			const renderer = new webgpu.WebGPURenderer({
				canvas: canvas as HTMLCanvasElement,
				antialias: true,
				powerPreference: 'high-performance',
			}) as unknown as AnyRenderer;
			await renderer.init?.();
			if (renderer.backend?.isWebGPUBackend)
				return { three: webgpu as unknown as Three, renderer, gpu: 'webgpu' };
			renderer.dispose();
			if (options.gpu === 'webgpu') throw new Error('three.js could not start WebGPU here.');
		} else if (options.gpu === 'webgpu') {
			throw new Error('This browser has no WebGPU.');
		}
		const three = await import('three');
		const renderer = new three.WebGLRenderer({
			canvas: canvas as HTMLCanvasElement,
			antialias: true,
			powerPreference: 'high-performance',
		}) as AnyRenderer;
		return { three, renderer, gpu: 'webgl2' };
	}

	private readonly frame = (time: number): void => {
		const renderer = this.renderer;
		const build = this.build;
		if (!renderer || !build) return;
		const start = performance.now();
		const interval = this.lastTime < 0 ? 0 : time - this.lastTime;
		this.lastTime = time;
		const steps = this.clock.advance(interval / 1000);
		for (let i = 0; i < steps; i++) build.step();
		build.pose(this.clock.time);
		renderer.render(build.scene, build.camera);
		const info = renderer.info.render;
		this.drawCalls = info.drawCalls ?? info.calls ?? 0;
		if (interval > 0) this.samples.record(time, interval, performance.now() - start);
	};

	private summarize(sinceMs: number): Measurement {
		const summary = this.samples.summarize(sinceMs);
		return {
			frames: summary.frames,
			fps: summary.fps,
			frameMsMedian: summary.frameMs[0] as number,
			frameMsP95: summary.frameMs[1] as number,
			cpuMsMedian: summary.cpuMs[0] as number,
			cpuMsP95: summary.cpuMs[1] as number,
			drawCalls: this.drawCalls,
			objects: this.build?.objects() ?? 0,
			triangles: this.build?.triangles() ?? 0,
			count: this.count,
		};
	}

	setCount(count: number): void {
		this.count = count;
		this.build?.setCount(count);
	}

	/** Measures the next `milliseconds` of frames and posts the result. */
	measure(id: number, milliseconds: number): void {
		const since = performance.now();
		setTimeout(
			() => this.post({ type: 'measured', id, measurement: this.summarize(since) }),
			milliseconds,
		);
	}

	setPaused(paused: boolean): void {
		if (paused === this.paused || !this.renderer) return;
		this.paused = paused;
		// A paused engine draws nothing; the first frame after a pause starts a fresh interval.
		this.lastTime = -1;
		this.renderer.setAnimationLoop(paused ? null : this.frame);
	}

	resize(width: number, height: number, pixelRatio: number): void {
		if (!this.renderer || !this.build) return;
		this.renderer.setPixelRatio(pixelRatio);
		this.renderer.setSize(width, height, false);
		this.build.camera.aspect = width / height;
		this.build.camera.updateProjectionMatrix();
	}

	stop(): void {
		if (this.statsTimer) clearInterval(this.statsTimer);
		this.renderer?.setAnimationLoop(null);
		this.renderer?.dispose();
		this.renderer = null;
		this.build = null;
	}
}
