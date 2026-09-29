// What the page and an engine say to each other. The page talks to every engine the same way, so
// both engines are started, counted and measured alike.

import type { DeviceClass } from '../scenes/device';
import type { Effects } from '../scenes/effects';
import type { SceneId } from '../scenes/index';

export type EngineKind = 'threejs' | 'null3d';

/** The GPU path the page asks for; `auto` lets the engine's feature tests decide. */
export type GpuChoice = 'auto' | 'webgpu' | 'webgl2';

/** The GPU path an engine ended up on. */
export type GpuPath = 'webgpu' | 'webgl2';

/**
 * How three.js draws the battle's crowd on WebGL2: `draw` skins every unit in one draw per model
 * (the WebGPU renderer's WebGL2 mode); `skinned` gives each unit its own skinned mesh (the
 * WebGL renderer). WebGPU always uses `draw`.
 */
export type CrowdWay = 'draw' | 'skinned';
export const CROWD_WAYS: readonly CrowdWay[] = ['draw', 'skinned'];

export interface StartOptions {
	scene: SceneId;
	deviceClass: DeviceClass;
	/** The count to start at. */
	count: number;
	/** The largest count this run may reach: the engine makes this many objects up front. */
	capacity: number;
	effects: Effects;
	gpu: GpuChoice;
	crowd: CrowdWay;
	/** Simulation seconds to run before the first frame, to start the scene at a set time. */
	startSeconds: number;
	/** Canvas size in CSS pixels, and the device pixels per CSS pixel to draw at. */
	width: number;
	height: number;
	pixelRatio: number;
}

export interface Started {
	engine: EngineKind;
	/** The engine's version, such as `three.js 0.186.1`. */
	version: string;
	gpu: GpuPath;
	/** The renderer that draws, such as `WebGPURenderer` or `WebGLRenderer`. */
	renderer: string;
	/** True when the engine draws in a worker; false when it had to draw on the page's thread. */
	inWorker: boolean;
}

/** Frame figures over a stretch of time. */
export interface Measurement {
	frames: number;
	/** Frames drawn per second. */
	fps: number;
	frameMsMedian: number;
	frameMsP95: number;
	/** CPU milliseconds per frame on the engine's busiest thread. */
	cpuMsMedian: number;
	cpuMsP95: number;
	drawCalls: number;
	/** Objects and triangles in the scene at the end of the stretch. */
	objects: number;
	triangles: number;
	count: number;
}

export type ToEngine =
	| { type: 'start'; options: StartOptions; canvas?: OffscreenCanvas }
	| { type: 'count'; count: number }
	| { type: 'measure'; id: number; milliseconds: number }
	| { type: 'pause'; paused: boolean }
	| { type: 'resize'; width: number; height: number; pixelRatio: number }
	| { type: 'stop' };

export type FromEngine =
	| { type: 'started'; started: Started }
	| { type: 'measured'; id: number; measurement: Measurement }
	| { type: 'stats'; measurement: Measurement }
	| { type: 'failed'; message: string };
