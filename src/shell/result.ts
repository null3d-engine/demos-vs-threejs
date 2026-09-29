// What a page run hands to the measuring tools. The page puts it on `window.__demoResult`, where
// Playwright (tools/bench.ts) and a device's runner page read it, and marks the page body.

import type { Measurement } from '../engine/protocol';
import type { RunFile } from './runs';

/** One fixed-count measurement: `?bench`. */
export interface BenchResult {
	ok: true;
	kind: 'bench';
	scene: string;
	engine: string;
	engineVersion: string;
	gpu: string;
	renderer: string;
	inWorker: boolean;
	deviceClass: string;
	displayHz: number;
	/** The view's size in CSS pixels, and the device pixels drawn per CSS pixel. */
	renderSize: { width: number; height: number; pixelRatio: number };
	count: number;
	effects: string;
	crowd: string;
	gpuTime: boolean;
	warmupSeconds: number;
	seconds: number;
	measurement: Measurement;
	userAgent: string;
}

/** A whole auto-slide: `?auto`. */
export interface AutoResult {
	ok: true;
	kind: 'auto';
	run: RunFile;
}

export interface FailedResult {
	ok: false;
	error: string;
}

export type DemoResult = BenchResult | AutoResult | FailedResult;

/** Hands a result to the tools. */
export function publishResult(result: DemoResult): void {
	(globalThis as { __demoResult?: DemoResult }).__demoResult = result;
	document.body.dataset.result = result.ok ? 'ready' : 'failed';
}
