// The one way the page drives an engine. Each engine has an adapter; the page starts, counts,
// measures and stops them all alike.

import type { EngineKind, Measurement, Started, StartOptions } from '../engine/protocol';

export interface EngineAdapter {
	readonly kind: EngineKind;
	/**
	 * Starts the engine on a canvas from `makeCanvas`. An adapter may call it again for a fresh
	 * canvas when it falls back from a worker to the page's thread.
	 */
	start(makeCanvas: () => HTMLCanvasElement, options: StartOptions): Promise<Started>;
	setCount(count: number): void;
	/** Measures the next `milliseconds` of frames. */
	measure(milliseconds: number): Promise<Measurement>;
	/** Live figures, a few times a second. */
	onStats(handler: (measurement: Measurement) => void): void;
	setPaused(paused: boolean): void;
	resize(width: number, height: number, pixelRatio: number): void;
	stop(): void;
}
