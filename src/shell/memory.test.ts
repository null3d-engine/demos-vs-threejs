import { describe, expect, test } from 'bun:test';
import { countSharedOnce } from './memory';

const MB = 1024 * 1024;

describe('countSharedOnce', () => {
	test('takes off the copies the browser counted past the first', () => {
		// Measured in Chromium 141: 0.5 MB of page, and one 256 MB shared WebAssembly memory held by
		// the page and two workers, read as 768.5 MB.
		expect(countSharedOnce(768.5 * MB, { bytes: 256 * MB, holders: 3 })).toBe(256.5 * MB);
	});

	test('leaves a reading as it is when nothing is shared, or one thread holds it', () => {
		expect(countSharedOnce(300 * MB, null)).toBe(300 * MB);
		expect(countSharedOnce(300 * MB, { bytes: 256 * MB, holders: 1 })).toBe(300 * MB);
		expect(countSharedOnce(300 * MB, { bytes: 0, holders: 8 })).toBe(300 * MB);
	});

	test('keeps at least one copy when the reading is older than the shared size', () => {
		// The shared memory grew after the browser's reading: never report less than one copy.
		expect(countSharedOnce(600 * MB, { bytes: 512 * MB, holders: 4 })).toBe(512 * MB);
	});
});
