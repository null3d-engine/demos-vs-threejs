// The list of scenes, with what the page needs to know about each: its name, what its count
// means, its effects, the auto-slide settings per device class, and the frame the image check
// compares.

import {
	BATTLE_EFFECTS,
	GROUND_OBJECTS as BATTLE_GROUND,
	battleSoldiers,
	MAX_PER_ARMY,
	TANK_PARTS,
	tanksPerArmy,
} from './battle';
import { CITY_EFFECTS, cityObjects, MAX_BLOCKS } from './city';
import type { DeviceClass } from './device';
import type { EffectName } from './effects';
import { FACTORY_EFFECTS, factoryObjects } from './factory';

export type SceneId = 'factory' | 'city' | 'battle';

export const SCENE_IDS: readonly SceneId[] = ['factory', 'city', 'battle'];

/**
 * Auto-slide settings: the count starts at `start` and grows by `factor` each second, up to `max`.
 * Rule: the count passes three.js's limit on the device class near second 8 and reaches about 2.8
 * times that limit by second 20. Rows marked `measured: false` are first guesses until the
 * three.js versions are measured on each device class.
 */
export interface RampPlan {
	start: number;
	factor: number;
	max: number;
	measured: boolean;
}

export interface SceneInfo {
	id: SceneId;
	title: string;
	/** What the count counts, for the slider's label. */
	countUnit: string;
	effects: readonly EffectName[];
	ramp: Readonly<Record<DeviceClass, RampPlan>>;
	/** The largest count the scene can hold. */
	maxCount: number;
	/** The frame the image check compares: a scene time and a count. */
	hold: { seconds: number; count: number };
	/** Objects that stay in the scene at a count (the battle adds its short-lived effects). */
	objectsAt(count: number): number;
}

export const SCENES: Readonly<Record<SceneId, SceneInfo>> = {
	factory: {
		id: 'factory',
		title: 'Factory',
		countUnit: 'moving parts',
		effects: FACTORY_EFFECTS,
		ramp: {
			// Chosen with the user: start at 10,000 moving parts and grow in large steps.
			desktop: { start: 10_000, factor: 1.2, max: 1_400_000, measured: false },
			tablet: { start: 4_000, factor: 1.2, max: 400_000, measured: false },
			phone: { start: 2_000, factor: 1.2, max: 200_000, measured: false },
		},
		// 1,400,000 moving parts is 140,000 cells: 1,960,001 objects, inside null3D's portable limit.
		maxCount: 1_400_000,
		hold: { seconds: 6, count: 2_000 },
		objectsAt: factoryObjects,
	},
	city: {
		id: 'city',
		title: 'City',
		countUnit: 'city blocks',
		effects: CITY_EFFECTS,
		ramp: {
			desktop: { start: 1_000, factor: 1.15, max: MAX_BLOCKS, measured: false },
			tablet: { start: 300, factor: 1.15, max: 6_000, measured: false },
			phone: { start: 150, factor: 1.15, max: 3_000, measured: false },
		},
		maxCount: MAX_BLOCKS,
		hold: { seconds: 10, count: 200 },
		objectsAt: cityObjects,
	},
	battle: {
		id: 'battle',
		title: 'Battle',
		countUnit: 'soldiers per army',
		effects: BATTLE_EFFECTS,
		ramp: {
			desktop: { start: 500, factor: 1.15, max: MAX_PER_ARMY, measured: false },
			tablet: { start: 200, factor: 1.15, max: 6_000, measured: false },
			phone: { start: 100, factor: 1.15, max: 3_000, measured: false },
		},
		maxCount: MAX_PER_ARMY,
		// In the fight: units aim, fire, fall and get up, and shells burst.
		hold: { seconds: 60, count: 1_000 },
		// Soldiers and mechs of both armies, tank parts and the ground.
		objectsAt: (count) => {
			const soldiers = battleSoldiers(count);
			return soldiers * 2 + tanksPerArmy(soldiers) * 2 * TANK_PARTS + BATTLE_GROUND;
		},
	},
};
