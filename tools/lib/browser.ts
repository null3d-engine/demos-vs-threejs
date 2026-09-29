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

/**
 * Starts Chromium. On the software GPU: Playwright's own Chromium (or CHROMIUM_PATH), headless. On
 * the machine's GPU: the installed Google Chrome, shown, with the WebGPU developer features that
 * keep GPU timestamps from being rounded, as the null3D engine's benchmark does.
 */
export async function launchChromium(options: {
	gpu: 'software' | 'hardware';
	chrome: string | null;
	headed?: boolean;
}): Promise<Browser> {
	const executablePath = options.chrome ?? process.env.CHROMIUM_PATH ?? undefined;
	if (options.gpu === 'software')
		return chromium.launch({ executablePath, headless: !options.headed, args: SOFTWARE_GPU_ARGS });
	return chromium.launch({
		...(executablePath ? { executablePath } : { channel: 'chrome' }),
		headless: false,
		args: ['--enable-webgpu-developer-features'],
	});
}
