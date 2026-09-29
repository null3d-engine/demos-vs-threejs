// The chart under the demo: median frame time against count, on a log scale of counts, with lines at
// the display's frame budget and at twice it. The running engine's line is solid; the other
// engine's last run on this device is faint.

import type { EngineKind } from '../engine/protocol';

export interface ChartSeries {
	engine: EngineKind;
	points: { count: number; frameMs: number }[];
	faint: boolean;
}

export const ENGINE_COLORS: Readonly<Record<EngineKind, string>> = {
	null3d: '#4ea8de',
	threejs: '#f28e2b',
};

export const ENGINE_NAMES: Readonly<Record<EngineKind, string>> = {
	null3d: 'null3D',
	threejs: 'three.js',
};

export function drawChart(
	canvas: HTMLCanvasElement,
	series: readonly ChartSeries[],
	minCount: number,
	maxCount: number,
	displayHz: number,
): void {
	const ratio = window.devicePixelRatio || 1;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
	}
	const context = canvas.getContext('2d');
	if (!context) return;
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.clearRect(0, 0, width, height);
	const styles = getComputedStyle(canvas);
	const faintInk = styles.getPropertyValue('--muted').trim() || '#8b919a';
	const left = 64;
	const right = 12;
	const top = 12;
	const bottom = 30;
	const plotWidth = width - left - right;
	const plotHeight = height - top - bottom;
	const budget = 1000 / displayHz;
	let highest = budget * 3;
	for (const line of series)
		for (const point of line.points) highest = Math.max(highest, point.frameMs);
	highest = Math.min(highest, 120);
	const x = (count: number) =>
		left +
		((Math.log(count) - Math.log(minCount)) / (Math.log(maxCount) - Math.log(minCount))) *
			plotWidth;
	const y = (ms: number) => top + plotHeight - (Math.min(ms, highest) / highest) * plotHeight;

	// Axes and labels.
	context.strokeStyle = faintInk;
	context.fillStyle = faintInk;
	context.lineWidth = 1;
	context.font = '12px system-ui, sans-serif';
	context.beginPath();
	context.moveTo(left, top);
	context.lineTo(left, top + plotHeight);
	context.lineTo(left + plotWidth, top + plotHeight);
	context.stroke();
	context.textAlign = 'right';
	context.textBaseline = 'middle';
	for (const ms of [0, budget, budget * 2])
		context.fillText(`${ms.toFixed(1)} ms`, left - 6, y(ms));
	context.textAlign = 'center';
	context.textBaseline = 'top';
	for (let decade = 10 ** Math.ceil(Math.log10(minCount)); decade <= maxCount; decade *= 10) {
		context.fillText(
			decade >= 1e6 ? `${decade / 1e6}M` : decade >= 1e3 ? `${decade / 1e3}k` : `${decade}`,
			x(decade),
			top + plotHeight + 6,
		);
	}

	// The budget lines: the display rate and half of it.
	context.setLineDash([4, 4]);
	for (const [ms, label] of [
		[budget, `${displayHz} fps`],
		[budget * 2, `${Math.round(displayHz / 2)} fps`],
	] as const) {
		context.beginPath();
		context.moveTo(left, y(ms));
		context.lineTo(left + plotWidth, y(ms));
		context.stroke();
		context.textAlign = 'right';
		context.textBaseline = 'bottom';
		context.fillText(label, left + plotWidth, y(ms) - 2);
	}
	context.setLineDash([]);

	// The runs.
	for (const line of series) {
		if (line.points.length === 0) continue;
		context.strokeStyle = ENGINE_COLORS[line.engine];
		context.globalAlpha = line.faint ? 0.35 : 1;
		context.lineWidth = 2;
		context.beginPath();
		line.points.forEach((point, i) => {
			if (i === 0) context.moveTo(x(point.count), y(point.frameMs));
			else context.lineTo(x(point.count), y(point.frameMs));
		});
		context.stroke();
		context.globalAlpha = 1;
	}
}
