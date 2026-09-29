// The city at night: blocks of buildings with lit windows and street lamps, cars that follow the
// streets and stop at traffic lights, and people who walk around the blocks. The count is the
// number of blocks; the city grows ring by ring around its middle. Most objects stand still.

import {
	type CameraLoop,
	type Hex,
	hash01,
	type OutArray,
	SIM_STEP,
	spiralCell,
	TAU,
} from './common';
import { boxGeometry, type MeshData, merged, translated, triangleCount } from './geometry';

export const CITY_SEED = 5;

// Layout. Block (bx, bz) is centered at (bx·PITCH, bz·PITCH); streets run between blocks, on the
// lines x = (k + 0.5)·PITCH and z = (k + 0.5)·PITCH.

export const BLOCK_SIZE = 40;
export const STREET_WIDTH = 12;
export const PITCH = BLOCK_SIZE + STREET_WIDTH;
export const BUILDINGS_PER_BLOCK = 9;
export const WINDOWS_PER_BUILDING = 4;
export const LAMPS_PER_BLOCK = 4;
/** Buildings, windows, lamp poles and lamp heads. */
export const STILL_PER_BLOCK =
	BUILDINGS_PER_BLOCK + BUILDINGS_PER_BLOCK * WINDOWS_PER_BUILDING + LAMPS_PER_BLOCK * 2;
export const CARS_PER_BLOCK = 4;
export const PEOPLE_PER_BLOCK = 6;
export const MOVING_PER_BLOCK = CARS_PER_BLOCK + PEOPLE_PER_BLOCK;
/** The ground. */
export const GROUND_OBJECTS = 1;
/** The most blocks: about 1.26 million objects. */
export const MAX_BLOCKS = 20_000;

export function cityBlocks(count: number): number {
	return Math.max(1, Math.min(MAX_BLOCKS, Math.round(count)));
}

/** Objects in the scene for a count of blocks. */
export function cityObjects(blocks: number): number {
	return cityBlocks(blocks) * (STILL_PER_BLOCK + MOVING_PER_BLOCK) + GROUND_OBJECTS;
}

/** The ring a block count reaches: blocks lie at grid distance 0 to ring from the middle. */
export function cityRing(blocks: number): number {
	return Math.ceil((Math.sqrt(cityBlocks(blocks)) - 1) / 2);
}

/** Writes a block's grid cell (bx, bz). */
export function blockCell(block: number, out: Int32Array): void {
	spiralCell(block, out, 0);
}

const cell = new Int32Array(2);

// Still objects. Each function computes one object's transform from the seed, so an engine fills
// its own buffers at setup without a second copy of the data here.

const LOT_OFFSETS = [-14, 0, 14] as const;

/**
 * Writes building b of a block: the position of its base center and its size (width, height,
 * depth), for a unit box whose pivot is at the middle of its bottom face. Returns a color index
 * into BUILDING_COLORS.
 */
export function buildingOf(
	block: number,
	b: number,
	outPosition: OutArray,
	outSize: OutArray,
): number {
	blockCell(block, cell);
	const bx = cell[0] as number;
	const bz = cell[1] as number;
	const distance = Math.hypot(bx, bz);
	const h = hash01(CITY_SEED, block, b * 5);
	outPosition[0] = bx * PITCH + (LOT_OFFSETS[b % 3] as number);
	outPosition[1] = 0;
	outPosition[2] = bz * PITCH + (LOT_OFFSETS[Math.floor(b / 3)] as number);
	outSize[0] = 9 + 3 * hash01(CITY_SEED, block, b * 5 + 1);
	outSize[1] = 8 + 44 * h * h + 60 * Math.exp(-distance / 5) * h;
	outSize[2] = 9 + 3 * hash01(CITY_SEED, block, b * 5 + 2);
	return Math.floor(hash01(CITY_SEED, block, b * 5 + 3) * BUILDING_COLORS.length);
}

const buildingPosition = new Float64Array(3);
const buildingSize = new Float64Array(3);

/**
 * Writes lit window w of building b: its center, its yaw in outYaw[0] (which face it is on) and
 * its size, for a unit box centered on its origin. Returns a color index into WINDOW_COLORS.
 */
export function windowOf(
	block: number,
	b: number,
	w: number,
	outPosition: OutArray,
	outSize: OutArray,
	outYaw: OutArray,
): number {
	buildingOf(block, b, buildingPosition, buildingSize);
	const key = 1000 + b * 16 + w * 3;
	const face = Math.floor(hash01(CITY_SEED, block, key) * 4);
	const along = hash01(CITY_SEED, block, key + 1) - 0.5;
	const floor = hash01(CITY_SEED, block, key + 2);
	const width = buildingSize[0] as number;
	const height = buildingSize[1] as number;
	const depth = buildingSize[2] as number;
	const halfFace = face % 2 === 0 ? depth / 2 : width / 2;
	const span = face % 2 === 0 ? width : depth;
	const yaw = (face * TAU) / 4;
	// Face 0 looks toward +Z, 1 toward +X, 2 toward -Z, 3 toward -X.
	const nx = Math.sin(yaw);
	const nz = Math.cos(yaw);
	const offset = along * (span - 5);
	outPosition[0] = (buildingPosition[0] as number) + nx * (halfFace + 0.06) + nz * offset;
	outPosition[1] = 2.5 + floor * (height - 5);
	outPosition[2] = (buildingPosition[2] as number) + nz * (halfFace + 0.06) - nx * offset;
	outSize[0] = 4;
	outSize[1] = 2.5;
	outSize[2] = 0.1;
	outYaw[0] = yaw;
	return Math.floor(hash01(CITY_SEED, block, 1003 + b * 16 + w * 3) * WINDOW_COLORS.length);
}

/** Writes the base of street lamp l of a block, at the block's corners on the pavement. */
export function lampOf(block: number, l: number, outPosition: OutArray): void {
	blockCell(block, cell);
	const corner = BLOCK_SIZE / 2 + 0.6;
	outPosition[0] = (cell[0] as number) * PITCH + (l & 1 ? corner : -corner);
	outPosition[1] = 0;
	outPosition[2] = (cell[1] as number) * PITCH + (l & 2 ? corner : -corner);
}

export const LAMP_POLE_HEIGHT = 6;

// Traffic lights: each crossing gives green to the X street, then to the Z street.

export const LIGHT_PERIOD = 20;
const GREEN_SECONDS = 8.5;

/** True when cars moving along `axis` (0: X, 1: Z) may cross crossing (mx, mz) at time t. */
export function isGreen(axis: number, mx: number, mz: number, t: number): boolean {
	const phase = (t + LIGHT_PERIOD * hash01(CITY_SEED, mx, mz)) % LIGHT_PERIOD;
	return axis === 0
		? phase < GREEN_SECONDS
		: phase >= LIGHT_PERIOD / 2 && phase < LIGHT_PERIOD / 2 + GREEN_SECONDS;
}

// Cars. A car drives along one street (axis and line) in one direction, keeping to the right.

export const CAR_LANE_OFFSET = 2.5;
const CAR_STOP_GAP = 8;
const CAR_BRAKE = 6;
const CAR_ACCELERATION = 3;

export const CarState = { drive: 0, stopped: 1 } as const;

/** What a car does at the next crossing. */
export const CarPlan = { none: 0, straight: 1, turnPlus: 2, turnMinus: 3, back: 4 } as const;
/** A car chooses its move this far before a crossing's center, at most. */
const PLAN_DISTANCE = 15;
/** A car inside a crossing (this close to its center) chooses nothing for it. */
const INSIDE_CROSSING = 4;

/** People walk around their block on the pavement, this far outside the block's edge. */
export const PAVEMENT_OFFSET = 1.5;
const PAVEMENT_SIDE = BLOCK_SIZE + 2 * PAVEMENT_OFFSET;

export interface CityState {
	capacity: number;
	activeBlocks: number;
	/** The ring the active blocks reach; cars stay inside it. */
	ring: number;
	time: number;
	carAxis: Uint8Array;
	/** The street line: the street is at (line + 0.5)·PITCH on the other axis. */
	carLine: Int32Array;
	/** Position along the axis. */
	carPosition: Float32Array;
	carDirection: Int8Array;
	carSpeed: Float32Array;
	carCruise: Float32Array;
	/** How far before a crossing's center the car stops for a red light. */
	carStopLine: Float32Array;
	carState: Uint8Array;
	/** Crossings passed, for per-crossing random choices. */
	carCrossings: Uint32Array;
	/** The move a car has chosen for the crossing ahead (CarPlan), made 4 to 15 m before it. */
	carPlan: Uint8Array;
	/** The crossing that carPlan is for. */
	carPlanCrossing: Int32Array;
	/** Position around the block's pavement, in meters from the block's first corner. */
	personPosition: Float32Array;
	personSpeed: Float32Array;
}

/** Makes the state of `capacity` blocks. Setup code. */
export function createCity(capacity: number): CityState {
	const blocks = cityBlocks(capacity);
	const cars = blocks * CARS_PER_BLOCK;
	const people = blocks * PEOPLE_PER_BLOCK;
	const state: CityState = {
		capacity: blocks,
		activeBlocks: blocks,
		ring: cityRing(blocks),
		time: 0,
		carAxis: new Uint8Array(cars),
		carLine: new Int32Array(cars),
		carPosition: new Float32Array(cars),
		carDirection: new Int8Array(cars),
		carSpeed: new Float32Array(cars),
		carCruise: new Float32Array(cars),
		carStopLine: new Float32Array(cars),
		carState: new Uint8Array(cars),
		carCrossings: new Uint32Array(cars),
		carPlan: new Uint8Array(cars),
		carPlanCrossing: new Int32Array(cars),
		personPosition: new Float32Array(people),
		personSpeed: new Float32Array(people),
	};
	for (let c = 0; c < cars; c++) placeCarAtHome(state, c);
	for (let p = 0; p < people; p++) {
		const block = Math.floor(p / PEOPLE_PER_BLOCK);
		state.personPosition[p] = 4 * PAVEMENT_SIDE * hash01(CITY_SEED, block, 3000 + p);
		const speed = 1.1 + 0.6 * hash01(CITY_SEED, block, 4000 + p);
		state.personSpeed[p] = hash01(CITY_SEED, block, 5000 + p) < 0.5 ? speed : -speed;
	}
	return state;
}

/** Puts a car on one of the four streets around its home block. */
function placeCarAtHome(state: CityState, c: number): void {
	const block = Math.floor(c / CARS_PER_BLOCK);
	blockCell(block, cell);
	const side = c % CARS_PER_BLOCK;
	const axis = side < 2 ? 0 : 1;
	// Sides 0 and 2 use the street before the block, 1 and 3 the street after it.
	const along = axis === 0 ? (cell[1] as number) : (cell[0] as number);
	const line = side % 2 === 0 ? along - 1 : along;
	const center = axis === 0 ? (cell[0] as number) : (cell[1] as number);
	state.carAxis[c] = axis;
	state.carLine[c] = line;
	state.carPosition[c] = center * PITCH + (hash01(CITY_SEED, c, 11) - 0.5) * BLOCK_SIZE;
	state.carDirection[c] = hash01(CITY_SEED, c, 12) < 0.5 ? 1 : -1;
	state.carCruise[c] = 8 + 6 * hash01(CITY_SEED, c, 13);
	state.carStopLine[c] = CAR_STOP_GAP + 6 * hash01(CITY_SEED, c, 14);
	state.carSpeed[c] = state.carCruise[c] as number;
	state.carState[c] = CarState.drive;
	state.carPlan[c] = CarPlan.none;
}

/** Sets how many blocks are drawn and move. Cars outside the new edge go back home. */
export function setActiveBlocks(state: CityState, blocks: number): void {
	const active = Math.max(1, Math.min(state.capacity, Math.round(blocks)));
	const ring = cityRing(active);
	if (ring < state.ring) {
		const limit = (ring + 0.5) * PITCH;
		for (let c = 0; c < active * CARS_PER_BLOCK; c++) {
			const lineCoordinate = ((state.carLine[c] as number) + 0.5) * PITCH;
			if (Math.abs(state.carPosition[c] as number) > limit || Math.abs(lineCoordinate) > limit)
				placeCarAtHome(state, c);
		}
	}
	state.activeBlocks = active;
	state.ring = ring;
}

/** The crossing index ahead of a position, in a direction: crossings are at (m + 0.5)·PITCH. */
function crossingAhead(position: number, direction: number): number {
	// The small margin keeps a car that sits on a crossing's center from finding that crossing again.
	const u = position / PITCH - 0.5;
	return direction > 0 ? Math.floor(u + 1e-4) + 1 : Math.ceil(u - 1e-4) - 1;
}

/** True when street line k lies inside a city that reaches ring `edge`. */
function inStreets(k: number, edge: number): boolean {
	return k >= -edge - 1 && k <= edge;
}

/**
 * Chooses the move at a crossing: straight (70%), or a turn onto the crossing street toward either
 * side, using only streets inside the city. At a corner of the city the car turns back.
 */
function plan(state: CityState, c: number, crossing: number): number {
	const direction = state.carDirection[c] as number;
	const line = state.carLine[c] as number;
	const edge = state.ring;
	const straightOk = inStreets(crossing + direction, edge);
	const pick = hash01(CITY_SEED, c, 100 + (state.carCrossings[c] as number));
	if (straightOk && pick >= 0.3) return CarPlan.straight;
	let turnTo = pick < 0.15 ? 1 : -1;
	if (!inStreets(line + turnTo, edge)) turnTo = -turnTo;
	if (inStreets(line + turnTo, edge)) return turnTo > 0 ? CarPlan.turnPlus : CarPlan.turnMinus;
	return straightOk ? CarPlan.straight : CarPlan.back;
}

/**
 * Where along its street a car makes its planned move. A turn happens where the car's lane meets
 * the lane of the new street, so the car's position does not jump.
 */
function movePoint(axis: number, crossing: number, planned: number): number {
	const center = (crossing + 0.5) * PITCH;
	if (planned !== CarPlan.turnPlus && planned !== CarPlan.turnMinus) return center;
	const turnTo = planned === CarPlan.turnPlus ? 1 : -1;
	// The new street runs along Z when the car drives along X: its lane is at x = center - turnTo·offset.
	// The new street runs along X when the car drives along Z: its lane is at z = center + turnTo·offset.
	return axis === 0 ? center - turnTo * CAR_LANE_OFFSET : center + turnTo * CAR_LANE_OFFSET;
}

/** Makes the planned move. `past` is how far the car went beyond the move point this step. */
function makeMove(
	state: CityState,
	c: number,
	crossing: number,
	planned: number,
	past: number,
): void {
	state.carCrossings[c] = (state.carCrossings[c] as number) + 1;
	state.carPlan[c] = CarPlan.none;
	const axis = state.carAxis[c] as number;
	const direction = state.carDirection[c] as number;
	const lineCoordinate = ((state.carLine[c] as number) + 0.5) * PITCH;
	if (planned === CarPlan.back) {
		state.carDirection[c] = -direction;
		return;
	}
	if (planned !== CarPlan.turnPlus && planned !== CarPlan.turnMinus) return;
	// The car keeps its place: its position along the new street is its old lane's coordinate.
	state.carPosition[c] =
		axis === 0
			? lineCoordinate + direction * CAR_LANE_OFFSET
			: lineCoordinate - direction * CAR_LANE_OFFSET;
	const turnTo = planned === CarPlan.turnPlus ? 1 : -1;
	state.carPosition[c] = (state.carPosition[c] as number) + turnTo * past;
	state.carAxis[c] = axis === 0 ? 1 : 0;
	state.carLine[c] = crossing;
	state.carDirection[c] = turnTo;
}

/** Runs one simulation step of SIM_STEP seconds. Allocates nothing. */
export function stepCity(state: CityState): void {
	const dt = SIM_STEP;
	state.time += dt;
	const t = state.time;
	const cars = state.activeBlocks * CARS_PER_BLOCK;
	for (let c = 0; c < cars; c++) {
		const axis = state.carAxis[c] as number;
		const direction = state.carDirection[c] as number;
		const position = state.carPosition[c] as number;
		let planned = state.carPlan[c] as number;
		const crossing =
			planned === CarPlan.none
				? crossingAhead(position, direction)
				: (state.carPlanCrossing[c] as number);
		const distance = ((crossing + 0.5) * PITCH - position) * direction;
		const line = state.carLine[c] as number;
		const mx = axis === 0 ? crossing : line;
		const mz = axis === 0 ? line : crossing;
		let speed = state.carSpeed[c] as number;
		const stopLine = state.carStopLine[c] as number;
		const mustStop =
			distance > stopLine - 0.5 && distance < stopLine + 25 && !isGreen(axis, mx, mz, t);
		if (mustStop) {
			speed = Math.max(0, speed - CAR_BRAKE * dt);
			if (distance - speed * dt < stopLine) speed = Math.max(0, (distance - stopLine) / dt);
			state.carState[c] = speed < 0.05 ? CarState.stopped : CarState.drive;
		} else {
			speed = Math.min(state.carCruise[c] as number, speed + CAR_ACCELERATION * dt);
			state.carState[c] = CarState.drive;
		}
		state.carSpeed[c] = speed;
		const next = position + direction * speed * dt;
		state.carPosition[c] = next;
		if (planned === CarPlan.none && distance > INSIDE_CROSSING && distance < PLAN_DISTANCE) {
			planned = plan(state, c, crossing);
			state.carPlan[c] = planned;
			state.carPlanCrossing[c] = crossing;
		}
		if (planned !== CarPlan.none) {
			const past = (next - movePoint(axis, crossing, planned)) * direction;
			if (past >= 0) makeMove(state, c, crossing, planned, past);
		}
	}
	const people = state.activeBlocks * PEOPLE_PER_BLOCK;
	const loop = 4 * PAVEMENT_SIDE;
	for (let p = 0; p < people; p++) {
		let s = (state.personPosition[p] as number) + (state.personSpeed[p] as number) * dt;
		if (s < 0) s += loop;
		else if (s >= loop) s -= loop;
		state.personPosition[p] = s;
	}
}

/** Writes car c's position and returns its yaw (0 faces +Z). */
export function carTransform(state: CityState, c: number, out: OutArray): number {
	const axis = state.carAxis[c] as number;
	const direction = state.carDirection[c] as number;
	const lineCoordinate = ((state.carLine[c] as number) + 0.5) * PITCH;
	const position = state.carPosition[c] as number;
	out[1] = 0;
	if (axis === 0) {
		// Moving along X; the right-hand side of +X is +Z.
		out[0] = position;
		out[2] = lineCoordinate + direction * CAR_LANE_OFFSET;
		return direction > 0 ? Math.PI / 2 : -Math.PI / 2;
	}
	// Moving along Z; the right-hand side of +Z is -X.
	out[0] = lineCoordinate - direction * CAR_LANE_OFFSET;
	out[2] = position;
	return direction > 0 ? 0 : Math.PI;
}

/** Writes person p's position and returns their yaw. */
export function personTransform(state: CityState, p: number, out: OutArray): number {
	const block = Math.floor(p / PEOPLE_PER_BLOCK);
	blockCell(block, cell);
	const half = PAVEMENT_SIDE / 2;
	const s = state.personPosition[p] as number;
	const edge = Math.floor(s / PAVEMENT_SIDE);
	const along = s - edge * PAVEMENT_SIDE - half;
	const forward = (state.personSpeed[p] as number) > 0;
	let x: number;
	let z: number;
	let yaw: number;
	// Edges run counter-clockwise seen from above: +X side, +Z side, -X side, -Z side.
	if (edge === 0) {
		x = half;
		z = along;
		yaw = 0;
	} else if (edge === 1) {
		x = -along;
		z = half;
		yaw = -Math.PI / 2;
	} else if (edge === 2) {
		x = -half;
		z = -along;
		yaw = Math.PI;
	} else {
		x = along;
		z = -half;
		yaw = Math.PI / 2;
	}
	out[0] = (cell[0] as number) * PITCH + x;
	out[1] = 0;
	out[2] = (cell[1] as number) * PITCH + z;
	return forward ? yaw : yaw + Math.PI;
}

// Looks.

export type CityMesh =
	| 'building'
	| 'window'
	| 'lampPole'
	| 'lampHead'
	| 'car'
	| 'person'
	| 'ground';

/** The ground's side in meters for a capacity of blocks. */
export function groundSide(capacity: number): number {
	return (2 * cityRing(capacity) + 3) * PITCH;
}

/** One mesh per kind of object. Setup code. */
export function cityMeshes(capacity: number): Record<CityMesh, MeshData> {
	const ground = groundSide(capacity);
	return {
		building: translated(boxGeometry(1, 1, 1), 0, 0.5, 0),
		window: boxGeometry(1, 1, 1),
		lampPole: translated(boxGeometry(0.2, LAMP_POLE_HEIGHT, 0.2), 0, LAMP_POLE_HEIGHT / 2, 0),
		lampHead: boxGeometry(0.9, 0.2, 0.45),
		// A car: body and cabin, with the front toward +Z.
		car: merged(
			translated(boxGeometry(1.9, 0.7, 4.3), 0, 0.55, 0),
			translated(boxGeometry(1.7, 0.6, 2.2), 0, 1.2, -0.3),
		),
		// A person: body and head, facing +Z.
		person: merged(
			translated(boxGeometry(0.45, 1.2, 0.3), 0, 0.85, 0),
			translated(boxGeometry(0.28, 0.3, 0.28), 0, 1.65, 0),
		),
		ground: translated(boxGeometry(ground, 0.2, ground), 0, -0.1, 0),
	};
}

/** Triangles in the scene for a count of blocks. */
export function cityTriangles(blocks: number, meshes: Record<CityMesh, MeshData>): number {
	const perBlock =
		BUILDINGS_PER_BLOCK * triangleCount(meshes.building) +
		BUILDINGS_PER_BLOCK * WINDOWS_PER_BUILDING * triangleCount(meshes.window) +
		LAMPS_PER_BLOCK * (triangleCount(meshes.lampPole) + triangleCount(meshes.lampHead)) +
		CARS_PER_BLOCK * triangleCount(meshes.car) +
		PEOPLE_PER_BLOCK * triangleCount(meshes.person);
	return cityBlocks(blocks) * perBlock + triangleCount(meshes.ground);
}

export const BUILDING_COLORS: readonly Hex[] = [
	'#6a7896',
	'#7a829c',
	'#5f6b86',
	'#86828f',
	'#71809e',
];
export const WINDOW_COLORS: readonly Hex[] = ['#ffd58a', '#ffe7b8', '#bfe3ff', '#ffc070'];
/** Light paints: under the blue moonlight, dark paints show black. */
export const CAR_COLORS: readonly Hex[] = ['#ff6a5c', '#f0f0f0', '#8fb8ff', '#b9c2cc', '#ffd65c'];

export const CITY_MATERIALS = {
	building: { roughness: 0.85, metalness: 0.1 },
	window: { unlit: true },
	lampPole: { color: '#454b55' as Hex, roughness: 0.6, metalness: 0.6 },
	lampHead: { color: '#fff2c4' as Hex, unlit: true },
	// Little metal: with no surroundings to reflect, metal paint shows almost black.
	car: { roughness: 0.45, metalness: 0.15 },
	person: { color: '#8c8f99' as Hex, roughness: 0.9, metalness: 0 },
	ground: { color: '#3a3f4c' as Hex, roughness: 0.95, metalness: 0 },
} as const;

export const CITY_VIEW = {
	background: '#05070d' as Hex,
	// The far plane ends just past the fog, so both engines skip what the fog hides.
	camera: { fov: 60, near: 0.5, far: 1400 },
	/** Moonlight: the direction the light travels. */
	sun: { direction: [0.3, -1, 0.5] as const, color: '#9fb4ff' as Hex, intensity: 2 },
	hemisphere: { sky: '#4a5c8f' as Hex, ground: '#1a1c24' as Hex, intensity: 3 },
	/** Real lights over the middle crossings; the lamp heads are unlit shapes. */
	pointLights: [
		{ position: [26, 6, 26], color: '#ffd28a', intensity: 120, range: 45 },
		{ position: [-26, 6, 26], color: '#ffd28a', intensity: 120, range: 45 },
		{ position: [26, 6, -26], color: '#ffd28a', intensity: 120, range: 45 },
		{ position: [-26, 6, -26], color: '#ffd28a', intensity: 120, range: 45 },
		{ position: [78, 6, 26], color: '#ffd28a', intensity: 120, range: 45 },
		{ position: [-78, 6, 26], color: '#ffd28a', intensity: 120, range: 45 },
		{ position: [26, 6, 78], color: '#ffd28a', intensity: 120, range: 45 },
		{ position: [26, 6, -78], color: '#ffd28a', intensity: 120, range: 45 },
	],
	fog: { color: '#05070d' as Hex, near: 80, far: 1200 },
} as const;

/**
 * The camera flies along an avenue at street level, climbs over the roofs, circles and comes back
 * down, once every 70 seconds. The curve through the points overshoots where the path turns, so
 * the path climbs and comes down along the avenue and turns only high above the roofs.
 */
export const CITY_CAMERA: CameraLoop = {
	seconds: 70,
	positions: [
		-260, 6, 26, -130, 6, 26, 0, 6, 26, 130, 8, 26, 240, 40, 26, 320, 160, 26, 200, 190, 280, -200,
		190, 280, -400, 150, 26, -380, 28, 26,
	],
	targets: [
		-100, 6, 26, 30, 6, 26, 160, 6, 26, 290, 12, 26, 360, 60, 26, 0, 0, 0, 0, 0, 0, 0, 0, 0, -200,
		0, 26, -200, 4, 26,
	],
};

export const CITY_EFFECTS = ['fog', 'glow'] as const;
