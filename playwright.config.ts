import { defineConfig } from '@playwright/test';

// A software GPU (SwiftShader) with WebGPU turned on, as the null3D engine's CI uses. It draws
// slowly, so these tests check that the demos start, draw and measure, not how fast they are.
const SOFTWARE_GPU = [
	'--enable-unsafe-webgpu',
	'--use-angle=swiftshader',
	'--use-vulkan=swiftshader',
	'--enable-unsafe-swiftshader',
	'--enable-features=Vulkan',
];
const PORT = 4173;

export default defineConfig({
	testDir: 'tests',
	timeout: 120_000,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: `http://localhost:${PORT}`,
		viewport: { width: 1280, height: 800 },
		launchOptions: {
			args: SOFTWARE_GPU,
			// A local Chromium when the machine has one and cannot download Playwright's own.
			executablePath: process.env.CHROMIUM_PATH || undefined,
		},
	},
	webServer: {
		command: `bun run build && bunx vite preview --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
