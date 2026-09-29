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
	build: { target: 'es2023' },
});
