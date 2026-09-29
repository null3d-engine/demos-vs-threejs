// This computer's name on the local network, which tablets and phones use to reach the tools'
// server. Copied from the null3D engine (tools/lib/host.ts at commit 51fb3c3).

import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';

/** The local host name without the .local suffix. */
export function localHostName(): string {
	try {
		return execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim();
	} catch {
		return hostname().replace(/\.local$/, '');
	}
}
