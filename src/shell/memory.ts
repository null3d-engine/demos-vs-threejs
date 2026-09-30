// Memory of the page and all its workers, read with the same browser call for both engines. Only
// Chromium browsers have the call, and only on cross-origin isolated pages. A reading comes at the
// browser's next garbage collection, which Chrome forces within 20 seconds.
//
// The call adds shared memory to the figure of each thread that holds it. Measured in Chromium 141:
// one 256 MB shared WebAssembly memory held by the page and two workers read as 768 MB. So each
// engine tells the page what it shares, and the page counts that memory once.

type MeasureMemory = () => Promise<{ bytes: number }>;

/** Memory an engine shares between threads: its size, and how many threads hold it. */
export interface SharedMemory {
	bytes: number;
	holders: number;
}

export interface MemoryReading {
	/** The page and all its workers, with shared memory counted once. */
	bytes: number;
	/** What the browser reported. */
	measuredBytes: number;
	/** `performance.now()` when the reading arrived. */
	at: number;
}

/**
 * A reading with shared memory counted once: the browser counted it once per thread that holds it,
 * so the copies past the first come off. The result keeps at least one copy.
 */
export function countSharedOnce(measuredBytes: number, shared: SharedMemory | null): number {
	if (!shared || shared.holders <= 1 || shared.bytes <= 0) return measuredBytes;
	return Math.max(shared.bytes, measuredBytes - (shared.holders - 1) * shared.bytes);
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

	/**
	 * Reads until stopped. `shared` gives the engine's shared memory when each reading arrives: the
	 * figure that is current then.
	 */
	start(onReading: (reading: MemoryReading) => void, shared: () => SharedMemory | null): void {
		if (!canReadMemory() || this.running) return;
		this.running = true;
		const read = () => {
			if (!this.running) return;
			const measure = (performance as unknown as { measureUserAgentSpecificMemory: MeasureMemory })
				.measureUserAgentSpecificMemory;
			measure
				.call(performance)
				.then((result) => {
					this.last = {
						bytes: countSharedOnce(result.bytes, shared()),
						measuredBytes: result.bytes,
						at: performance.now(),
					};
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
