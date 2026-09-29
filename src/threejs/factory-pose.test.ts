import { describe, expect, test } from 'bun:test';
import { stepsUntil } from '../scenes/common';
import {
	ARM_PARENT,
	ARM_PART,
	ARM_PARTS,
	armPartLocal,
	CRATES_PER_CELL,
	CrateParent,
	CrateState,
	crateTransform,
	createFactory,
	type FactoryState,
	stepFactory,
} from '../scenes/factory';
import { chain, type Pose } from '../scenes/testing';
import { type FactoryMatrices, poseFactory } from './factory-pose';
import { writeQuaternionMatrix } from './matrices';

/** World poses of a cell's arm parts, parent first, as null3D's hierarchy computes them. */
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

function matrixOf(pose: Pose): Float32Array {
	const out = new Float32Array(16);
	const [x, y, z, w] = pose.rotation as [number, number, number, number];
	const [px, py, pz] = pose.position as [number, number, number];
	writeQuaternionMatrix(out, 0, x, y, z, w, px, py, pz);
	return out;
}

function expectSameMatrix(actual: Float32Array, offset: number, expected: Float32Array): void {
	for (let e = 0; e < 16; e++) expect(actual[offset + e]!).toBeCloseTo(expected[e]!, 4);
}

describe('poseFactory', () => {
	test('matches the parent-first world transforms for every moving part and crate', () => {
		const cells = 16;
		const state = createFactory(cells);
		const out: FactoryMatrices = {
			turntable: new Float32Array(cells * 16),
			upperArm: new Float32Array(cells * 16),
			forearm: new Float32Array(cells * 16),
			wrist: new Float32Array(cells * 16),
			finger: new Float32Array(cells * 32),
			crate: new Float32Array(cells * CRATES_PER_CELL * 16),
		};
		let heldChecked = 0;
		for (let moment = 0; moment < 40; moment++) {
			for (let i = 0; i < stepsUntil(0.5); i++) stepFactory(state);
			poseFactory(state, cells, out);
			for (let c = 0; c < cells; c++) {
				const world = armWorld(state, c);
				expectSameMatrix(out.turntable, c * 16, matrixOf(world[ARM_PART.turntable]!));
				expectSameMatrix(out.upperArm, c * 16, matrixOf(world[ARM_PART.upperArm]!));
				expectSameMatrix(out.forearm, c * 16, matrixOf(world[ARM_PART.forearm]!));
				expectSameMatrix(out.wrist, c * 16, matrixOf(world[ARM_PART.wrist]!));
				expectSameMatrix(out.finger, c * 32, matrixOf(world[ARM_PART.fingerLeft]!));
				expectSameMatrix(out.finger, c * 32 + 16, matrixOf(world[ARM_PART.fingerRight]!));
				for (let k = 0; k < CRATES_PER_CELL; k++) {
					const position = [0, 0, 0];
					const rotation = [0, 0, 0, 1];
					const parent = crateTransform(state, c, k, position, rotation);
					const local = { position, rotation };
					const crate = parent === CrateParent.hall ? local : chain(world[ARM_PART.wrist]!, local);
					expectSameMatrix(out.crate, (c * CRATES_PER_CELL + k) * 16, matrixOf(crate));
					if (state.crateState[c * CRATES_PER_CELL + k] === CrateState.held) heldChecked++;
				}
			}
		}
		expect(heldChecked).toBeGreaterThan(20);
	});
});
