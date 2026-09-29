import { describe, expect, test } from 'bun:test';
import {
	activeTanks,
	BATTLE_CAMERA,
	BATTLE_VIEW,
	type BattleState,
	battleMeshes,
	battleObjects,
	battleTriangles,
	Clip,
	createBattle,
	FIELD_HALF,
	FORMATION_COLUMNS,
	formationSlot,
	GROUND_HALF_SIZE,
	GROUND_OBJECTS,
	MECH_EVERY,
	mechsPerArmy,
	setActiveSoldiers,
	stepBattle,
	TANK_PARTS,
	tanksPerArmy,
	UnitKind,
	UnitState,
	unitKindOf,
} from './battle';
import { sampleCameraLoop, stepsUntil } from './common';
import { triangleCount } from './geometry';

function run(state: BattleState, steps: number): void {
	for (let i = 0; i < steps; i++) stepBattle(state);
}

describe('battle layout and counts', () => {
	test('units alternate between the armies, with a mech in every hundred per army', () => {
		expect(unitKindOf(0)).toBe(UnitKind.soldier);
		expect(unitKindOf((MECH_EVERY - 1) * 2)).toBe(UnitKind.mech);
		expect(unitKindOf((MECH_EVERY - 1) * 2 + 1)).toBe(UnitKind.mech);
		expect(mechsPerArmy(1_000)).toBe(10);
		expect(tanksPerArmy(1_000)).toBe(20);
		expect(tanksPerArmy(10)).toBe(1);
	});

	test('formations start on each army side, one slot per place', () => {
		const slot = new Float64Array(2);
		const seen = new Set<string>();
		for (let i = 0; i < FORMATION_COLUMNS * 3; i++) {
			formationSlot(0, i, slot);
			expect(slot[0]).toBeLessThan(0);
			seen.add(`${slot[0]},${slot[1]}`);
			formationSlot(1, i, slot);
			expect(slot[0]).toBeGreaterThan(0);
		}
		expect(seen.size).toBe(FORMATION_COLUMNS * 3);
	});

	test('objects and triangles follow the units, tanks and effects', () => {
		const state = createBattle(300);
		run(state, stepsUntil(40));
		expect(battleObjects(state)).toBe(
			600 +
				activeTanks(state) * 2 * TANK_PARTS +
				state.activeFlights +
				state.activeBlasts +
				GROUND_OBJECTS,
		);
		const meshes = battleMeshes();
		const models = { soldier: 1_000, mech: 5_000 };
		const withoutEffects =
			(600 - 6) * 1_000 +
			6 * 5_000 +
			activeTanks(state) *
				2 *
				(triangleCount(meshes.tankHull) +
					triangleCount(meshes.tankTurret) +
					triangleCount(meshes.tankBarrel)) +
			state.activeBlasts * triangleCount(meshes.blast) +
			triangleCount(meshes.ground);
		expect(battleTriangles(state, meshes, models)).toBeGreaterThanOrEqual(withoutEffects);
	});
});

describe('battle simulation', () => {
	test('the same seed and steps give the same state', () => {
		const a = createBattle(250);
		const b = createBattle(250);
		run(a, stepsUntil(50));
		run(b, stepsUntil(50));
		expect([...a.x]).toEqual([...b.x]);
		expect([...a.state]).toEqual([...b.state]);
		expect([...a.clip]).toEqual([...b.clip]);
		expect(a.shots).toBe(b.shots);
	});

	test('within 90 seconds the armies meet, fire, fall and come back', () => {
		const state = createBattle(400);
		let respawns = 0;
		for (let i = 0; i < stepsUntil(90); i++) {
			const deadBefore = [...state.state].map((s) => s === UnitState.dead);
			stepBattle(state);
			for (let u = 0; u < 800; u++)
				if (deadBefore[u] && state.state[u] !== UnitState.dead) respawns++;
		}
		expect(state.shots).toBeGreaterThan(100);
		expect([...state.deaths].reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
		expect(respawns).toBeGreaterThan(0);
	});

	test('a fighting unit aims at a living enemy in range, within the aim limit', () => {
		const state = createBattle(300);
		for (let i = 0; i < stepsUntil(80); i++) {
			stepBattle(state);
			if (i % 30 !== 0) continue;
			for (let u = 0; u < 600; u++) {
				expect(Math.abs(state.aim[u]!)).toBeLessThanOrEqual(0.9 + 1e-6);
				expect(state.fade[u]).toBeGreaterThanOrEqual(0);
				expect(state.fade[u]).toBeLessThanOrEqual(1);
				if (state.state[u] === UnitState.dead) expect(state.clip[u]).toBe(Clip.die);
				if (state.state[u] !== UnitState.fight) continue;
				const target = state.target[u]!;
				expect(target & 1).toBe(1 - (u & 1));
				const range = state.kind[u] === UnitKind.mech ? 60 : 45;
				expect(
					Math.hypot(state.x[target]! - state.x[u]!, state.z[target]! - state.z[u]!),
				).toBeLessThanOrEqual(range + 3);
			}
		}
	});

	test('units stay on the ground', () => {
		const state = createBattle(500);
		run(state, stepsUntil(60));
		for (let u = 0; u < 1_000; u++) {
			expect(Math.abs(state.x[u]!)).toBeLessThanOrEqual(FIELD_HALF.x);
			expect(Math.abs(state.z[u]!)).toBeLessThanOrEqual(FIELD_HALF.z);
		}
	});

	test('new soldiers join at their formation slot, and tanks join with them', () => {
		const state = createBattle(1_000);
		setActiveSoldiers(state, 100);
		run(state, stepsUntil(20));
		setActiveSoldiers(state, 600);
		const slot = new Float64Array(2);
		for (let u = 200; u < 1_200; u++) {
			formationSlot(u & 1, u >> 1, slot);
			expect(state.x[u]).toBeCloseTo(slot[0]!, 3);
			expect(state.z[u]).toBeCloseTo(slot[1]!, 3);
			expect(state.state[u]).toBe(UnitState.march);
		}
		expect(activeTanks(state)).toBe(tanksPerArmy(600));
	});
});

describe('battle view', () => {
	test('the drawn ground reaches past the end of the fog from every camera position', () => {
		const position = new Float64Array(3);
		const target = new Float64Array(3);
		let farthest = 0;
		for (let k = 0; k < 900; k++) {
			sampleCameraLoop(BATTLE_CAMERA, (k / 900) * BATTLE_CAMERA.seconds, position, target);
			farthest = Math.max(
				farthest,
				Math.abs(position[0] as number),
				Math.abs(position[2] as number),
			);
		}
		expect(GROUND_HALF_SIZE).toBeGreaterThanOrEqual(farthest + BATTLE_VIEW.fog.far);
	});
});
