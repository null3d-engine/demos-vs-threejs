// The demo page: it picks the scene, engine and GPU path, starts one engine at a time, and runs the
// count slider, the auto-slide, the live readout, the chart and the result card.

import { ThreeAdapter } from '../adapters/threejs';
import type { EngineAdapter } from '../adapters/types';
import type { EngineKind, GpuChoice, Measurement, Started } from '../engine/protocol';
import { type DeviceClass, deviceClass, renderPixelRatio } from '../scenes/device';
import { type Effects, effectsFromText, effectsOf, effectsToText } from '../scenes/effects';
import { SCENE_IDS, SCENES, type SceneId } from '../scenes/index';
import { hasThreeScene } from '../threejs/runtime';
import { type ChartSeries, drawChart, ENGINE_NAMES } from './chart';
import { measureDisplayHz } from './display';
import { isolationProblem } from './isolation';
import { MemoryReader } from './memory';
import {
	GAP_SECONDS,
	RampTracker,
	rampCount,
	SETTLE_SECONDS,
	STEP_SECONDS,
	STOP_FPS,
	type StopReason,
} from './ramp';
import { downloadRun, keepRun, keptRun, type RunFile } from './runs';
import {
	countRange,
	countToSlider,
	formatCount,
	formatMegabytes,
	formatShort,
	sliderToCount,
	startCount,
} from './slider';

const STOP_TEXT: Readonly<Record<StopReason, string>> = {
	'below-display-rate': 'it stayed below the display rate for 3 seconds after second 20',
	'too-slow': 'the frame rate stayed under the floor for 3 seconds',
	maximum: 'it reached the most objects the scene holds',
};

function element<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`The page has no #${id}.`);
	return found as T;
}

function pick<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
	return value !== null && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function sleepUntil(time: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, time - performance.now())));
}

export async function startPage(): Promise<void> {
	const view = element<HTMLDivElement>('view');
	const readout = element<HTMLPreElement>('readout');
	const slider = element<HTMLInputElement>('count');
	const countLabel = element<HTMLLabelElement>('count-label');
	const countValue = element<HTMLOutputElement>('count-value');
	const autoButton = element<HTMLButtonElement>('auto');
	const pauseButton = element<HTMLButtonElement>('pause');
	const saveButton = element<HTMLButtonElement>('save');
	const engineSelect = element<HTMLSelectElement>('engine');
	const gpuSelect = element<HTMLSelectElement>('gpu');
	const chart = element<HTMLCanvasElement>('chart');
	const result = element<HTMLDivElement>('result');
	const status = element<HTMLParagraphElement>('status');
	const sceneButtons = [...document.querySelectorAll<HTMLButtonElement>('.scenes button')];

	const params = new URLSearchParams(location.search);
	let scene = pick<SceneId>(params.get('scene'), SCENE_IDS, 'factory');
	if (!hasThreeScene(scene)) scene = 'factory';
	let engine = pick<EngineKind>(params.get('engine'), ['threejs'], 'threejs');
	let gpu = pick<GpuChoice>(params.get('gpu'), ['auto', 'webgpu', 'webgl2'], 'auto');
	const effectsParam = params.get('effects');
	let effects: Effects =
		effectsParam === null ? effectsOf(SCENES[scene].effects) : effectsFromText(effectsParam);
	const cls: DeviceClass = deviceClass({
		shortSideCss: Math.min(screen.width, screen.height),
		coarsePointer: matchMedia('(pointer: coarse)').matches,
	});
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

	const problem = isolationProblem({
		crossOriginIsolated: globalThis.crossOriginIsolated,
		sharedMemory: typeof SharedArrayBuffer !== 'undefined',
	});
	status.textContent = 'Measuring the display rate.';
	const displayHz = await measureDisplayHz();

	let adapter: EngineAdapter | null = null;
	let started: Started | null = null;
	let count = startCount(params.get('count'), SCENES[scene].ramp[cls]);
	let ramping = false;
	let rampSecond = -1;
	let tracker: RampTracker | null = null;
	let lastRun: RunFile | null = null;
	let userPaused = reducedMotion;
	let offScreen = false;
	let last: Measurement | null = null;
	const memory = new MemoryReader();
	const memoryLog: { second: number; bytes: number }[] = [];
	let rampStartedAt = 0;

	const range = () => countRange(SCENES[scene].ramp[cls]);

	const renderSize = () => {
		const pixelRatio = renderPixelRatio(cls, window.devicePixelRatio);
		return {
			width: Math.max(1, view.clientWidth),
			height: Math.max(1, view.clientHeight),
			pixelRatio,
		};
	};

	const makeCanvas = () => {
		for (const old of view.querySelectorAll('canvas')) old.remove();
		const canvas = document.createElement('canvas');
		const size = renderSize();
		canvas.width = Math.round(size.width * size.pixelRatio);
		canvas.height = Math.round(size.height * size.pixelRatio);
		view.insertBefore(canvas, readout);
		return canvas;
	};

	const writeReadout = () => {
		if (!started) {
			readout.textContent = '';
			return;
		}
		const info = SCENES[scene];
		const size = renderSize();
		const lines = [
			`${started.version} · ${started.gpu === 'webgpu' ? 'WebGPU' : 'WebGL2'} · ${started.inWorker ? 'worker' : 'page thread'}`,
			`${displayHz} Hz display · ${cls} · pixel ratio ${size.pixelRatio}`,
		];
		if (last) {
			lines.push(
				`${last.fps.toFixed(1)} fps · frame ${last.frameMsMedian.toFixed(1)} ms (95th ${last.frameMsP95.toFixed(1)})`,
				`CPU ${last.cpuMsMedian.toFixed(2)} ms per frame (95th ${last.cpuMsP95.toFixed(2)})`,
				`Draw calls ${formatCount(last.drawCalls)}`,
				`${formatCount(last.count)} ${info.countUnit}`,
				`Objects ${formatCount(last.objects)} · triangles ${formatShort(last.triangles)}`,
			);
		}
		const reading = memory.last;
		lines.push(
			reading
				? `Memory ${formatMegabytes(reading.bytes)}, ${Math.round((performance.now() - reading.at) / 1000)} s ago`
				: 'Memory: not available in this browser',
		);
		if (ramping) lines.push(`Auto-slide: second ${Math.max(0, rampSecond)}`);
		if (userPaused || offScreen || document.hidden) lines.push('Paused');
		readout.textContent = lines.join('\n');
	};

	const showCount = () => {
		const { min, max } = range();
		slider.value = String(countToSlider(count, min, max));
		countValue.textContent = formatCount(count);
	};

	const redrawChart = () => {
		const { min, max } = range();
		const series: ChartSeries[] = [];
		const other: EngineKind = engine === 'threejs' ? 'null3d' : 'threejs';
		const earlier = keptRun(scene, cls, other);
		if (earlier) {
			series.push({
				engine: other,
				faint: true,
				points: earlier.steps.map((step) => ({ count: step.count, frameMs: step.frameMs })),
			});
		}
		const current = tracker?.steps ?? lastRun?.steps ?? [];
		series.push({
			engine,
			faint: false,
			points: current.map((step) => ({ count: step.count, frameMs: step.frameMs })),
		});
		drawChart(chart, series, min, max, displayHz);
	};

	const applyPause = () => {
		const paused = userPaused || offScreen || document.hidden;
		adapter?.setPaused(paused);
		pauseButton.setAttribute('aria-pressed', String(userPaused));
		pauseButton.textContent = userPaused ? 'Resume' : 'Pause';
		writeReadout();
	};

	const stopRamp = () => {
		ramping = false;
		autoButton.textContent = 'Auto-slide';
		autoButton.setAttribute('aria-pressed', 'false');
	};

	const startEngine = async () => {
		stopRamp();
		adapter?.stop();
		memory.stop();
		started = null;
		last = null;
		lastRun = null;
		tracker = null;
		result.hidden = true;
		saveButton.disabled = true;
		for (const button of sceneButtons)
			button.setAttribute('aria-current', String(button.dataset.scene === scene));
		countLabel.textContent = `Count (${SCENES[scene].countUnit})`;
		showCount();
		redrawChart();
		status.textContent = `Starting ${ENGINE_NAMES[engine]}.`;
		const next: EngineAdapter = new ThreeAdapter();
		adapter = next;
		adapter.onStats((measurement) => {
			last = measurement;
			writeReadout();
		});
		const size = renderSize();
		try {
			started = await next.start(makeCanvas, {
				scene,
				deviceClass: cls,
				count,
				capacity: SCENES[scene].ramp[cls].max,
				effects,
				gpu,
				width: size.width,
				height: size.height,
				pixelRatio: size.pixelRatio,
			});
		} catch (error) {
			status.textContent = `${ENGINE_NAMES[engine]} could not start: ${error instanceof Error ? error.message : String(error)}`;
			return;
		}
		if (adapter !== next) return;
		memory.start(() => writeReadout());
		status.textContent = [
			problem,
			reducedMotion
				? 'Your system asks for less motion, so the demo starts paused. Press Resume to start it.'
				: null,
		]
			.filter(Boolean)
			.join(' ');
		applyPause();
	};

	const runRamp = async () => {
		const running = adapter;
		if (!running || !started) return;
		ramping = true;
		userPaused = false;
		applyPause();
		autoButton.textContent = 'Stop auto-slide';
		autoButton.setAttribute('aria-pressed', 'true');
		result.hidden = true;
		saveButton.disabled = true;
		const plan = SCENES[scene].ramp[cls];
		tracker = new RampTracker(plan, displayHz, STOP_FPS[cls]);
		memoryLog.length = 0;
		rampStartedAt = performance.now();
		const startedAt = new Date().toISOString();
		const size = renderSize();
		for (let step = 0; ramping && adapter === running; step++) {
			const stepStart = rampStartedAt + step * STEP_SECONDS * 1000;
			await sleepUntil(stepStart);
			if (!ramping || adapter !== running) break;
			rampSecond = step * STEP_SECONDS;
			count = rampCount(plan, rampSecond);
			running.setCount(count);
			showCount();
			await sleepUntil(stepStart + SETTLE_SECONDS * 1000);
			const measured = await running.measure((STEP_SECONDS - SETTLE_SECONDS) * 1000);
			if (!ramping || adapter !== running) break;
			if (
				memory.last &&
				(memoryLog.length === 0 || memoryLog[memoryLog.length - 1]?.bytes !== memory.last.bytes)
			) {
				memoryLog.push({ second: rampSecond, bytes: memory.last.bytes });
			}
			const stop = tracker.add({
				step,
				count,
				fps: measured.fps,
				frameMs: measured.frameMsMedian,
				frameMsP95: measured.frameMsP95,
				cpuMs: measured.cpuMsMedian,
			});
			redrawChart();
			if (stop) break;
		}
		const finished = tracker;
		const ended = ramping;
		stopRamp();
		if (!finished || !started || adapter !== running || finished.steps.length === 0) return;
		lastRun = {
			format: 'null3d-vs-threejs-run',
			formatVersion: 1,
			scene,
			engine,
			engineVersion: started.version,
			gpu: started.gpu,
			inWorker: started.inWorker,
			deviceClass: cls,
			displayHz,
			width: size.width,
			height: size.height,
			pixelRatio: size.pixelRatio,
			effects: effectsToText(effects),
			plan,
			startedAt,
			steps: [...finished.steps],
			heldAtDisplayRate: finished.heldAtDisplayRate,
			heldAtHalfRate: finished.heldAtHalfRate,
			stopReason: finished.stopReason,
			memory: [...memoryLog],
			userAgent: navigator.userAgent,
		};
		keepRun(lastRun);
		saveButton.disabled = false;
		const unit = SCENES[scene].countUnit;
		const lastStep = finished.steps[finished.steps.length - 1];
		result.innerHTML = '';
		const heading = document.createElement('h2');
		heading.textContent = `${ENGINE_NAMES[engine]} on ${started.gpu === 'webgpu' ? 'WebGPU' : 'WebGL2'}`;
		const held = document.createElement('p');
		held.textContent =
			`Held ${displayHz} fps up to ${formatCount(finished.heldAtDisplayRate)} ${unit}. ` +
			`Held ${Math.round(displayHz / 2)} fps up to ${formatCount(finished.heldAtHalfRate)} ${unit}.`;
		const why = document.createElement('p');
		why.textContent = finished.stopReason
			? `The auto-slide stopped at second ${lastStep?.step ?? 0}: ${STOP_TEXT[finished.stopReason]}.`
			: ended
				? `The auto-slide ended at second ${lastStep?.step ?? 0}.`
				: `You stopped the auto-slide at second ${lastStep?.step ?? 0}. The gap should show by second ${GAP_SECONDS}.`;
		result.append(heading, held, why);
		result.hidden = false;
	};

	// Controls.
	for (const button of sceneButtons) {
		const id = button.dataset.scene as SceneId;
		button.disabled = !hasThreeScene(id);
		if (button.disabled) button.title = 'This scene is not built yet.';
		button.addEventListener('click', () => {
			if (id === scene) return;
			scene = id;
			count = SCENES[scene].ramp[cls].start;
			effects = effectsOf(SCENES[scene].effects);
			params.set('scene', scene);
			params.delete('count');
			history.replaceState(null, '', `?${params}`);
			void startEngine();
		});
	}
	engineSelect.value = engine;
	engineSelect.addEventListener('change', () => {
		engine = engineSelect.value as EngineKind;
		void startEngine();
	});
	gpuSelect.value = gpu;
	gpuSelect.addEventListener('change', () => {
		gpu = gpuSelect.value as GpuChoice;
		params.set('gpu', gpu);
		history.replaceState(null, '', `?${params}`);
		void startEngine();
	});
	slider.addEventListener('input', () => {
		stopRamp();
		const { min, max } = range();
		count = sliderToCount(Number(slider.value), min, max);
		countValue.textContent = formatCount(count);
		adapter?.setCount(count);
	});
	autoButton.addEventListener('click', () => {
		if (ramping) stopRamp();
		else void runRamp();
	});
	pauseButton.addEventListener('click', () => {
		userPaused = !userPaused;
		if (userPaused) stopRamp();
		applyPause();
	});
	saveButton.addEventListener('click', () => {
		if (lastRun) downloadRun(lastRun);
	});
	document.addEventListener('visibilitychange', applyPause);
	new IntersectionObserver((entries) => {
		offScreen = entries.every((entry) => !entry.isIntersecting);
		applyPause();
	}).observe(view);
	new ResizeObserver(() => {
		const size = renderSize();
		adapter?.resize(size.width, size.height, size.pixelRatio);
		redrawChart();
	}).observe(view);
	window.addEventListener('pagehide', () => adapter?.stop());

	await startEngine();
}
