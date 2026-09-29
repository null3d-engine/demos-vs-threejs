// The battle: two armies of animated soldiers, with a mech in every hundred and tanks, meet on open
// ground. Soldiers march, find the nearest enemy, turn and aim at it, and fire tracers. Tanks turn
// their turrets and fire shells that explode. A fallen soldier plays its fall, lies still, and
// joins the back of its army again. The count is soldiers per army.
//
// The game logic is kept cheap on purpose: it runs on one thread in both engines. Target search
// uses a grid and runs five times a second for each soldier, spread over the steps.

import {
	angleDifference,
	type CameraLoop,
	clamp,
	type Hex,
	hash01,
	type OutArray,
	quatAxisAngle,
	SIM_STEP,
} from './common';
import { boxGeometry, type MeshData, sphereGeometry, translated, triangleCount } from './geometry';

export const BATTLE_SEED = 7;

// Armies and formations. Army 0 starts at -X and faces +X; army 1 starts at +X and faces -X.
// Unit i belongs to army i & 1 and has formation slot i >> 1, so a count covers both armies evenly.

export const MAX_PER_ARMY = 20_000;
export const SPAWN_X = 150;
export const FORMATION_COLUMNS = 120;
export const COLUMN_SPACING = 1.6;
export const ROW_SPACING = 2;
/** Every hundredth slot of an army holds a mech. */
export const MECH_EVERY = 100;
/** One tank for every 50 soldiers of an army, and at least one. */
export const SOLDIERS_PER_TANK = 50;
export const TANK_PARTS = 3;
/** The ground. */
export const GROUND_OBJECTS = 1;

export const UnitKind = { soldier: 0, mech: 1 } as const;
export const UnitState = { march: 0, fight: 1, dead: 2 } as const;

/** Animation clips of soldiers and mechs. IDLE, RUN and SHOOT loop; DIE plays once. */
export const Clip = { idle: 0, run: 1, shoot: 2, die: 3 } as const;
export const CLIP_FADE_SECONDS = 0.25;

const SOLDIER = { speed: 2.6, range: 45, fireSeconds: 1.7, hitChance: 0.25 } as const;
const MECH = { speed: 1.6, range: 60, fireSeconds: 0.7, hitChance: 0.35 } as const;
const TANK = { speed: 1.2, range: 90, fireSeconds: 5, blastRadius: 4, blastKills: 6 } as const;
const DEAD_SECONDS = 4;
const TURN_RATE = 3;
/** Soldiers search for targets once every this many steps: five times a second at 120 steps. */
const SEARCH_EVERY = 24;
const MAX_AIM = 0.9;
const TRACER_SPEED = 140;
const SHELL_SPEED = 90;
const EXPLOSION_SECONDS = 1.2;
const MUZZLE_HEIGHT = 1.35;

export function tanksPerArmy(soldiers: number): number {
	return Math.max(1, Math.floor(soldiers / SOLDIERS_PER_TANK));
}

export function battleSoldiers(count: number): number {
	return Math.max(1, Math.min(MAX_PER_ARMY, Math.round(count)));
}

export function mechsPerArmy(soldiers: number): number {
	return Math.floor(battleSoldiers(soldiers) / MECH_EVERY);
}

export function unitKindOf(i: number): number {
	return (i >> 1) % MECH_EVERY === MECH_EVERY - 1 ? UnitKind.mech : UnitKind.soldier;
}

/** Writes a formation slot's position on the ground (x, z). */
export function formationSlot(army: number, slot: number, out: OutArray): void {
	const row = Math.floor(slot / FORMATION_COLUMNS);
	const column = slot % FORMATION_COLUMNS;
	const side = army === 0 ? -1 : 1;
	out[0] = side * (SPAWN_X + row * ROW_SPACING);
	out[1] = (column - (FORMATION_COLUMNS - 1) / 2) * COLUMN_SPACING;
}

// The spatial grid: one per army, rebuilt every step from the living units.

const CELL = 10;
const GRID_HALF_X = 500;
const GRID_HALF_Z = 160;
const GRID_X = (2 * GRID_HALF_X) / CELL;
const GRID_Z = (2 * GRID_HALF_Z) / CELL;
const GRID_CELLS = GRID_X * GRID_Z;

function cellX(x: number): number {
	return clamp(Math.floor((x + GRID_HALF_X) / CELL), 0, GRID_X - 1);
}

function cellZ(z: number): number {
	return clamp(Math.floor((z + GRID_HALF_Z) / CELL), 0, GRID_Z - 1);
}

export interface BattleState {
	/** Units per army with state. */
	capacity: number;
	/** Soldiers per army that take part (mechs included). */
	active: number;
	step: number;
	time: number;
	// Units: soldiers and mechs, 2 × capacity.
	kind: Uint8Array;
	state: Uint8Array;
	stateTime: Float32Array;
	x: Float32Array;
	z: Float32Array;
	heading: Float32Array;
	/** The spine's turn toward the target, relative to the heading. */
	aim: Float32Array;
	target: Int32Array;
	cooldown: Float32Array;
	clip: Uint8Array;
	clipTime: Float32Array;
	previousClip: Uint8Array;
	previousTime: Float32Array;
	/** From 0 (all previous clip) to 1 (all current clip). */
	fade: Float32Array;
	deaths: Uint32Array;
	// Tanks: 2 × tank capacity.
	tankCapacity: number;
	tankX: Float32Array;
	tankZ: Float32Array;
	tankHeading: Float32Array;
	tankTurret: Float32Array;
	tankTarget: Int32Array;
	tankCooldown: Float32Array;
	// Tracers and shells: rings of flights from a start to an end point.
	flights: number;
	flightActive: Uint8Array;
	/** 0 tracer, 1 shell. */
	flightKind: Uint8Array;
	flightFrom: Float32Array;
	flightTo: Float32Array;
	flightAge: Float32Array;
	flightDuration: Float32Array;
	flightTarget: Int32Array;
	flightChance: Float32Array;
	flightArmy: Uint8Array;
	flightNext: number;
	activeFlights: number;
	flightCount: number;
	// Explosions.
	blasts: number;
	blastActive: Uint8Array;
	blastPosition: Float32Array;
	blastAge: Float32Array;
	blastNext: number;
	activeBlasts: number;
	// Grids, one per army.
	cellStart: Int32Array[];
	cellCursor: Int32Array;
	sorted: Int32Array[];
	shots: number;
}

const slot = new Float64Array(2);

function resetUnit(s: BattleState, i: number): void {
	formationSlot(i & 1, i >> 1, slot);
	s.x[i] = slot[0] as number;
	s.z[i] = slot[1] as number;
	s.heading[i] = (i & 1) === 0 ? Math.PI / 2 : -Math.PI / 2;
	s.state[i] = UnitState.march;
	s.stateTime[i] = 0;
	s.aim[i] = 0;
	s.target[i] = -1;
	s.cooldown[i] = hash01(BATTLE_SEED, i, 1) * SOLDIER.fireSeconds;
	s.clip[i] = Clip.run;
	s.clipTime[i] = hash01(BATTLE_SEED, i, 2);
	s.previousClip[i] = Clip.run;
	s.previousTime[i] = 0;
	s.fade[i] = 1;
}

function resetTank(s: BattleState, t: number): void {
	const army = t & 1;
	const index = t >> 1;
	const side = army === 0 ? -1 : 1;
	const row = Math.floor(index / 20);
	const column = index % 20;
	s.tankX[t] = side * (SPAWN_X - 12 + row * 14);
	s.tankZ[t] = (column - 9.5) * 9;
	s.tankHeading[t] = army === 0 ? Math.PI / 2 : -Math.PI / 2;
	s.tankTurret[t] = 0;
	s.tankTarget[t] = -1;
	s.tankCooldown[t] = hash01(BATTLE_SEED, t, 3) * TANK.fireSeconds;
}

/** Makes the state of both armies at `capacity` soldiers each, all in formation. Setup code. */
export function createBattle(capacity: number): BattleState {
	const perArmy = battleSoldiers(capacity);
	const units = perArmy * 2;
	const tanks = tanksPerArmy(perArmy) * 2;
	const flights = Math.max(512, Math.min(80_000, units));
	const blasts = Math.max(64, tanks * 2);
	const s: BattleState = {
		capacity: perArmy,
		active: perArmy,
		step: 0,
		time: 0,
		kind: new Uint8Array(units),
		state: new Uint8Array(units),
		stateTime: new Float32Array(units),
		x: new Float32Array(units),
		z: new Float32Array(units),
		heading: new Float32Array(units),
		aim: new Float32Array(units),
		target: new Int32Array(units),
		cooldown: new Float32Array(units),
		clip: new Uint8Array(units),
		clipTime: new Float32Array(units),
		previousClip: new Uint8Array(units),
		previousTime: new Float32Array(units),
		fade: new Float32Array(units),
		deaths: new Uint32Array(units),
		tankCapacity: tanks / 2,
		tankX: new Float32Array(tanks),
		tankZ: new Float32Array(tanks),
		tankHeading: new Float32Array(tanks),
		tankTurret: new Float32Array(tanks),
		tankTarget: new Int32Array(tanks),
		tankCooldown: new Float32Array(tanks),
		flights,
		flightActive: new Uint8Array(flights),
		flightKind: new Uint8Array(flights),
		flightFrom: new Float32Array(flights * 3),
		flightTo: new Float32Array(flights * 3),
		flightAge: new Float32Array(flights),
		flightDuration: new Float32Array(flights),
		flightTarget: new Int32Array(flights),
		flightChance: new Float32Array(flights),
		flightArmy: new Uint8Array(flights),
		flightNext: 0,
		activeFlights: 0,
		flightCount: 0,
		blasts,
		blastActive: new Uint8Array(blasts),
		blastPosition: new Float32Array(blasts * 3),
		blastAge: new Float32Array(blasts),
		blastNext: 0,
		activeBlasts: 0,
		cellStart: [new Int32Array(GRID_CELLS + 1), new Int32Array(GRID_CELLS + 1)],
		cellCursor: new Int32Array(GRID_CELLS),
		sorted: [new Int32Array(perArmy), new Int32Array(perArmy)],
		shots: 0,
	};
	for (let i = 0; i < units; i++) {
		s.kind[i] = unitKindOf(i);
		resetUnit(s, i);
	}
	for (let t = 0; t < tanks; t++) resetTank(s, t);
	return s;
}

/** Sets the soldiers per army that take part. New soldiers join at their formation slot. */
export function setActiveSoldiers(s: BattleState, count: number): void {
	const next = Math.max(1, Math.min(s.capacity, Math.round(count)));
	for (let i = s.active * 2; i < next * 2; i++) resetUnit(s, i);
	const tanksBefore = tanksPerArmy(s.active);
	const tanksAfter = Math.min(s.tankCapacity, tanksPerArmy(next));
	for (let t = tanksBefore * 2; t < tanksAfter * 2; t++) resetTank(s, t);
	s.active = next;
}

/** Tanks per army that take part. */
export function activeTanks(s: BattleState): number {
	return Math.min(s.tankCapacity, tanksPerArmy(s.active));
}

function setClip(s: BattleState, i: number, clip: number): void {
	if (s.clip[i] === clip) return;
	s.previousClip[i] = s.clip[i] as number;
	s.previousTime[i] = s.clipTime[i] as number;
	s.clip[i] = clip;
	s.clipTime[i] = 0;
	s.fade[i] = 0;
}

function kill(s: BattleState, i: number): void {
	if (s.state[i] === UnitState.dead) return;
	s.state[i] = UnitState.dead;
	s.stateTime[i] = 0;
	s.target[i] = -1;
	s.aim[i] = 0;
	s.deaths[i] = (s.deaths[i] as number) + 1;
	setClip(s, i, Clip.die);
}

function buildGrids(s: BattleState): void {
	const units = s.active * 2;
	for (let army = 0; army < 2; army++) {
		const start = s.cellStart[army] as Int32Array;
		start.fill(0);
		for (let i = army; i < units; i += 2) {
			if (s.state[i] === UnitState.dead) continue;
			const c = cellZ(s.z[i] as number) * GRID_X + cellX(s.x[i] as number);
			start[c + 1] = (start[c + 1] as number) + 1;
		}
		for (let c = 0; c < GRID_CELLS; c++)
			start[c + 1] = (start[c + 1] as number) + (start[c] as number);
		const cursor = s.cellCursor;
		cursor.set(start.subarray(0, GRID_CELLS));
		const sorted = s.sorted[army] as Int32Array;
		for (let i = army; i < units; i += 2) {
			if (s.state[i] === UnitState.dead) continue;
			const c = cellZ(s.z[i] as number) * GRID_X + cellX(s.x[i] as number);
			const at = cursor[c] as number;
			sorted[at] = i;
			cursor[c] = at + 1;
		}
	}
}

/** The nearest living enemy of `army` within `range` of (x, z), or -1. Rings of cells outward. */
function nearestEnemy(s: BattleState, army: number, x: number, z: number, range: number): number {
	const enemies = 1 - army;
	const start = s.cellStart[enemies] as Int32Array;
	const sorted = s.sorted[enemies] as Int32Array;
	const cx = cellX(x);
	const cz = cellZ(z);
	const rings = Math.ceil(range / CELL);
	let best = -1;
	let bestDistance = range * range;
	for (let r = 0; r <= rings; r++) {
		for (let gz = cz - r; gz <= cz + r; gz++) {
			if (gz < 0 || gz >= GRID_Z) continue;
			const edgeRow = gz === cz - r || gz === cz + r;
			for (let gx = cx - r; gx <= cx + r; gx += edgeRow || r === 0 ? 1 : 2 * r) {
				if (gx < 0 || gx >= GRID_X) continue;
				const c = gz * GRID_X + gx;
				for (let k = start[c] as number; k < (start[c + 1] as number); k++) {
					const j = sorted[k] as number;
					const dx = (s.x[j] as number) - x;
					const dz = (s.z[j] as number) - z;
					const d = dx * dx + dz * dz;
					if (d < bestDistance) {
						bestDistance = d;
						best = j;
					}
				}
			}
		}
		// Cells beyond the next ring are at least r cells away; stop once a hit is that close.
		if (best >= 0 && bestDistance <= r * r * CELL * CELL) break;
	}
	return best;
}

function launch(
	s: BattleState,
	kind: number,
	army: number,
	fromX: number,
	fromY: number,
	fromZ: number,
	target: number,
	chance: number,
	speed: number,
): void {
	const f = s.flightNext;
	s.flightNext = (f + 1) % s.flights;
	if (s.flightActive[f] === 0) s.activeFlights++;
	s.flightActive[f] = 1;
	s.flightKind[f] = kind;
	s.flightArmy[f] = army;
	s.flightFrom[f * 3] = fromX;
	s.flightFrom[f * 3 + 1] = fromY;
	s.flightFrom[f * 3 + 2] = fromZ;
	const toX = s.x[target] as number;
	const toZ = s.z[target] as number;
	s.flightTo[f * 3] = toX;
	s.flightTo[f * 3 + 1] = kind === 0 ? 1.2 : 0.5;
	s.flightTo[f * 3 + 2] = toZ;
	const distance = Math.hypot(toX - fromX, toZ - fromZ);
	s.flightAge[f] = 0;
	s.flightDuration[f] = Math.max(0.05, distance / speed);
	s.flightTarget[f] = target;
	s.flightChance[f] = chance;
	s.flightCount++;
}

function explode(s: BattleState, x: number, z: number, army: number): void {
	const b = s.blastNext;
	s.blastNext = (b + 1) % s.blasts;
	if (s.blastActive[b] === 0) s.activeBlasts++;
	s.blastActive[b] = 1;
	s.blastPosition[b * 3] = x;
	s.blastPosition[b * 3 + 1] = 0.5;
	s.blastPosition[b * 3 + 2] = z;
	s.blastAge[b] = 0;
	// The blast hits the enemies of the army that fired it, near the point.
	const enemies = 1 - army;
	const start = s.cellStart[enemies] as Int32Array;
	const sorted = s.sorted[enemies] as Int32Array;
	const cx = cellX(x);
	const cz = cellZ(z);
	let kills = 0;
	const r2 = TANK.blastRadius * TANK.blastRadius;
	for (let gz = cz - 1; gz <= cz + 1 && kills < TANK.blastKills; gz++) {
		if (gz < 0 || gz >= GRID_Z) continue;
		for (let gx = cx - 1; gx <= cx + 1 && kills < TANK.blastKills; gx++) {
			if (gx < 0 || gx >= GRID_X) continue;
			const c = gz * GRID_X + gx;
			for (
				let k = start[c] as number;
				k < (start[c + 1] as number) && kills < TANK.blastKills;
				k++
			) {
				const j = sorted[k] as number;
				const dx = (s.x[j] as number) - x;
				const dz = (s.z[j] as number) - z;
				if (dx * dx + dz * dz <= r2 && s.state[j] !== UnitState.dead) {
					kill(s, j);
					kills++;
				}
			}
		}
	}
}

function turnToward(current: number, wanted: number, dt: number): number {
	const d = angleDifference(wanted, current);
	const most = TURN_RATE * dt;
	return current + (d > most ? most : d < -most ? -most : d);
}

/** Runs one simulation step of SIM_STEP seconds. Allocates nothing. */
export function stepBattle(s: BattleState): void {
	const dt = SIM_STEP;
	s.step++;
	s.time += dt;
	buildGrids(s);
	const units = s.active * 2;
	const phase = s.step % SEARCH_EVERY;
	for (let i = 0; i < units; i++) {
		const army = i & 1;
		const mech = s.kind[i] === UnitKind.mech;
		const stats = mech ? MECH : SOLDIER;
		s.clipTime[i] = (s.clipTime[i] as number) + dt;
		s.previousTime[i] = (s.previousTime[i] as number) + dt;
		const fade = (s.fade[i] as number) + dt / CLIP_FADE_SECONDS;
		s.fade[i] = fade > 1 ? 1 : fade;
		if (s.state[i] === UnitState.dead) {
			const t = (s.stateTime[i] as number) + dt;
			s.stateTime[i] = t;
			if (t >= DEAD_SECONDS) resetUnit(s, i);
			continue;
		}
		// Search for a target five times a second, each unit on its own step.
		let target = s.target[i] as number;
		if (target >= 0 && (s.state[target] === UnitState.dead || target >= units)) target = -1;
		const x = s.x[i] as number;
		const z = s.z[i] as number;
		if (i % SEARCH_EVERY === phase) target = nearestEnemy(s, army, x, z, stats.range);
		s.target[i] = target;
		const forward = army === 0 ? Math.PI / 2 : -Math.PI / 2;
		if (target >= 0) {
			const dx = (s.x[target] as number) - x;
			const dz = (s.z[target] as number) - z;
			const bearing = Math.atan2(dx, dz);
			const inRange = dx * dx + dz * dz <= stats.range * stats.range;
			if (inRange) {
				s.state[i] = UnitState.fight;
				const heading = turnToward(s.heading[i] as number, bearing, dt);
				s.heading[i] = heading;
				s.aim[i] = clamp(angleDifference(bearing, heading), -MAX_AIM, MAX_AIM);
				setClip(s, i, Clip.shoot);
				const cooldown = (s.cooldown[i] as number) - dt;
				if (cooldown <= 0) {
					s.cooldown[i] = stats.fireSeconds * (0.8 + 0.4 * hash01(BATTLE_SEED, i, s.step));
					launch(s, 0, army, x, MUZZLE_HEIGHT, z, target, stats.hitChance, TRACER_SPEED);
					s.shots++;
				} else {
					s.cooldown[i] = cooldown;
				}
				continue;
			}
		}
		// March toward the enemy's side, and turn toward a seen target.
		s.state[i] = UnitState.march;
		s.aim[i] = 0;
		const wanted =
			target >= 0 ? Math.atan2((s.x[target] as number) - x, (s.z[target] as number) - z) : forward;
		const heading = turnToward(s.heading[i] as number, wanted, dt);
		s.heading[i] = heading;
		const limit = SPAWN_X + 20;
		const ahead = army === 0 ? x < limit : x > -limit;
		if (ahead) {
			s.x[i] = x + Math.sin(heading) * stats.speed * dt;
			s.z[i] = clamp(z + Math.cos(heading) * stats.speed * dt, -GRID_HALF_Z + 1, GRID_HALF_Z - 1);
			setClip(s, i, Clip.run);
		} else {
			setClip(s, i, Clip.idle);
		}
	}
	// Tanks.
	const tanks = activeTanks(s) * 2;
	for (let t = 0; t < tanks; t++) {
		const army = t & 1;
		const x = s.tankX[t] as number;
		const z = s.tankZ[t] as number;
		let target = s.tankTarget[t] as number;
		if (target >= 0 && (target >= units || s.state[target] === UnitState.dead)) target = -1;
		if (t % SEARCH_EVERY === s.step % SEARCH_EVERY)
			target = nearestEnemy(s, army, x, z, TANK.range);
		s.tankTarget[t] = target;
		const heading = s.tankHeading[t] as number;
		if (target >= 0) {
			const bearing = Math.atan2((s.x[target] as number) - x, (s.z[target] as number) - z);
			s.tankTurret[t] =
				turnToward((s.tankTurret[t] as number) + heading, bearing, dt * 0.5) - heading;
			const cooldown = (s.tankCooldown[t] as number) - dt;
			if (cooldown <= 0) {
				s.tankCooldown[t] =
					TANK.fireSeconds * (0.8 + 0.4 * hash01(BATTLE_SEED, t + 100_000, s.step));
				launch(s, 1, army, x, 2.2, z, target, 1, SHELL_SPEED);
			} else {
				s.tankCooldown[t] = cooldown;
			}
		} else {
			s.tankTurret[t] = turnToward(s.tankTurret[t] as number, 0, dt * 0.5);
			const limit = SPAWN_X - 40;
			if (army === 0 ? x < limit : x > -limit) s.tankX[t] = x + Math.sin(heading) * TANK.speed * dt;
		}
	}
	// Flights: tracers may hit their target; shells explode where they land.
	for (let f = 0; f < s.flights; f++) {
		if (s.flightActive[f] === 0) continue;
		const age = (s.flightAge[f] as number) + dt;
		s.flightAge[f] = age;
		if (age < (s.flightDuration[f] as number)) continue;
		s.flightActive[f] = 0;
		s.activeFlights--;
		const target = s.flightTarget[f] as number;
		if (s.flightKind[f] === 0) {
			if (
				target < units &&
				hash01(BATTLE_SEED, f, s.flightCount + s.step) < (s.flightChance[f] as number)
			)
				kill(s, target);
		} else {
			explode(
				s,
				s.flightTo[f * 3] as number,
				s.flightTo[f * 3 + 2] as number,
				s.flightArmy[f] as number,
			);
		}
	}
	for (let b = 0; b < s.blasts; b++) {
		if (s.blastActive[b] === 0) continue;
		const age = (s.blastAge[b] as number) + dt;
		s.blastAge[b] = age;
		if (age >= EXPLOSION_SECONDS) {
			s.blastActive[b] = 0;
			s.activeBlasts--;
		}
	}
}

// Transforms and counts for the engines.

/** Writes a flight's current position and a rotation that points its +Z along its path. */
export function flightTransform(
	s: BattleState,
	f: number,
	outPosition: OutArray,
	outRotation: OutArray,
): void {
	const t = clamp((s.flightAge[f] as number) / (s.flightDuration[f] as number), 0, 1);
	const fx = s.flightFrom[f * 3] as number;
	const fy = s.flightFrom[f * 3 + 1] as number;
	const fz = s.flightFrom[f * 3 + 2] as number;
	const dx = (s.flightTo[f * 3] as number) - fx;
	const dy = (s.flightTo[f * 3 + 1] as number) - fy;
	const dz = (s.flightTo[f * 3 + 2] as number) - fz;
	// Shells fly in an arc; tracers fly straight.
	const arc = s.flightKind[f] === 1 ? 4 * t * (1 - t) * 0.12 * Math.hypot(dx, dz) : 0;
	outPosition[0] = fx + dx * t;
	outPosition[1] = fy + dy * t + arc;
	outPosition[2] = fz + dz * t;
	quatAxisAngle(outRotation, 0, 0, 1, 0, Math.atan2(dx, dz));
}

/** An explosion's scale: it swells and shrinks over its life. */
export function blastScale(s: BattleState, b: number): number {
	const t = clamp((s.blastAge[b] as number) / EXPLOSION_SECONDS, 0, 1);
	return 0.5 + 5 * Math.sin(Math.PI * Math.sqrt(t));
}

/** Objects in the scene now: units, tank parts, flights, explosions and the ground. */
export function battleObjects(s: BattleState): number {
	return (
		s.active * 2 +
		activeTanks(s) * 2 * TANK_PARTS +
		s.activeFlights +
		s.activeBlasts +
		GROUND_OBJECTS
	);
}

// Looks. Soldiers and mechs are animated models from files; tanks and effects are built here.

export type BattleMesh =
	| 'tankHull'
	| 'tankTurret'
	| 'tankBarrel'
	| 'tracer'
	| 'shell'
	| 'blast'
	| 'ground';

/** The half-size of the field that units move on. */
export const FIELD_HALF = { x: GRID_HALF_X, z: GRID_HALF_Z } as const;
/** The half-size of the drawn ground: past the end of the fog, so no edge shows. */
export const GROUND_HALF_SIZE = 1_200;

export function battleMeshes(): Record<BattleMesh, MeshData> {
	return {
		tankHull: translated(boxGeometry(3.4, 1.1, 6), 0, 0.75, 0),
		tankTurret: translated(boxGeometry(2.4, 0.8, 2.8), 0, 0.4, 0),
		// The barrel points along +Z from the turret's front.
		tankBarrel: translated(boxGeometry(0.25, 0.25, 3.2), 0, 0, 1.6),
		tracer: boxGeometry(0.06, 0.06, 1.8),
		shell: boxGeometry(0.25, 0.25, 0.6),
		blast: sphereGeometry(1, 12, 8),
		ground: translated(boxGeometry(GROUND_HALF_SIZE * 2, 0.2, GROUND_HALF_SIZE * 2), 0, -0.1, 0),
	};
}

/** The height of a tank's turret on its hull, and of the barrel on the turret. */
export const TANK_TURRET_HEIGHT = 1.3;
export const TANK_BARREL_OFFSET = [0, 0.45, 1.2] as const;

/** Triangle counts of the animated models, from the model files. */
export interface ModelTriangles {
	soldier: number;
	mech: number;
}

/** Triangles in the scene now. */
export function battleTriangles(
	s: BattleState,
	meshes: Record<BattleMesh, MeshData>,
	models: ModelTriangles,
): number {
	const mechs = mechsPerArmy(s.active) * 2;
	const soldiers = s.active * 2 - mechs;
	const tankTriangles =
		triangleCount(meshes.tankHull) +
		triangleCount(meshes.tankTurret) +
		triangleCount(meshes.tankBarrel);
	let flights = 0;
	for (let f = 0; f < s.flights; f++) {
		if (s.flightActive[f] === 0) continue;
		flights += s.flightKind[f] === 0 ? triangleCount(meshes.tracer) : triangleCount(meshes.shell);
	}
	return (
		soldiers * models.soldier +
		mechs * models.mech +
		activeTanks(s) * 2 * tankTriangles +
		flights +
		s.activeBlasts * triangleCount(meshes.blast) +
		triangleCount(meshes.ground)
	);
}

export const ARMY_COLORS: readonly [Hex, Hex] = ['#4f6d3a', '#7a5a3c'];
/** Each army's tint of its soldiers and mechs: it multiplies the colors of the model files. */
export const UNIT_TINTS: readonly [Hex, Hex] = ['#c4dca8', '#ecc2a2'];

export const BATTLE_MATERIALS = {
	/** Soldiers and mechs: the colors come from the model files, times the army's tint. */
	unit: { roughness: 0.8, metalness: 0 },
	tank: { roughness: 0.7, metalness: 0.3 },
	/** Tracers and blasts shine: their color times their intensity. */
	tracer: { color: '#ffe08a' as Hex, unlit: true, intensity: 4 },
	shell: { color: '#303030' as Hex, roughness: 0.5, metalness: 0.7 },
	blast: { color: '#ff9a3c' as Hex, unlit: true, intensity: 4 },
	ground: { color: '#6f7d55' as Hex, roughness: 1, metalness: 0 },
} as const;

export const BATTLE_VIEW = {
	background: '#a9b8c9' as Hex,
	camera: { fov: 50, near: 0.5, far: 3000 },
	sun: { direction: [-0.5, -1, -0.35] as const, color: '#fff3e0' as Hex, intensity: 2.6 },
	hemisphere: { sky: '#cfe0ff' as Hex, ground: '#5a4d38' as Hex, intensity: 0.7 },
	pointLights: [] as const,
	fog: { color: '#a9b8c9' as Hex, near: 150, far: 900 },
	glow: { threshold: 1.2, strength: 0.4, radius: 0.1 },
} as const;

/** The camera circles the middle of the field every 90 seconds, high enough to see both lines. */
export const BATTLE_CAMERA: CameraLoop = {
	seconds: 90,
	positions: [0, 45, 130, 130, 60, 0, 0, 45, -130, -130, 60, 0],
	targets: [0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0],
};

export const BATTLE_EFFECTS = ['shadows', 'fog', 'glow'] as const;
