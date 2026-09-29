import { describe, expect, test } from 'bun:test';
import {
	BLOCK_SIZE,
	blockCell,
	buildingOf,
	CAR_LANE_OFFSET,
	CARS_PER_BLOCK,
	CarState,
	CITY_CAMERA,
	type CityState,
	carTransform,
	cityMeshes,
	cityObjects,
	cityRing,
	cityTriangles,
	createCity,
	isGreen,
	MAX_BLOCKS,
	PAVEMENT_OFFSET,
	PEOPLE_PER_BLOCK,
	PITCH,
	personTransform,
	STILL_PER_BLOCK,
	setActiveBlocks,
	stepCity,
	windowOf,
} from './city';
import { SIM_STEP, sampleCameraLoop, stepsUntil } from './common';
import { triangleCount } from './geometry';

function run(state: CityState, steps: number): void {
	for (let i = 0; i < steps; i++) stepCity(state);
}

describe('city layout and counts', () => {
	test('a block holds 53 still objects and 10 moving ones', () => {
		expect(STILL_PER_BLOCK).toBe(53);
		expect(cityObjects(1_000)).toBe(1_000 * 63 + 1);
		expect(cityObjects(20_000)).toBeLessThan(2_097_152);
	});

	test('triangles add up per block, plus the ground', () => {
		const meshes = cityMeshes(10);
		const one = cityTriangles(1, meshes);
		expect(cityTriangles(3, meshes) - one).toBe(2 * (one - triangleCount(meshes.ground)));
	});

	test('buildings stand inside their block with sensible sizes', () => {
		const position = new Float64Array(3);
		const size = new Float64Array(3);
		const cell = new Int32Array(2);
		for (let block = 0; block < 200; block++) {
			blockCell(block, cell);
			for (let b = 0; b < 9; b++) {
				buildingOf(block, b, position, size);
				expect(Math.abs(position[0]! - cell[0]! * PITCH) + size[0]! / 2).toBeLessThanOrEqual(
					BLOCK_SIZE / 2,
				);
				expect(Math.abs(position[2]! - cell[1]! * PITCH) + size[2]! / 2).toBeLessThanOrEqual(
					BLOCK_SIZE / 2,
				);
				expect(size[1]).toBeGreaterThanOrEqual(8);
				expect(size[1]).toBeLessThanOrEqual(8 + 44 + 60);
			}
		}
	});

	test('windows sit on a face of their building, below its roof', () => {
		const building = new Float64Array(3);
		const size = new Float64Array(3);
		const window = new Float64Array(3);
		const windowSize = new Float64Array(3);
		const yaw = new Float64Array(1);
		for (let block = 0; block < 50; block++) {
			for (let b = 0; b < 9; b++) {
				buildingOf(block, b, building, size);
				for (let w = 0; w < 4; w++) {
					windowOf(block, b, w, window, windowSize, yaw);
					const out =
						Math.sin(yaw[0]!) * (window[0]! - building[0]!) +
						Math.cos(yaw[0]!) * (window[2]! - building[2]!);
					const half = Math.abs(Math.cos(yaw[0]!)) > 0.5 ? size[2]! / 2 : size[0]! / 2;
					expect(out).toBeCloseTo(half + 0.06, 6);
					expect(window[1]! + windowSize[1]! / 2).toBeLessThanOrEqual(size[1]!);
				}
			}
		}
	});

	test('traffic lights never give green to both streets of a crossing', () => {
		for (let t = 0; t < 40; t += 0.25) {
			for (let m = -3; m <= 3; m++)
				expect(isGreen(0, m, -m, t) && isGreen(1, m, -m, t)).toBe(false);
		}
	});
});

describe('city simulation', () => {
	test('the same seed and steps give the same state', () => {
		const a = createCity(60);
		const b = createCity(60);
		run(a, 1200);
		run(b, 1200);
		expect([...a.carPosition]).toEqual([...b.carPosition]);
		expect([...a.carAxis]).toEqual([...b.carAxis]);
		expect([...a.personPosition]).toEqual([...b.personPosition]);
	});

	test('cars stay inside the city, and never jump except when they turn back at a corner', () => {
		const state = createCity(49);
		const cars = 49 * CARS_PER_BLOCK;
		const limit = (cityRing(49) + 0.5) * PITCH + CAR_LANE_OFFSET + 1e-3;
		const before = new Float64Array(3);
		const after = new Float64Array(3);
		let turns = 0;
		for (let i = 0; i < stepsUntil(120); i++) {
			const positions: number[][] = [];
			const axes = [...state.carAxis.subarray(0, cars)];
			const directions = [...state.carDirection.subarray(0, cars)];
			for (let c = 0; c < cars; c++) {
				carTransform(state, c, before);
				positions.push([before[0]!, before[2]!]);
			}
			stepCity(state);
			for (let c = 0; c < cars; c++) {
				carTransform(state, c, after);
				expect(Math.abs(after[0]!)).toBeLessThanOrEqual(limit);
				expect(Math.abs(after[2]!)).toBeLessThanOrEqual(limit);
				if (state.carAxis[c] !== axes[c]) turns++;
				const turnedBack = state.carAxis[c] === axes[c] && state.carDirection[c] !== directions[c];
				const moved = Math.hypot(after[0]! - positions[c]![0]!, after[2]! - positions[c]![1]!);
				if (!turnedBack) expect(moved).toBeLessThanOrEqual(14 * SIM_STEP + 1e-3);
			}
		}
		expect(turns).toBeGreaterThan(cars);
	});

	test('a car stops only at a red light', () => {
		const state = createCity(25);
		const cars = 25 * CARS_PER_BLOCK;
		let stops = 0;
		for (let i = 0; i < stepsUntil(90); i++) {
			stepCity(state);
			for (let c = 0; c < cars; c++) {
				if (state.carState[c] !== CarState.stopped) continue;
				stops++;
				const axis = state.carAxis[c]!;
				const crossing = state.carPlan[c] ? state.carPlanCrossing[c]! : null;
				if (crossing === null) continue;
				const line = state.carLine[c]!;
				expect(
					isGreen(axis, axis === 0 ? crossing : line, axis === 0 ? line : crossing, state.time),
				).toBe(false);
			}
		}
		expect(stops).toBeGreaterThan(0);
	});

	test('people stay on the pavement around their block', () => {
		const state = createCity(20);
		const position = new Float64Array(3);
		const cell = new Int32Array(2);
		run(state, stepsUntil(30));
		for (let p = 0; p < 20 * PEOPLE_PER_BLOCK; p++) {
			personTransform(state, p, position);
			blockCell(Math.floor(p / PEOPLE_PER_BLOCK), cell);
			const dx = Math.abs(position[0]! - cell[0]! * PITCH);
			const dz = Math.abs(position[2]! - cell[1]! * PITCH);
			expect(Math.max(dx, dz)).toBeCloseTo(BLOCK_SIZE / 2 + PAVEMENT_OFFSET, 3);
		}
	});

	test('shrinking the city brings the cars outside its new edge back home', () => {
		const state = createCity(100);
		run(state, stepsUntil(60));
		setActiveBlocks(state, 9);
		const limit = (cityRing(9) + 0.5) * PITCH + CAR_LANE_OFFSET + 1e-3;
		const position = new Float64Array(3);
		for (let c = 0; c < 9 * CARS_PER_BLOCK; c++) {
			carTransform(state, c, position);
			expect(Math.abs(position[0]!)).toBeLessThanOrEqual(limit);
			expect(Math.abs(position[2]!)).toBeLessThanOrEqual(limit);
		}
	});
});

describe('city camera', () => {
	// Every block of the largest city, found by its grid cell.
	const blockAt = new Map<string, number>();
	const cellOf = new Int32Array(2);
	for (let block = 0; block < MAX_BLOCKS; block++) {
		blockCell(block, cellOf);
		blockAt.set(`${cellOf[0]},${cellOf[1]}`, block);
	}
	const position = new Float64Array(3);
	const target = new Float64Array(3);
	const base = new Float64Array(3);
	const size = new Float64Array(3);
	const SAMPLES = 7000;

	/** The distance from the camera to the nearest building of the blocks around it. */
	function nearestBuilding(): number {
		const bx = Math.round((position[0] as number) / PITCH);
		const bz = Math.round((position[2] as number) / PITCH);
		let nearest = Number.POSITIVE_INFINITY;
		for (let dx = -1; dx <= 1; dx++) {
			for (let dz = -1; dz <= 1; dz++) {
				const block = blockAt.get(`${bx + dx},${bz + dz}`);
				if (block === undefined) continue;
				for (let b = 0; b < 9; b++) {
					buildingOf(block, b, base, size);
					const x =
						Math.abs((position[0] as number) - (base[0] as number)) - (size[0] as number) / 2;
					const z =
						Math.abs((position[2] as number) - (base[2] as number)) - (size[2] as number) / 2;
					const y = (position[1] as number) - (size[1] as number);
					nearest = Math.min(nearest, Math.hypot(Math.max(0, x), Math.max(0, y), Math.max(0, z)));
				}
			}
		}
		return nearest;
	}

	test('stays above the cars and people, and out of the buildings', () => {
		let lowest = Number.POSITIVE_INFINITY;
		let nearest = Number.POSITIVE_INFINITY;
		for (let k = 0; k < SAMPLES; k++) {
			sampleCameraLoop(CITY_CAMERA, (k / SAMPLES) * CITY_CAMERA.seconds, position, target);
			lowest = Math.min(lowest, position[1] as number);
			nearest = Math.min(nearest, nearestBuilding());
		}
		expect(lowest).toBeGreaterThan(4);
		expect(nearest).toBeGreaterThan(3);
	});

	test('looks at a point well away from itself', () => {
		for (let k = 0; k < SAMPLES; k++) {
			sampleCameraLoop(CITY_CAMERA, (k / SAMPLES) * CITY_CAMERA.seconds, position, target);
			const look = Math.hypot(
				(target[0] as number) - (position[0] as number),
				(target[1] as number) - (position[1] as number),
				(target[2] as number) - (position[2] as number),
			);
			expect(look).toBeGreaterThan(10);
		}
	});
});
