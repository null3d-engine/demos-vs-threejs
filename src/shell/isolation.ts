// Worker threads need shared memory, and browsers give shared memory only to cross-origin isolated
// pages. Both engines lose their worker threads without it, so the page says so plainly.

/** What the page can tell about isolation. */
export interface IsolationFacts {
	/** `globalThis.crossOriginIsolated`, or undefined where the browser does not report it. */
	crossOriginIsolated: boolean | undefined;
	/** True when `SharedArrayBuffer` exists. */
	sharedMemory: boolean;
}

/** A sentence for the page about isolation, or null when threads can run. */
export function isolationProblem(facts: IsolationFacts): string | null {
	if (facts.crossOriginIsolated === true && facts.sharedMemory) return null;
	if (facts.crossOriginIsolated === true)
		return 'This browser has no shared memory, so both engines run on one thread.';
	return 'This page is not cross-origin isolated, so both engines run on one thread. The server must send the Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers.';
}
