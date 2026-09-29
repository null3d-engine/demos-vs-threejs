import { describe, expect, test } from 'bun:test';
import { holdPath, parityReport, parseParityArgs } from './parity-plan';

describe('parity options', () => {
	test('default to every three.js scene, on the software GPU', () => {
		const options = parseParityArgs([]);
		expect(options.scenes).toEqual(['factory', 'city', 'battle']);
		expect(options).toMatchObject({
			effects: null,
			out: 'runs/parity',
			url: null,
			gpu: 'software',
		});
	});

	test('read each option', () => {
		const options = parseParityArgs([
			'--scenes',
			'city,battle',
			'--effects',
			'fog',
			'--out',
			'x',
			'--url',
			'https://example.pages.dev/',
			'--gpu',
			'hardware',
			'--chrome',
			'/c',
		]);
		expect(options).toEqual({
			scenes: ['city', 'battle'],
			effects: 'fog',
			out: 'x',
			url: 'https://example.pages.dev',
			gpu: 'hardware',
			chrome: '/c',
		});
	});

	test('refuse unknown scenes, options and missing values', () => {
		expect(() => parseParityArgs(['--scenes', 'ocean'])).toThrow('not a scene');
		expect(() => parseParityArgs(['--fast'])).toThrow('Unknown option');
		expect(() => parseParityArgs(['--out'])).toThrow('needs a value');
		expect(() => parseParityArgs(['--gpu', 'fast'])).toThrow('software or hardware');
	});
});

describe('hold pages and report', () => {
	test('a hold page draws the scene at its hold time and count', () => {
		expect(holdPath('battle', 'threejs-webgpu', null)).toBe(
			'/?scene=battle&gpu=webgpu&count=1000&at=60&hold=1',
		);
		expect(holdPath('city', 'threejs-webgl2', 'fog')).toBe(
			'/?scene=city&gpu=webgl2&count=200&at=10&hold=1&effects=fog',
		);
	});

	test('the report gives each pair its share and whether it matches', () => {
		const pair = { candidate: 'threejs-webgl2', reference: 'threejs-webgpu' } as const;
		const text = parityReport(
			[
				{ scene: 'factory', pair, share: 0.0005 },
				{ scene: 'city', pair, share: 0.02 },
				{ scene: 'battle', pair, share: null, note: 'no WebGPU here' },
			],
			parseParityArgs([]),
		);
		expect(text).toContain('| factory | threejs-webgl2 | threejs-webgpu | 0.050% | yes |');
		expect(text).toContain('| city | threejs-webgl2 | threejs-webgpu | 2.000% | no |');
		expect(text).toContain('| battle | threejs-webgl2 | threejs-webgpu | no WebGPU here | - |');
	});
});
