import { describe, expect, test } from 'bun:test';
import { isolationProblem } from './isolation';

describe('isolationProblem', () => {
	test('isolated with shared memory: no problem', () => {
		expect(isolationProblem({ crossOriginIsolated: true, sharedMemory: true })).toBeNull();
	});

	test('isolated without shared memory', () => {
		expect(isolationProblem({ crossOriginIsolated: true, sharedMemory: false })).toContain(
			'no shared memory',
		);
	});

	test('not isolated names the two headers', () => {
		const text = isolationProblem({ crossOriginIsolated: false, sharedMemory: true });
		expect(text).toContain('Cross-Origin-Opener-Policy');
		expect(text).toContain('Cross-Origin-Embedder-Policy');
	});

	test('unknown isolation counts as not isolated', () => {
		expect(
			isolationProblem({ crossOriginIsolated: undefined, sharedMemory: false }),
		).not.toBeNull();
	});
});
