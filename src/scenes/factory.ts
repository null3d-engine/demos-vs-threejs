// The factory: robot cells on a hall floor. Each cell has a robot arm (a tree of seven parts, six
// of which move every frame), a belt that brings crates, and a pallet where the arm puts them.
// The count is the number of moving parts; the scene adds whole cells of 10 moving parts.
//
// The arms run a state machine with seeded random timing, and crates move from belt to gripper to
// pallet. The motion depends on this state, not only on the time.

import {
	type CameraLoop,
	type Hex,
	hash01,
	lerp,
	type OutArray,
	quatMultiply,
	quatPitch,
	quatYaw,
	SIM_STEP,
	smoothstep,
	spiralCell,
} from './common';
import {
	boxGeometry,
	cylinderGeometry,
	type MeshData,
	translated,
	triangleCount,
} from './geometry';

export const FACTORY_SEED = 3;

// Layout.

/** Meters between the origins of neighbouring cells, along X and along Z. */
export const CELL_PITCH = 6;
export const CRATES_PER_CELL = 4;
/** Arm parts that move (turntable, upper arm, forearm, wrist, two fingers) plus the crates. */
export const MOVING_PER_CELL = 6 + CRATES_PER_CELL;
/** Parts that stand still: arm base, belt, pallet and a glowing floor line. */
export const STILL_PER_CELL = 4;
/** The hall floor. */
export const HALL_OBJECTS = 1;
/** The most cells a scene can hold: 2,000,000 moving parts. */
export const MAX_CELLS = 200_000;

/** Cells for a count of moving parts: whole cells, at least one. */
export function factoryCells(movingParts: number): number {
	return Math.max(1, Math.min(MAX_CELLS, Math.ceil(movingParts / MOVING_PER_CELL)));
}

/** Objects in the scene for a count of moving parts. */
export function factoryObjects(movingParts: number): number {
	return factoryCells(movingParts) * (MOVING_PER_CELL + STILL_PER_CELL) + HALL_OBJECTS;
}

// The arm. Parts are listed parent first; each part's mesh has its pivot at its origin.

export const ARM_PART = {
	base: 0,
	turntable: 1,
	upperArm: 2,
	forearm: 3,
	wrist: 4,
	fingerLeft: 5,
	fingerRight: 6,
} as const;
export const ARM_PARTS = 7;
/** The parent of each part, or -1 for the base, whose parent is the hall. */
export const ARM_PARENT: readonly number[] = [-1, 0, 1, 2, 3, 4, 4];

export const BASE_HEIGHT = 0.4;
export const TURNTABLE_HEIGHT = 0.3;
export const UPPER_LENGTH = 1.6;
export const FORE_LENGTH = 1.4;
export const WRIST_LENGTH = 0.3;
export const FINGER_LENGTH = 0.34;
/** The grip point, where a held crate's center is, along the wrist's +Y. */
export const GRIP_POINT = 0.57;
export const CRATE_SIZE = 0.5;
const GRIP_OPEN = 0.4;
const GRIP_CLOSED = CRATE_SIZE / 2 + 0.035;
/** The shoulder's height above the floor. */
const SHOULDER_HEIGHT = BASE_HEIGHT + TURNTABLE_HEIGHT;

/** Joint poses: shoulder, elbow and wrist pitch in radians. */
const HOME_POSE = [0.15, 1.25, 1.2] as const;
const PICK_POSE = [0.45, 1.8, 0.8] as const;

/** The grip point's horizontal reach and height for a pose, from the arm's lengths. */
export function gripPointOf(pose: readonly [number, number, number]): {
	reach: number;
	height: number;
} {
	const a1 = pose[0];
	const a2 = a1 + pose[1];
	const a3 = a2 + pose[2];
	return {
		reach: UPPER_LENGTH * Math.sin(a1) + FORE_LENGTH * Math.sin(a2) + GRIP_POINT * Math.sin(a3),
		height:
			SHOULDER_HEIGHT +
			UPPER_LENGTH * Math.cos(a1) +
			FORE_LENGTH * Math.cos(a2) +
			GRIP_POINT * Math.cos(a3),
	};
}

const PICK = gripPointOf(PICK_POSE);
/** Distance from a cell's origin to the pick point on the belt (at -Z) and the drop point (at +Z). */
export const REACH = PICK.reach;
/** Height of a crate's center on the belt, in the gripper and on the pallet. */
export const CRATE_HEIGHT = PICK.height;
/** The wrist's pitch from vertical at the pick pose. */
const PICK_WRIST_PITCH = PICK_POSE[0] + PICK_POSE[1] + PICK_POSE[2];

/**
 * A held crate's rotation in the wrist's frame, chosen so the crate keeps the rotation it had on
 * the belt at the moment the arm grips it: the inverse of the wrist's world rotation at the pick
 * pose, yaw(π) × pitch(θ).
 */
export const CRATE_IN_WRIST: Float64Array = (() => {
	const pitch = new Float64Array(4);
	const yaw = new Float64Array(4);
	const out = new Float64Array(4);
	quatPitch(pitch, 0, -PICK_WRIST_PITCH);
	quatYaw(yaw, 0, -Math.PI);
	quatMultiply(out, 0, pitch, 0, yaw, 0);
	return out;
})();

// Belts: crates move along +X toward the pick point at (0, CRATE_HEIGHT, -REACH).

export const BELT_SPEED = 0.6;
/** How far upstream of the pick point a crate starts. */
export const BELT_START = 2.6;
/** The least distance between two crates on a belt. */
export const BELT_SPACING = 0.7;
/** Seconds a crate stays on the pallet before it goes back to the belt. */
export const PLACED_SECONDS = 4;

// Arm states, in the order an arm runs them.

export const ArmState = {
	wait: 0,
	reach: 1,
	grip: 2,
	lift: 3,
	turn: 4,
	lower: 5,
	release: 6,
	raise: 7,
	back: 8,
} as const;
const STATE_COUNT = 9;
/** Base seconds of each state; each arm scales them by 0.8 to 1.2 per cycle. The wait is a minimum. */
const STATE_SECONDS = [0.3, 1.0, 0.4, 0.8, 1.2, 0.8, 0.3, 0.8, 1.2] as const;

export const CrateState = { belt: 0, held: 1, placed: 2 } as const;

/** Joint values per cell: yaw, shoulder, elbow, wrist, grip. */
export const JOINTS = 5;

/** The simulation state of every cell, in flat arrays sized for the most cells. */
export interface FactoryState {
	/** Cells with state. The first `activeCells` of them move. */
	capacity: number;
	activeCells: number;
	/** Cell origins on the floor, two floats (x, z) per cell. */
	origin: Float32Array;
	armState: Uint8Array;
	armTime: Float32Array;
	armDuration: Float32Array;
	armCycle: Uint32Array;
	nextCrate: Uint8Array;
	/** Joint values, JOINTS floats per cell. */
	joints: Float32Array;
	crateState: Uint8Array;
	/** A belt crate's distance upstream of the pick point. */
	crateDistance: Float32Array;
	/** A placed crate's seconds left on the pallet. */
	crateTimer: Float32Array;
}

function durationOf(cell: number, cycle: number, state: number): number {
	return (
		(STATE_SECONDS[state] as number) *
		(0.8 + 0.4 * hash01(FACTORY_SEED, cell, cycle * STATE_COUNT + state))
	);
}

/** Makes the state of `capacity` cells, all waiting with crates on their belts. Setup code. */
export function createFactory(capacity: number): FactoryState {
	const cells = Math.max(1, Math.min(MAX_CELLS, capacity));
	const origin = new Float32Array(cells * 2);
	const grid = new Int32Array(2);
	for (let c = 0; c < cells; c++) {
		spiralCell(c, grid, 0);
		origin[c * 2] = (grid[0] as number) * CELL_PITCH;
		origin[c * 2 + 1] = (grid[1] as number) * CELL_PITCH;
	}
	const state: FactoryState = {
		capacity: cells,
		activeCells: cells,
		origin,
		armState: new Uint8Array(cells),
		armTime: new Float32Array(cells),
		armDuration: new Float32Array(cells),
		armCycle: new Uint32Array(cells),
		nextCrate: new Uint8Array(cells),
		joints: new Float32Array(cells * JOINTS),
		crateState: new Uint8Array(cells * CRATES_PER_CELL),
		crateDistance: new Float32Array(cells * CRATES_PER_CELL),
		crateTimer: new Float32Array(cells * CRATES_PER_CELL),
	};
	for (let c = 0; c < cells; c++) {
		state.armDuration[c] = durationOf(c, 0, ArmState.wait);
		const lead = 1.5 * hash01(FACTORY_SEED, c, -1);
		for (let k = 0; k < CRATES_PER_CELL; k++) {
			state.crateDistance[c * CRATES_PER_CELL + k] = lead + k * BELT_SPACING;
		}
		writeJoints(state, c);
	}
	return state;
}

/** Sets how many cells move; the rest keep their state and are not drawn. */
export function setActiveCells(state: FactoryState, cells: number): void {
	state.activeCells = Math.max(1, Math.min(state.capacity, cells));
}

function writeJoints(state: FactoryState, c: number): void {
	const s = state.armState[c] as number;
	const t = smoothstep((state.armTime[c] as number) / (state.armDuration[c] as number));
	// Yaw: π faces the belt (-Z), 0 faces the pallet (+Z).
	let yaw = Math.PI;
	if (s === ArmState.turn) yaw = lerp(Math.PI, 0, t);
	else if (s >= ArmState.lower && s <= ArmState.raise) yaw = 0;
	else if (s === ArmState.back) yaw = lerp(0, Math.PI, t);
	// Pose: from home to pick and back.
	let toPick = 0;
	if (s === ArmState.reach || s === ArmState.lower) toPick = t;
	else if (s === ArmState.grip || s === ArmState.release) toPick = 1;
	else if (s === ArmState.lift || s === ArmState.raise) toPick = 1 - t;
	// Grip: open, closing, closed while carrying, opening.
	let closed = 0;
	if (s === ArmState.grip) closed = t;
	else if (s >= ArmState.lift && s <= ArmState.lower) closed = 1;
	else if (s === ArmState.release) closed = 1 - t;
	const j = c * JOINTS;
	state.joints[j] = yaw;
	state.joints[j + 1] = lerp(HOME_POSE[0], PICK_POSE[0], toPick);
	state.joints[j + 2] = lerp(HOME_POSE[1], PICK_POSE[1], toPick);
	state.joints[j + 3] = lerp(HOME_POSE[2], PICK_POSE[2], toPick);
	state.joints[j + 4] = lerp(GRIP_OPEN, GRIP_CLOSED, closed);
}

function nextState(state: FactoryState, c: number, s: number): void {
	const cycle = state.armCycle[c] as number;
	const crate = c * CRATES_PER_CELL + (state.nextCrate[c] as number);
	if (s === ArmState.grip) state.crateState[crate] = CrateState.held;
	if (s === ArmState.release) {
		state.crateState[crate] = CrateState.placed;
		state.crateTimer[crate] =
			PLACED_SECONDS * (0.75 + 0.5 * hash01(FACTORY_SEED, c, cycle * 31 + 7));
		state.nextCrate[c] = ((state.nextCrate[c] as number) + 1) % CRATES_PER_CELL;
	}
	let following = s + 1;
	let nextCycle = cycle;
	if (following === STATE_COUNT) {
		following = ArmState.wait;
		nextCycle = cycle + 1;
		state.armCycle[c] = nextCycle;
	}
	state.armState[c] = following;
	state.armTime[c] = 0;
	state.armDuration[c] = durationOf(c, nextCycle, following);
}

/** Runs one simulation step of SIM_STEP seconds for the active cells. Allocates nothing. */
export function stepFactory(state: FactoryState): void {
	const dt = SIM_STEP;
	for (let c = 0; c < state.activeCells; c++) {
		// Crates on the belt move toward the pick point and queue behind the next crate to pick.
		const next = state.nextCrate[c] as number;
		for (let k = 0; k < CRATES_PER_CELL; k++) {
			const i = c * CRATES_PER_CELL + k;
			const crateState = state.crateState[i] as number;
			if (crateState === CrateState.belt) {
				const rank = (k - next + CRATES_PER_CELL) % CRATES_PER_CELL;
				const d = (state.crateDistance[i] as number) - BELT_SPEED * dt;
				const least = rank * BELT_SPACING;
				state.crateDistance[i] = d < least ? least : d;
			} else if (crateState === CrateState.placed) {
				const left = (state.crateTimer[i] as number) - dt;
				if (left <= 0) {
					state.crateState[i] = CrateState.belt;
					state.crateDistance[i] = BELT_START;
					state.crateTimer[i] = 0;
				} else {
					state.crateTimer[i] = left;
				}
			}
		}
		// The arm.
		const s = state.armState[c] as number;
		const time = (state.armTime[c] as number) + dt;
		state.armTime[c] = time;
		if (time >= (state.armDuration[c] as number)) {
			if (s === ArmState.wait) {
				// Leave the wait only when the next crate is at the pick point.
				const i = c * CRATES_PER_CELL + next;
				if (state.crateState[i] === CrateState.belt && (state.crateDistance[i] as number) <= 1e-6) {
					nextState(state, c, s);
				} else {
					state.armTime[c] = state.armDuration[c] as number;
				}
			} else {
				nextState(state, c, s);
			}
		}
		writeJoints(state, c);
	}
}

// Transforms for the engines. Each writes a local position (3 floats) and rotation (4 floats).

/**
 * Writes an arm part's transform relative to its parent (ARM_PARENT). The base's transform is
 * relative to the hall: the cell's origin.
 */
export function armPartLocal(
	state: FactoryState,
	cell: number,
	part: number,
	outPosition: OutArray,
	outRotation: OutArray,
): void {
	const j = cell * JOINTS;
	let x = 0;
	let y = 0;
	let z = 0;
	outRotation[0] = 0;
	outRotation[1] = 0;
	outRotation[2] = 0;
	outRotation[3] = 1;
	switch (part) {
		case ARM_PART.base:
			x = state.origin[cell * 2] as number;
			z = state.origin[cell * 2 + 1] as number;
			break;
		case ARM_PART.turntable:
			y = BASE_HEIGHT;
			quatYaw(outRotation, 0, state.joints[j] as number);
			break;
		case ARM_PART.upperArm:
			y = TURNTABLE_HEIGHT;
			quatPitch(outRotation, 0, state.joints[j + 1] as number);
			break;
		case ARM_PART.forearm:
			y = UPPER_LENGTH;
			quatPitch(outRotation, 0, state.joints[j + 2] as number);
			break;
		case ARM_PART.wrist:
			y = FORE_LENGTH;
			quatPitch(outRotation, 0, state.joints[j + 3] as number);
			break;
		case ARM_PART.fingerLeft:
			x = -(state.joints[j + 4] as number);
			y = WRIST_LENGTH;
			break;
		case ARM_PART.fingerRight:
			x = state.joints[j + 4] as number;
			y = WRIST_LENGTH;
			break;
		default:
			throw new RangeError(`An arm has no part ${part}.`);
	}
	outPosition[0] = x;
	outPosition[1] = y;
	outPosition[2] = z;
}

/** A crate's parent: the hall (a world transform) or the wrist of its cell's arm. */
export const CrateParent = { hall: 0, wrist: 1 } as const;

/**
 * Writes crate k of a cell's transform and returns its parent. A held crate's transform is
 * relative to the wrist; the others are relative to the hall.
 */
export function crateTransform(
	state: FactoryState,
	cell: number,
	k: number,
	outPosition: OutArray,
	outRotation: OutArray,
): number {
	const i = cell * CRATES_PER_CELL + k;
	const crateState = state.crateState[i] as number;
	if (crateState === CrateState.held) {
		outPosition[0] = 0;
		outPosition[1] = GRIP_POINT;
		outPosition[2] = 0;
		for (let q = 0; q < 4; q++) outRotation[q] = CRATE_IN_WRIST[q] as number;
		return CrateParent.wrist;
	}
	const ox = state.origin[cell * 2] as number;
	const oz = state.origin[cell * 2 + 1] as number;
	outPosition[1] = CRATE_HEIGHT;
	if (crateState === CrateState.belt) {
		outPosition[0] = ox - (state.crateDistance[i] as number);
		outPosition[2] = oz - REACH;
		outRotation[0] = 0;
		outRotation[1] = 0;
		outRotation[2] = 0;
		outRotation[3] = 1;
	} else {
		outPosition[0] = ox;
		outPosition[2] = oz + REACH;
		quatYaw(outRotation, 0, Math.PI);
	}
	return CrateParent.hall;
}

// Still parts of a cell, relative to the cell's origin: belt, pallet and a glowing floor line
// beyond the pallet.

export const BELT_HEIGHT = CRATE_HEIGHT - CRATE_SIZE / 2;
const LINE_OFFSET = 1.1;

/** Writes a still part's world position: 0 belt, 1 pallet, 2 floor line. */
export function stillPartPosition(
	state: FactoryState,
	cell: number,
	part: number,
	out: OutArray,
): void {
	const ox = state.origin[cell * 2] as number;
	const oz = state.origin[cell * 2 + 1] as number;
	out[0] = ox;
	if (part === 0) {
		out[1] = BELT_HEIGHT / 2;
		out[2] = oz - REACH;
	} else if (part === 1) {
		out[1] = BELT_HEIGHT / 2;
		out[2] = oz + REACH;
	} else {
		out[1] = 0.01;
		out[2] = oz + REACH + LINE_OFFSET;
	}
}

/** The floor's side in meters, covering every cell of a capacity with a margin of one cell. */
export function floorSide(capacity: number): number {
	const ring = Math.ceil((Math.sqrt(Math.max(1, capacity)) - 1) / 2);
	return (2 * ring + 3) * CELL_PITCH;
}

// Looks.

/** One mesh per kind of part. Setup code. */
export function factoryMeshes(capacity: number): Record<FactoryMesh, MeshData> {
	const floor = floorSide(capacity);
	return {
		base: translated(cylinderGeometry(0.5, BASE_HEIGHT, 24), 0, BASE_HEIGHT / 2, 0),
		turntable: translated(cylinderGeometry(0.42, TURNTABLE_HEIGHT, 24), 0, TURNTABLE_HEIGHT / 2, 0),
		upperArm: translated(boxGeometry(0.28, UPPER_LENGTH, 0.28), 0, UPPER_LENGTH / 2, 0),
		forearm: translated(boxGeometry(0.24, FORE_LENGTH, 0.24), 0, FORE_LENGTH / 2, 0),
		wrist: translated(boxGeometry(0.32, WRIST_LENGTH, 0.32), 0, WRIST_LENGTH / 2, 0),
		finger: translated(boxGeometry(0.07, FINGER_LENGTH, 0.16), 0, FINGER_LENGTH / 2, 0),
		crate: boxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE),
		belt: boxGeometry(CELL_PITCH, BELT_HEIGHT, 0.7),
		pallet: boxGeometry(1.0, BELT_HEIGHT, 1.0),
		line: boxGeometry(CELL_PITCH * 0.8, 0.02, 0.12),
		floor: translated(boxGeometry(floor, 0.2, floor), 0, -0.1, 0),
	};
}

export type FactoryMesh =
	| 'base'
	| 'turntable'
	| 'upperArm'
	| 'forearm'
	| 'wrist'
	| 'finger'
	| 'crate'
	| 'belt'
	| 'pallet'
	| 'line'
	| 'floor';

/** Triangles in the scene for a count of moving parts. */
export function factoryTriangles(
	movingParts: number,
	meshes: Record<FactoryMesh, MeshData>,
): number {
	const perCell =
		triangleCount(meshes.base) +
		triangleCount(meshes.turntable) +
		triangleCount(meshes.upperArm) +
		triangleCount(meshes.forearm) +
		triangleCount(meshes.wrist) +
		2 * triangleCount(meshes.finger) +
		CRATES_PER_CELL * triangleCount(meshes.crate) +
		triangleCount(meshes.belt) +
		triangleCount(meshes.pallet) +
		triangleCount(meshes.line);
	return factoryCells(movingParts) * perCell + triangleCount(meshes.floor);
}

/**
 * Surface of each mesh. Floor lines are unlit: they shine like a light, their color times their
 * intensity, which is above the glow threshold.
 */
export const FACTORY_MATERIALS: Readonly<
	Record<
		FactoryMesh,
		{ color: Hex; roughness: number; metalness: number; unlit?: boolean; intensity?: number }
	>
> = {
	base: { color: '#3a3f47', roughness: 0.6, metalness: 0.4 },
	turntable: { color: '#f2a93b', roughness: 0.45, metalness: 0.2 },
	upperArm: { color: '#f2a93b', roughness: 0.45, metalness: 0.2 },
	forearm: { color: '#f2a93b', roughness: 0.45, metalness: 0.2 },
	wrist: { color: '#2b2f36', roughness: 0.5, metalness: 0.5 },
	finger: { color: '#9aa3ad', roughness: 0.35, metalness: 0.8 },
	crate: { color: '#b07a45', roughness: 0.85, metalness: 0 },
	belt: { color: '#23262b', roughness: 0.9, metalness: 0.1 },
	pallet: { color: '#6d5a3f', roughness: 0.9, metalness: 0 },
	line: { color: '#ffcf6b', roughness: 1, metalness: 0, unlit: true, intensity: 2.5 },
	floor: { color: '#5b6068', roughness: 0.95, metalness: 0 },
};

export const FACTORY_VIEW = {
	background: '#0e1116' as Hex,
	camera: { fov: 55, near: 0.1, far: 2000 },
	/** The sun through the roof: the direction the light travels. It casts the shadows. */
	sun: { direction: [-0.4, -1, -0.3] as const, color: '#fff1dc' as Hex, intensity: 2.2 },
	hemisphere: { sky: '#bcd0ff' as Hex, ground: '#3b3226' as Hex, intensity: 0.6 },
	/** Up to 8 real point lights, spread over the middle of the hall. */
	pointLights: [
		{ position: [0, 5.5, 0], color: '#ffd7a0', intensity: 60, range: 25 },
		{ position: [18, 5.5, 0], color: '#ffd7a0', intensity: 60, range: 25 },
		{ position: [-18, 5.5, 0], color: '#ffd7a0', intensity: 60, range: 25 },
		{ position: [0, 5.5, 18], color: '#ffd7a0', intensity: 60, range: 25 },
		{ position: [0, 5.5, -18], color: '#ffd7a0', intensity: 60, range: 25 },
		{ position: [18, 5.5, 18], color: '#a8c8ff', intensity: 40, range: 25 },
		{ position: [-18, 5.5, -18], color: '#a8c8ff', intensity: 40, range: 25 },
		{ position: [18, 5.5, -18], color: '#a8c8ff', intensity: 40, range: 25 },
	],
	fog: { color: '#0e1116' as Hex, near: 60, far: 260 },
	glow: { threshold: 1.2, strength: 0.45, radius: 0.1 },
} as const;

/** The camera circles the middle of the hall once a minute, with a slow rise and fall. */
export const FACTORY_CAMERA: CameraLoop = {
	seconds: 60,
	positions: [30, 16, 0, 0, 22, 30, -30, 16, 0, 0, 10, -30],
	targets: [0, 1.5, 0, 0, 1.5, 0, 0, 1.5, 0, 0, 1.5, 0],
};

/** The effects this scene uses. */
export const FACTORY_EFFECTS = ['shadows', 'fog', 'glow'] as const;
