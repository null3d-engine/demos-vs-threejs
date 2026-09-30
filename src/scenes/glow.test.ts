import { describe, expect, test } from 'bun:test';
import { BATTLE_MATERIALS, BATTLE_VIEW } from './battle';
import { CITY_MATERIALS, CITY_VIEW, WINDOW_COLORS } from './city';
import type { Hex } from './common';
import type { GlowSpec } from './effects';
import { FACTORY_MATERIALS, FACTORY_VIEW } from './factory';

/** An sRGB channel (0 to 255) as a linear value, as three.js and null3D convert colors. */
function linear(channel: number): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * The lower of the two brightness measures that three.js's blooms use on a color times its
 * intensity: UnrealBloomPass weighs red, green and blue as (0.299, 0.587, 0.114), the WebGPU bloom
 * node as (0.2126, 0.7152, 0.0722).
 */
function brightness(hex: Hex, intensity: number): number {
	const n = Number.parseInt(hex.slice(1), 16);
	const r = linear((n >> 16) & 255);
	const g = linear((n >> 8) & 255);
	const b = linear(n & 255);
	const webgl = 0.299 * r + 0.587 * g + 0.114 * b;
	const webgpu = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return Math.min(webgl, webgpu) * intensity;
}

/** A light glows clearly: at least 5% above the threshold, past the bloom's soft edge. */
function expectGlows(hex: Hex, intensity: number, glow: GlowSpec): void {
	expect(brightness(hex, intensity)).toBeGreaterThan(glow.threshold * 1.05);
}

describe('glow', () => {
	test('every light material shines clearly above its scene’s glow threshold', () => {
		expectGlows(
			FACTORY_MATERIALS.line.color,
			FACTORY_MATERIALS.line.intensity ?? 1,
			FACTORY_VIEW.glow,
		);
		for (const color of WINDOW_COLORS)
			expectGlows(color, CITY_MATERIALS.window.intensity, CITY_VIEW.glow);
		expectGlows(CITY_MATERIALS.lampHead.color, CITY_MATERIALS.lampHead.intensity, CITY_VIEW.glow);
		expectGlows(BATTLE_MATERIALS.tracer.color, BATTLE_MATERIALS.tracer.intensity, BATTLE_VIEW.glow);
		expectGlows(BATTLE_MATERIALS.blast.color, BATTLE_MATERIALS.blast.intensity, BATTLE_VIEW.glow);
	});

	test('glow settings stay in the ranges the blooms accept', () => {
		for (const glow of [FACTORY_VIEW.glow, CITY_VIEW.glow, BATTLE_VIEW.glow]) {
			expect(glow.threshold).toBeGreaterThan(1);
			expect(glow.strength).toBeGreaterThan(0);
			expect(glow.radius).toBeGreaterThanOrEqual(0);
			expect(glow.radius).toBeLessThanOrEqual(1);
		}
	});
});
