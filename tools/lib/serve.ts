// Builds this checkout and serves it with the isolation headers, for the tools.

import { type Subprocess, spawn } from 'bun';

async function run(command: string[]): Promise<void> {
	const child = spawn(command, { stdout: 'inherit', stderr: 'inherit' });
	if ((await child.exited) !== 0) throw new Error(`${command.join(' ')} failed.`);
}

/** Waits until an address answers, or throws after `seconds`. */
async function waitFor(url: string, seconds: number): Promise<void> {
	const end = Date.now() + seconds * 1000;
	while (Date.now() < end) {
		try {
			if ((await fetch(url)).ok) return;
		} catch {
			// Not up yet.
		}
		await Bun.sleep(250);
	}
	throw new Error(`${url} did not answer within ${seconds} s.`);
}

/** Builds the site, serves it on `port`, and returns its address and a way to stop it. */
export async function serveBuild(port: number): Promise<{ url: string; stop(): void }> {
	await run(['bun', 'run', 'build']);
	const server: Subprocess = spawn(
		['bunx', 'vite', 'preview', '--port', String(port), '--strictPort'],
		{
			stdout: 'ignore',
			stderr: 'inherit',
		},
	);
	const url = `http://localhost:${port}`;
	await waitFor(url, 30);
	return { url, stop: () => server.kill() };
}
