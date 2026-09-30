// The tools' server for devices: it serves the built demo, the runner page, and the endpoints
// through which runner pages fetch plans and store results. Plain HTTP listens on this computer
// only, which Android phones reach through adb. HTTPS listens on the local network for tablets and
// phones that reach this computer by its .local name: browsers give WebGPU and shared memory only
// to secure pages. Adapted from the null3D engine's report collector (tests/lib/report-collector.ts
// at commit 51fb3c3).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { currentRunText } from './device-runs';

/** The two cross-origin isolation headers, with the values in vite.config.ts, on every answer. */
const ISOLATION_HEADERS = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Ports of the plain HTTP server on this computer and of the HTTPS server on the network. */
export const HTTP_PORT = 4177;
export const HTTPS_PORT = 4178;
/** Where `bun run dev-cert` puts the HTTPS certificate (cert.pem, key.pem) and its authority. */
export const CERT_DIR = 'certs';

/** The endpoints' path. */
export const RUNS_PATH = '/__demo/runs/';
/** The runner page's path. */
export const RUNNER_PATH = '/runner/';

const MAX_BODY_BYTES = 64 * 1024 * 1024;
/** Names of runs, runners and items become file names, so nothing that could leave the folder. */
const NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** What the server serves. */
export interface Site {
	/** The built demo. */
	dist: string;
	/** Where runs are kept (tools/lib/device-runs.ts). */
	runs: string;
	/** The runner page and its script. */
	runnerHtml: string;
	runnerJs: string;
}

function answer(status: number, body?: string, type?: string): Response {
	const headers: Record<string, string> = { ...ISOLATION_HEADERS, 'Cache-Control': 'no-store' };
	if (type) headers['Content-Type'] = type;
	return new Response(body ?? null, { status, headers });
}

const json = (text: string) => answer(200, text, 'application/json');

/** Stores a POSTed JSON body with the time it arrived. */
async function receive(request: Request, folder: string, name: string): Promise<Response> {
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > MAX_BODY_BYTES) return answer(413);
	const body = await request.text();
	if (body.length > MAX_BODY_BYTES) return answer(413);
	let report: unknown;
	try {
		report = JSON.parse(body);
	} catch {
		return answer(400);
	}
	if (typeof report !== 'object' || report === null || Array.isArray(report)) return answer(400);
	mkdirSync(folder, { recursive: true });
	writeFileSync(
		join(folder, `${name}.json`),
		JSON.stringify({ receivedAt: new Date().toISOString(), ...report }, null, '\t'),
	);
	return answer(204);
}

/**
 * The run endpoints:
 * - `GET /__demo/runs/current` tells waiting runner pages which run to start.
 * - `GET /__demo/runs/<run>/plan` returns a run's list of pages.
 * - `POST /__demo/runs/<run>/<runner>/<name>` stores one result of a runner as its own file, and
 *   `GET` on the same path reads it back.
 */
async function runsAnswer(request: Request, path: string, root: string): Promise<Response> {
	const parts = path.split('/').filter(Boolean);
	if (parts.length === 1 && parts[0] === 'current') return json(currentRunText(root));
	if (!parts.every((part) => NAME.test(part))) return answer(400);
	const [run, runner, name] = parts as [string, string?, string?];
	if (parts.length === 2 && runner === 'plan') {
		const plan = join(root, run, 'plan.json');
		return existsSync(plan) ? json(readFileSync(plan, 'utf8')) : answer(404);
	}
	if (parts.length !== 3 || !runner || !name) return answer(404);
	if (request.method === 'GET') {
		const file = join(root, run, runner, `${name}.json`);
		return existsSync(file) ? json(readFileSync(file, 'utf8')) : answer(404);
	}
	if (request.method !== 'POST') return answer(405);
	return receive(request, join(root, run, runner), name);
}

/** A file of the built demo, or null when the path leaves the folder or names no file. */
function staticFile(dist: string, path: string): string | null {
	const base = resolve(dist);
	const file = resolve(base, `.${normalize(path === '/' ? '/index.html' : path)}`);
	if (!file.startsWith(base + sep)) return null;
	return existsSync(file) ? file : null;
}

/** Answers one request. */
export async function handle(request: Request, site: Site): Promise<Response> {
	const url = new URL(request.url);
	let path: string;
	try {
		path = decodeURIComponent(url.pathname);
	} catch {
		return answer(400);
	}
	if (path.startsWith(RUNS_PATH))
		return runsAnswer(request, path.slice(RUNS_PATH.length), site.runs);
	if (request.method !== 'GET' && request.method !== 'HEAD') return answer(405);
	if (path === RUNNER_PATH) return answer(200, site.runnerHtml, 'text/html; charset=utf-8');
	if (path === `${RUNNER_PATH}runner.js`) return answer(200, site.runnerJs, 'text/javascript');
	const file = staticFile(site.dist, path);
	if (!file) return answer(404);
	const headers = { ...ISOLATION_HEADERS, 'Cache-Control': 'no-store' };
	return new Response(Bun.file(file), { headers });
}

/** Bundles the runner page's script. */
async function buildRunner(): Promise<string> {
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, '../runner/runner.ts')],
		target: 'browser',
		format: 'esm',
	});
	const output = result.outputs[0];
	if (!result.success || !output)
		throw new Error(`The runner page did not build: ${result.logs.join('\n')}`);
	return output.text();
}

/** Reads the runner page and bundles its script, once for every server. */
export async function loadSite(dist: string, runs: string): Promise<Site> {
	if (!existsSync(join(dist, 'index.html')))
		throw new Error(`${dist} holds no built demo; run bun run build first.`);
	return {
		dist,
		runs,
		runnerHtml: readFileSync(join(import.meta.dir, '../runner/index.html'), 'utf8'),
		runnerJs: await buildRunner(),
	};
}

export interface DeviceServer {
	url: string;
	stop(): void;
}

/**
 * Serves the site: on this computer's localhost over HTTP, or with `tls` on the local network
 * over HTTPS, at `https://<host>:<port>`.
 */
export function serveSite(
	site: Site,
	port: number,
	tls?: { cert: string; key: string; host: string },
): DeviceServer {
	const server = Bun.serve({
		port,
		hostname: tls ? '0.0.0.0' : '127.0.0.1',
		fetch: (request) => handle(request, site),
		...(tls && { tls: { cert: Bun.file(tls.cert), key: Bun.file(tls.key) } }),
	});
	return {
		url: tls ? `https://${tls.host}:${port}` : `http://localhost:${port}`,
		stop: () => server.stop(true),
	};
}
