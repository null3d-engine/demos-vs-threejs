// Memory of the page and all its workers, read with the same browser call for both engines. Only
// Chromium browsers have the call, and only on cross-origin isolated pages. A reading comes at the
// browser's next garbage collection, which Chrome forces within 20 seconds.

type MeasureMemory = () => Promise<{ bytes: number }>;

export interface MemoryReading {
	bytes: number;
	/** `performance.now()` when the reading arrived. */
	at: number;
}

/** True when this browser can read the page's memory. */
export function canReadMemory(): boolean {
	const measure = (performance as { measureUserAgentSpecificMemory?: MeasureMemory })
		.measureUserAgentSpecificMemory;
	return typeof measure === 'function' && globalThis.crossOriginIsolated === true;
}

/** Reads memory again and again, each time the last reading arrives. */
export class MemoryReader {
	last: MemoryReading | null = null;
	private running = false;

	start(onReading: (reading: MemoryReading) => void): void {
		if (!canReadMemory() || this.running) return;
		this.running = true;
		const read = () => {
			if (!this.running) return;
			const measure = (performance as unknown as { measureUserAgentSpecificMemory: MeasureMemory })
				.measureUserAgentSpecificMemory;
			measure
				.call(performance)
				.then((result) => {
					this.last = { bytes: result.bytes, at: performance.now() };
					onReading(this.last);
				})
				.catch(() => undefined)
				.finally(() => {
					if (this.running) setTimeout(read, 2000);
				});
		};
		read();
	}

	stop(): void {
		this.running = false;
		this.last = null;
	}
}
