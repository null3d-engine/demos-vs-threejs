import { defineConfig } from 'vite';

// Worker threads need shared memory, and browsers give shared memory only to cross-origin isolated
// pages. These are the values of the engine's own Vite plugin (@null3d/vite-plugin). When that
// plugin is on npm, `null3d()` replaces this block. public/_headers sends the same headers on
// Cloudflare Pages.
const ISOLATION_HEADERS = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
	server: { headers: ISOLATION_HEADERS },
	preview: { headers: ISOLATION_HEADERS },
	worker: { format: 'es' },
	// three.js's WebGPU build is about 700 kB before compression, and its core with the WebGL
	// renderer and the add-ons about 830 kB. They load only when a demo starts, in the worker, or
	// on the page when the browser cannot draw in a worker.
	build: { target: 'es2023', chunkSizeWarningLimit: 900 },
});
