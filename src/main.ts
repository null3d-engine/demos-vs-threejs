import { isolationProblem } from './shell/isolation';

const problem = isolationProblem({
	crossOriginIsolated: globalThis.crossOriginIsolated,
	sharedMemory: typeof SharedArrayBuffer !== 'undefined',
});
const status = document.getElementById('status');
if (status)
	status.textContent = problem ?? 'This page is cross-origin isolated: worker threads can run.';
