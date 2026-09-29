// Starting Chromium for the tools and the browser tests, on the software GPU or the machine's own.

import { type Browser, chromium } from '@playwright/test';

/**
 * A software GPU (SwiftShader) with WebGPU turned on, as the null3D engine's CI uses. It draws the
 * same on every machine, slowly.
 */
export const SOFTWARE_GPU_ARGS = [
	'--enable-unsafe-webgpu',
	'--use-angle=swiftshader',
	'--use-vulkan=swiftshader',
	'--enable-unsafe-swiftshader',
	'--enable-features=Vulkan',
];

/** The page size the tools and tests draw at: the desktop device class, at pixel ratio 1. */
export const VIEWPORT = { width: 1280, height: 800 };

export async function launchChromium(options: {
	gpu: 'software' | 'hardware';
	chrome: string | null;
	headed?: boolean;
}): Promise<Browser> {
	return chromium.launch({
		executablePath: options.chrome ?? process.env.CHROMIUM_PATH ?? undefined,
		headless: !options.headed,
		args: options.gpu === 'software' ? SOFTWARE_GPU_ARGS : ['--enable-unsafe-webgpu'],
	});
}
