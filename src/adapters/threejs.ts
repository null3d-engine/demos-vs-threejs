// Drives the tuned three.js version: in one worker with an OffscreenCanvas where the browser
// allows it, or on the page's thread where it does not (Safari before 17 has no WebGL2 in workers).

import type { FromEngine, Measurement, Started, StartOptions, ToEngine } from '../engine/protocol';
import { ThreeRuntime } from '../threejs/runtime';
import type { EngineAdapter } from './types';

export class ThreeAdapter implements EngineAdapter {
	readonly kind = 'threejs' as const;
	private worker: Worker | null = null;
	private runtime: ThreeRuntime | null = null;
	private readonly pending = new Map<number, (measurement: Measurement) => void>();
	private nextId = 1;
	private statsHandler: ((measurement: Measurement) => void) | null = null;

	async start(makeCanvas: () => HTMLCanvasElement, options: StartOptions): Promise<Started> {
		try {
			return await this.startSomewhere(makeCanvas, options);
		} catch (error) {
			// Some browsers offer WebGPU but fail on what three.js asks of it. In auto mode, WebGL2 is
			// the next path, on a fresh canvas: a canvas keeps the first kind of context it gave out.
			if (options.gpu !== 'auto') throw error;
			console.warn('three.js could not start on WebGPU; starting on WebGL2.', error);
			this.stop();
			return this.startSomewhere(makeCanvas, { ...options, gpu: 'webgl2' });
		}
	}

	private async startSomewhere(
		makeCanvas: () => HTMLCanvasElement,
		options: StartOptions,
	): Promise<Started> {
		const canvas = makeCanvas();
		if (typeof canvas.transferControlToOffscreen === 'function' && typeof Worker !== 'undefined') {
			try {
				return await this.startInWorker(canvas, options);
			} catch (error) {
				this.stopWorker();
				console.warn('three.js could not draw in a worker; drawing on the page thread.', error);
			}
		}
		return this.startOnPage(makeCanvas(), options);
	}

	private startInWorker(canvas: HTMLCanvasElement, options: StartOptions): Promise<Started> {
		const offscreen = canvas.transferControlToOffscreen();
		const worker = new Worker(new URL('../threejs/worker.ts', import.meta.url), { type: 'module' });
		this.worker = worker;
		return new Promise((resolve, reject) => {
			worker.onmessage = (event: MessageEvent<FromEngine>) => {
				const message = event.data;
				if (message.type === 'started') resolve(message.started);
				else if (message.type === 'failed') reject(new Error(message.message));
				else this.receive(message);
			};
			worker.onerror = (event) =>
				reject(new Error(event.message || 'The three.js worker failed to load.'));
			this.send({ type: 'start', options, canvas: offscreen }, [offscreen]);
		});
	}

	private async startOnPage(canvas: HTMLCanvasElement, options: StartOptions): Promise<Started> {
		let started: Started | null = null;
		const runtime = new ThreeRuntime(
			canvas,
			options,
			(message) => {
				if (message.type === 'started') started = message.started;
				else if (message.type === 'failed') throw new Error(message.message);
				else this.receive(message);
			},
			false,
		);
		this.runtime = runtime;
		await runtime.start();
		if (!started) throw new Error('three.js did not start.');
		return started;
	}

	private receive(message: FromEngine): void {
		if (message.type === 'measured') {
			this.pending.get(message.id)?.(message.measurement);
			this.pending.delete(message.id);
		} else if (message.type === 'stats') {
			this.statsHandler?.(message.measurement);
		}
	}

	private send(message: ToEngine, transfer: Transferable[] = []): void {
		this.worker?.postMessage(message, transfer);
	}

	setCount(count: number): void {
		if (this.runtime) this.runtime.setCount(count);
		else this.send({ type: 'count', count });
	}

	measure(milliseconds: number): Promise<Measurement> {
		const id = this.nextId++;
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			if (this.runtime) this.runtime.measure(id, milliseconds);
			else this.send({ type: 'measure', id, milliseconds });
		});
	}

	onStats(handler: (measurement: Measurement) => void): void {
		this.statsHandler = handler;
	}

	setPaused(paused: boolean): void {
		if (this.runtime) this.runtime.setPaused(paused);
		else this.send({ type: 'pause', paused });
	}

	resize(width: number, height: number, pixelRatio: number): void {
		if (this.runtime) this.runtime.resize(width, height, pixelRatio);
		else this.send({ type: 'resize', width, height, pixelRatio });
	}

	private stopWorker(): void {
		this.worker?.terminate();
		this.worker = null;
	}

	stop(): void {
		if (this.runtime) {
			this.runtime.stop();
			this.runtime = null;
		}
		if (this.worker) {
			this.send({ type: 'stop' });
			// The worker closes itself after it releases the GPU; this is a backstop.
			const worker = this.worker;
			setTimeout(() => worker.terminate(), 1000);
			this.worker = null;
		}
		this.pending.clear();
	}
}
