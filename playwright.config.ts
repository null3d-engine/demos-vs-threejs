import { defineConfig } from '@playwright/test';
import { SOFTWARE_GPU_ARGS, VIEWPORT } from './tools/lib/browser';

const PORT = 4173;

export default defineConfig({
	testDir: 'tests',
	timeout: 300_000,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: `http://localhost:${PORT}`,
		viewport: VIEWPORT,
		launchOptions: {
			args: SOFTWARE_GPU_ARGS,
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
