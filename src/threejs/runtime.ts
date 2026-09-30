// The three.js side of the demo: it starts a renderer on a canvas, builds a scene, and runs the
// frame loop. It runs in a worker with an OffscreenCanvas where the browser allows it, or on the
// page's thread otherwise. Each frame it runs the fixed simulation steps that are due, writes the
// moving objects, draws, and records the frame's CPU time.

// The classic module loads with the worker anyway: the battle's model loader imports it.
import * as THREE from 'three';
import type { FromEngine, GpuPath, Measurement, StartOptions } from '../engine/protocol';
import { FrameSamples } from '../engine/samples';
import { FixedClock } from '../scenes/common';
import type { SceneId } from '../scenes/index';
import { battleModule } from './battle';
import { buildCity } from './city';
import {
	RENDERER_NAMES,
	type RendererKind,
	type SceneBuild,
	type SceneModule,
	type Three,
} from './common';
import { type Drawer, makeDrawer } from './draw';
import { buildFactory } from './factory';

/** The three.js version the demos pin. */
export const THREE_VERSION = '0.186.1';

/** Scenes drawn with plain batches use the WebGL renderer on WebGL2. */
const onWebGLRenderer = () => 'webgl' as const;

/** Every scene listed in `scenes.ts`, which the page reads without loading three.js. */
const SCENE_MODULES: Partial<Record<SceneId, SceneModule>> = {
	factory: { build: buildFactory, webgl2Renderer: onWebGLRenderer },
	city: { build: buildCity, webgl2Renderer: onWebGLRenderer },
	battle: battleModule,
};

/** How often the live readout gets new figures. */
const STATS_MS = 500;

type AnyRenderer = THREE.WebGLRenderer & {
	init?: () => Promise<unknown>;
	backend?: { isWebGPUBackend?: boolean };
	info: { autoReset: boolean; reset(): void; render: { calls?: number; drawCalls?: number } };
	resolveTimestampsAsync?: (type?: string) => Promise<number | undefined>;
};

export class ThreeRuntime {
	private renderer: AnyRenderer | null = null;
	private build: SceneBuild | null = null;
	private drawer: Drawer | null = null;
	private readonly clock = new FixedClock();
	private readonly samples = new FrameSamples();
	private lastTime = -1;
	private paused = false;
	private drawCalls = 0;
	private gpuFrames = 0;
	private gpuAsking = false;
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
		const module = SCENE_MODULES[options.scene];
		if (!module) throw new Error(`The ${options.scene} scene has no three.js version yet.`);
		const { three, renderer, gpu, kind } = await this.makeRenderer(module);
		this.renderer = renderer;
		renderer.setPixelRatio(options.pixelRatio);
		renderer.setSize(options.width, options.height, false);
		// The same color curve as null3D's default, set on purpose: three.js defaults to none.
		renderer.toneMapping = three.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1;
		renderer.outputColorSpace = three.SRGBColorSpace;
		renderer.shadowMap.enabled = options.effects.shadows;
		renderer.shadowMap.type = three.PCFShadowMap;
		const build = await module.build(three, {
			capacity: options.capacity,
			count: options.count,
			effects: options.effects,
			renderer: kind,
			crowd: options.crowd,
		});
		this.build = build;
		build.camera.aspect = options.width / options.height;
		build.camera.updateProjectionMatrix();
		const skipped = this.clock.skipTo(options.startSeconds);
		for (let i = 0; i < skipped; i++) build.step();
		build.pose(this.clock.time);
		// Build every GPU program before the first frame, so none is built during a measurement.
		await (
			renderer as unknown as { compileAsync: (s: unknown, c: unknown) => Promise<void> }
		).compileAsync(build.scene, build.camera);
		// Post-processing draws count too, so the counts reset once a frame, not once a draw.
		renderer.info.autoReset = false;
		const drawer = await makeDrawer(renderer, kind, build, options.effects.glow, {
			width: options.width,
			height: options.height,
			pixelRatio: options.pixelRatio,
		});
		this.drawer = drawer;
		// One draw before the first frame builds the glow's GPU programs too.
		drawer.render();
		this.post({
			type: 'started',
			started: {
				engine: 'threejs',
				version: `three.js ${THREE_VERSION}`,
				gpu,
				renderer: RENDERER_NAMES[kind],
				inWorker: this.inWorker,
			},
		});
		// A hold frame stays as the warm-up draw left it: no frame loop, no figures.
		if (options.hold) return;
		this.statsTimer = setInterval(() => {
			if (!this.paused)
				this.post({ type: 'stats', measurement: this.summarize(performance.now() - STATS_MS) });
		}, STATS_MS);
		renderer.setAnimationLoop(this.frame);
	}

	private async makeRenderer(
		module: SceneModule,
	): Promise<{ three: Three; renderer: AnyRenderer; gpu: GpuPath; kind: RendererKind }> {
		const { canvas, options } = this;
		const nav = (globalThis as { navigator?: { gpu?: GPU } }).navigator;
		if (options.gpu !== 'webgl2' && nav?.gpu) {
			// Ask for an adapter first. Without one, the WebGPU renderer would fall back to a WebGL2
			// context of its own on this canvas, made without the high-performance setting.
			const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
			if (adapter) {
				const webgpu = await import('three/webgpu');
				const renderer = new webgpu.WebGPURenderer({
					canvas: canvas as HTMLCanvasElement,
					antialias: true,
					powerPreference: 'high-performance',
					trackTimestamp: options.gpuTime,
				}) as unknown as AnyRenderer;
				await renderer.init?.();
				if (renderer.backend?.isWebGPUBackend)
					return { three: webgpu as unknown as Three, renderer, gpu: 'webgpu', kind: 'webgpu' };
				renderer.dispose();
			}
			if (options.gpu === 'webgpu') throw new Error('three.js could not start WebGPU here.');
		} else if (options.gpu === 'webgpu') {
			throw new Error('This browser has no WebGPU.');
		}
		if (module.webgl2Renderer(options) === 'webgpu-webgl2') {
			// The WebGPU renderer's WebGL2 mode makes its context without the GPU choice, so the
			// context is made here, with the attributes that mode asks for.
			const context = (canvas as HTMLCanvasElement).getContext('webgl2', {
				antialias: true,
				alpha: true,
				depth: true,
				stencil: false,
				powerPreference: 'high-performance',
			});
			if (!context) throw new Error('This browser has no WebGL2.');
			const webgpu = await import('three/webgpu');
			const renderer = new webgpu.WebGPURenderer({
				canvas: canvas as HTMLCanvasElement,
				context,
				forceWebGL: true,
				antialias: true,
				trackTimestamp: options.gpuTime,
			} as ConstructorParameters<typeof webgpu.WebGPURenderer>[0]) as unknown as AnyRenderer;
			await renderer.init?.();
			return {
				three: webgpu as unknown as Three,
				renderer,
				gpu: 'webgl2',
				kind: 'webgpu-webgl2',
			};
		}
		const renderer = new THREE.WebGLRenderer({
			canvas: canvas as HTMLCanvasElement,
			antialias: true,
			powerPreference: 'high-performance',
		}) as AnyRenderer;
		return { three: THREE, renderer, gpu: 'webgl2', kind: 'webgl' };
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
		const logic = performance.now() - start;
		build.pose(this.clock.time);
		renderer.info.reset();
		this.drawer?.render();
		const info = renderer.info.render;
		this.drawCalls = info.drawCalls ?? info.calls ?? 0;
		if (interval > 0) this.samples.record(time, interval, performance.now() - start, logic);
		if (this.options.gpuTime) this.readGpuTime(renderer);
	};

	/**
	 * Asks for the GPU time of the frames drawn since the last answer, one question at a time; the
	 * answer covers all of them, so it is shared out per frame.
	 */
	private readGpuTime(renderer: AnyRenderer): void {
		this.gpuFrames++;
		if (this.gpuAsking || !renderer.resolveTimestampsAsync) return;
		this.gpuAsking = true;
		const frames = this.gpuFrames;
		this.gpuFrames = 0;
		renderer
			.resolveTimestampsAsync('render')
			.then((ms) => {
				if (typeof ms === 'number' && ms > 0)
					this.samples.recordGpu(performance.now(), ms / frames);
			})
			.catch(() => {})
			.finally(() => {
				this.gpuAsking = false;
			});
	}

	private summarize(sinceMs: number): Measurement {
		const summary = this.samples.summarize(sinceMs);
		return {
			frames: summary.frames,
			fps: summary.fps,
			frameMsMedian: summary.frameMs[0],
			frameMsP95: summary.frameMs[1],
			cpuMsMedian: summary.cpuMs[0],
			cpuMsP95: summary.cpuMs[1],
			logicMsMedian: summary.logicMs[0],
			logicMsP95: summary.logicMs[1],
			gpuMsMedian: summary.gpuMs?.[0] ?? null,
			gpuMsP95: summary.gpuMs?.[1] ?? null,
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
		if (paused === this.paused || !this.renderer || this.options.hold) return;
		this.paused = paused;
		// A paused engine draws nothing; the first frame after a pause starts a fresh interval.
		this.lastTime = -1;
		this.renderer.setAnimationLoop(paused ? null : this.frame);
	}

	resize(width: number, height: number, pixelRatio: number): void {
		if (!this.renderer || !this.build) return;
		this.renderer.setPixelRatio(pixelRatio);
		this.renderer.setSize(width, height, false);
		this.drawer?.setSize(width, height, pixelRatio);
		this.build.camera.aspect = width / height;
		this.build.camera.updateProjectionMatrix();
		// A hold frame is drawn again at the new size.
		if (this.options.hold) this.drawer?.render();
	}

	stop(): void {
		if (this.statsTimer) clearInterval(this.statsTimer);
		this.renderer?.setAnimationLoop(null);
		this.renderer?.dispose();
		this.renderer = null;
		this.build = null;
		this.drawer = null;
	}
}
