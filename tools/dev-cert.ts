// Makes a local HTTPS certificate for the tools' server, signed by a certificate authority that
// lives in this checkout's certs/ folder (git ignores it). The computer's own trust store is left
// alone. To run the demos on an iPad or iPhone, install the printed rootCA.pem on the device and
// trust it. Adapted from the null3D engine (tools/dev-cert.ts at commit 51fb3c3).
// Run: bun run dev-cert

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CERT_DIR } from './lib/device-server';
import { localHostName } from './lib/host';

const caDir = join(CERT_DIR, 'ca');

try {
	execFileSync('mkcert', ['-help'], { stdio: 'ignore' });
} catch {
	console.error('mkcert is not installed. On macOS: brew install mkcert');
	process.exit(1);
}

mkdirSync(caDir, { recursive: true });
const host = `${localHostName()}.local`;
execFileSync(
	'mkcert',
	[
		'-cert-file',
		join(CERT_DIR, 'cert.pem'),
		'-key-file',
		join(CERT_DIR, 'key.pem'),
		'localhost',
		'127.0.0.1',
		'::1',
		host,
	],
	{ stdio: 'inherit', env: { ...process.env, CAROOT: caDir } },
);
console.log(`\nThe certificate covers localhost and ${host}.`);
console.log(
	`To run on an iPad or iPhone, AirDrop ${join(caDir, 'rootCA.pem')} to the device, install it,`,
);
console.log('then turn on full trust in Settings > General > About > Certificate Trust Settings.');
