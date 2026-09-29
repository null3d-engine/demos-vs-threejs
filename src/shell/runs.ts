// A run: one engine's auto-slide on one device, with every measured step. Runs are saved as JSON
// files to publish, and kept in the browser so the chart can show the other engine's last run.

import type { EngineKind, GpuPath } from '../engine/protocol';
import type { DeviceClass } from '../scenes/device';
import type { RampPlan, SceneId } from '../scenes/index';
import type { StepResult, StopReason } from './ramp';

export interface RunFile {
	format: 'null3d-vs-threejs-run';
	formatVersion: 1;
	scene: SceneId;
	engine: EngineKind;
	/** The engine and its version, such as `three.js 0.186.1`. */
	engineVersion: string;
	gpu: GpuPath;
	/** The renderer that drew, such as `WebGPURenderer` or `WebGLRenderer`. */
	renderer: string;
	inWorker: boolean;
	deviceClass: DeviceClass;
	displayHz: number;
	width: number;
	height: number;
	pixelRatio: number;
	effects: string;
	plan: RampPlan;
	startedAt: string;
	steps: StepResult[];
	heldAtDisplayRate: number;
	heldAtHalfRate: number;
	stopReason: StopReason | null;
	/**
	 * Memory readings of the page and its workers, with the ramp second they arrived at: shared
	 * memory counted once, and what the browser reported.
	 */
	memory: { second: number; bytes: number; measuredBytes: number }[];
	/** Recorded for reference only; nothing is decided from it. */
	userAgent: string;
}

function key(scene: SceneId, deviceClass: DeviceClass, engine: EngineKind): string {
	return `null3d-vs-threejs:run:${scene}:${deviceClass}:${engine}`;
}

/** Keeps a run in this browser. Storage may be missing or full; the page works without it. */
export function keepRun(run: RunFile): void {
	try {
		localStorage.setItem(key(run.scene, run.deviceClass, run.engine), JSON.stringify(run));
	} catch {
		// No storage: the chart just shows no earlier run.
	}
}

/** The last run kept in this browser for a scene, device class and engine, or null. */
export function keptRun(
	scene: SceneId,
	deviceClass: DeviceClass,
	engine: EngineKind,
): RunFile | null {
	try {
		const text = localStorage.getItem(key(scene, deviceClass, engine));
		if (!text) return null;
		const run = JSON.parse(text) as RunFile;
		return run.format === 'null3d-vs-threejs-run' && Array.isArray(run.steps) ? run : null;
	} catch {
		return null;
	}
}

/** Offers the run as a JSON file to save. */
export function downloadRun(run: RunFile): void {
	const blob = new Blob([JSON.stringify(run, null, '\t')], { type: 'application/json' });
	const link = document.createElement('a');
	link.href = URL.createObjectURL(blob);
	link.download = `${run.scene}-${run.engine}-${run.gpu}-${run.deviceClass}-${run.startedAt.replace(/[:.]/g, '-')}.json`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
