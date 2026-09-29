import { describe, expect, test } from 'bun:test';
import { stepsUntil } from './common';
import {
	ARM_PARENT,
	ARM_PART,
	ARM_PARTS,
	ArmState,
	armPartLocal,
	BELT_HEIGHT,
	BELT_SPACING,
	CRATE_HEIGHT,
	CRATE_SIZE,
	CRATES_PER_CELL,
	CrateParent,
	CrateState,
	crateTransform,
	createFactory,
	type FactoryState,
	factoryCells,
	factoryMeshes,
	factoryObjects,
	factoryTriangles,
	MOVING_PER_CELL,
	REACH,
	setActiveCells,
	stepFactory,
} from './factory';
import { triangleCount } from './geometry';
import { chain, type Pose } from './testing';

function run(state: FactoryState, steps: number): void {
	for (let i = 0; i < steps; i++) stepFactory(state);
}

/** World poses of a cell's arm parts, computed parent first as an engine would. */
function armWorld(state: FactoryState, cell: number): Pose[] {
	const poses: Pose[] = [];
	for (let part = 0; part < ARM_PARTS; part++) {
		const position = [0, 0, 0];
		const rotation = [0, 0, 0, 1];
		armPartLocal(state, cell, part, position, rotation);
		const parent = ARM_PARENT[part]!;
		poses.push(parent < 0 ? { position, rotation } : chain(poses[parent]!, { position, rotation }));
	}
	return poses;
}

function crateWorld(state: FactoryState, cell: number, k: number): Pose {
	const position = [0, 0, 0];
	const rotation = [0, 0, 0, 1];
	const parent = crateTransform(state, cell, k, position, rotation);
	if (parent === CrateParent.hall) return { position, rotation };
	return chain(armWorld(state, cell)[ARM_PART.wrist]!, { position, rotation });
}

function sameRotation(a: readonly number[], b: readonly number[]): number {
	// q and -q are the same rotation.
	return Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
}

describe('factory layout and counts', () => {
	test('a count of moving parts becomes whole cells of 10 moving parts', () => {
		expect(MOVING_PER_CELL).toBe(10);
		expect(factoryCells(10_000)).toBe(1_000);
		expect(factoryCells(10_001)).toBe(1_001);
		expect(factoryCells(0)).toBe(1);
		expect(factoryObjects(10_000)).toBe(1_000 * 14 + 1);
	});

	test('triangles add up per cell, plus the floor', () => {
		const meshes = factoryMeshes(1);
		const one = factoryTriangles(10, meshes);
		const two = factoryTriangles(20, meshes);
		expect(two - one).toBe(one - triangleCount(meshes.floor));
	});

	test('the pick point lies in front of the arm, with the crate above the floor', () => {
		expect(REACH).toBeGreaterThan(1.5);
		expect(REACH).toBeLessThan(2.5);
		expect(CRATE_HEIGHT - CRATE_SIZE / 2).toBeCloseTo(BELT_HEIGHT, 9);
		expect(BELT_HEIGHT).toBeGreaterThan(0.2);
	});

	test('cells lie on distinct grid points', () => {
		const state = createFactory(500);
		const seen = new Set<string>();
		for (let c = 0; c < 500; c++) seen.add(`${state.origin[c * 2]},${state.origin[c * 2 + 1]}`);
		expect(seen.size).toBe(500);
	});
});

describe('factory simulation', () => {
	test('the same seed and steps give the same state', () => {
		const a = createFactory(40);
		const b = createFactory(40);
		run(a, stepsUntil(15));
		run(b, stepsUntil(15));
		expect([...a.joints]).toEqual([...b.joints]);
		expect([...a.crateState]).toEqual([...b.crateState]);
		expect([...a.crateDistance]).toEqual([...b.crateDistance]);
	});

	test('every arm runs through all nine states within a minute', () => {
		const state = createFactory(30);
		const seen = Array.from({ length: 30 }, () => new Set<number>());
		for (let i = 0; i < stepsUntil(60); i++) {
			stepFactory(state);
			for (let c = 0; c < 30; c++) seen[c]!.add(state.armState[c]!);
		}
		for (const states of seen) expect(states.size).toBe(Object.keys(ArmState).length);
	});

	test('a crate keeps its place and rotation when the arm grips it and when it lets go', () => {
		const cells = 12;
		const state = createFactory(cells);
		let grips = 0;
		let releases = 0;
		for (let i = 0; i < stepsUntil(40); i++) {
			const before: Pose[][] = [];
			const beforeState: number[][] = [];
			for (let c = 0; c < cells; c++) {
				before.push(Array.from({ length: CRATES_PER_CELL }, (_, k) => crateWorld(state, c, k)));
				beforeState.push(
					Array.from(
						{ length: CRATES_PER_CELL },
						(_, k) => state.crateState[c * CRATES_PER_CELL + k]!,
					),
				);
			}
			stepFactory(state);
			for (let c = 0; c < cells; c++) {
				for (let k = 0; k < CRATES_PER_CELL; k++) {
					const was = beforeState[c]![k]!;
					const now = state.crateState[c * CRATES_PER_CELL + k]!;
					const gripped = was === CrateState.belt && now === CrateState.held;
					const released = was === CrateState.held && now === CrateState.placed;
					if (!gripped && !released) continue;
					if (gripped) grips++;
					else releases++;
					const after = crateWorld(state, c, k);
					const old = before[c]![k]!;
					const jump = Math.hypot(
						after.position[0]! - old.position[0]!,
						after.position[1]! - old.position[1]!,
						after.position[2]! - old.position[2]!,
					);
					expect(jump).toBeLessThan(0.01);
					expect(sameRotation(after.rotation, old.rotation)).toBeCloseTo(1, 4);
				}
			}
		}
		expect(grips).toBeGreaterThan(cells);
		expect(releases).toBeGreaterThan(cells);
	});

	test('crates on a belt keep their spacing and never pass the pick point', () => {
		const state = createFactory(20);
		for (let i = 0; i < stepsUntil(45); i++) {
			stepFactory(state);
			for (let c = 0; c < 20; c++) {
				const onBelt: number[] = [];
				for (let k = 0; k < CRATES_PER_CELL; k++) {
					const index = c * CRATES_PER_CELL + k;
					if (state.crateState[index] === CrateState.belt) onBelt.push(state.crateDistance[index]!);
				}
				onBelt.sort((a, b) => a - b);
				expect(onBelt[0] ?? 0).toBeGreaterThanOrEqual(0);
				for (let j = 1; j < onBelt.length; j++)
					expect(onBelt[j]! - onBelt[j - 1]!).toBeGreaterThan(BELT_SPACING - 1e-4);
			}
		}
	});

	test('only the active cells move', () => {
		const state = createFactory(10);
		setActiveCells(state, 4);
		const frozen = [...state.joints.subarray(4 * 5)];
		run(state, stepsUntil(20));
		expect([...state.joints.subarray(4 * 5)]).toEqual(frozen);
		expect(state.armCycle.subarray(0, 4).some((cycle) => cycle > 0)).toBe(true);
	});
});
