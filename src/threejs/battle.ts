// The battle, drawn by a tuned three.js. Soldiers and mechs are posed in JavaScript, one model at a
// time, as three.js's crowd example does (see battle-pose.ts). On WebGPU each model's units draw in
// one draw with the skinning done while drawing (battle-crowd-draw.ts). On WebGL2 the `crowd`
// option picks the way: the same draw in the WebGPU renderer's WebGL2 mode, or one skinned model
// per unit in the WebGL renderer (battle-crowd-skinned.ts). Tanks, tracers, shells and blasts are
// batches of copies, as in the other scenes.

import type * as ThreeModule from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneModel } from 'three/addons/utils/SkeletonUtils.js';
import mechUrl from '../../assets/models/mech.glb?url';
import soldierUrl from '../../assets/models/soldier.glb?url';
import {
	ARMY_COLORS,
	activeTanks,
	BATTLE_CAMERA,
	BATTLE_MATERIALS,
	BATTLE_VIEW,
	battleMeshes,
	battleObjects,
	battleSoldiers,
	battleTriangles,
	blastScale,
	createBattle,
	flightTransform,
	mechsPerArmy,
	setActiveSoldiers,
	stepBattle,
	TANK_BARREL_OFFSET,
	TANK_TURRET_HEIGHT,
	UNIT_TINTS,
	UnitKind,
	unitKindOf,
} from '../scenes/battle';
import { sampleCameraLoop } from '../scenes/common';
import { MODEL_TRIANGLES, MODELS, type ModelName } from '../scenes/models';
import { DrawCrowd } from './battle-crowd-draw';
import { SkinnedCrowd } from './battle-crowd-skinned';
import { type LoadedModel, Poser } from './battle-pose';
import {
	makeBatch,
	makeMaterial,
	makeView,
	type SceneBuild,
	type SceneModule,
	toGeometry,
	uploadCopies,
	writeMatrix,
	writeQuaternionMatrix,
} from './common';

/** The sun's shadows cover this far around the middle of the field. */
const SHADOW_REACH = 200;

/** What both crowd ways offer the battle. */
interface Crowd {
	write(slot: number, x: number, z: number, heading: number): void;
	show(count: number): void;
}

async function loadModel(url: string): Promise<LoadedModel> {
	const gltf = await new GLTFLoader().loadAsync(url);
	return { scene: gltf.scene, animations: gltf.animations };
}

export const battleModule: SceneModule = {
	webgl2Renderer: ({ crowd }) => (crowd === 'skinned' ? 'webgl' : 'webgpu-webgl2'),

	async build(three, options): Promise<SceneBuild> {
		const perArmy = battleSoldiers(options.capacity);
		const state = createBattle(perArmy);
		const meshes = battleMeshes();
		const { scene, camera } = makeView(three, BATTLE_VIEW, options.effects, SHADOW_REACH);
		const fog = options.effects.fog;
		const shadows = options.effects.shadows;

		// Units: each unit index keeps its model and its slot among that model's units.
		const units = perArmy * 2;
		const slotOf = new Int32Array(units);
		const slots = { soldier: 0, mech: 0 };
		const tints = { soldier: [] as number[], mech: [] as number[] };
		const color = new three.Color();
		for (let i = 0; i < units; i++) {
			const name: ModelName = unitKindOf(i) === UnitKind.mech ? 'mech' : 'soldier';
			slotOf[i] = slots[name]++;
			color.set(UNIT_TINTS[i & 1] as string);
			tints[name].push(color.r, color.g, color.b);
		}
		const [soldierModel, mechModel] = await Promise.all([
			loadModel(soldierUrl),
			loadModel(mechUrl),
		]);
		const models: Record<ModelName, LoadedModel> = { soldier: soldierModel, mech: mechModel };
		const posers: Record<ModelName, Poser> = {
			soldier: new Poser(three, soldierModel, MODELS.soldier),
			mech: new Poser(three, mechModel, MODELS.mech),
		};
		const crowds = {} as Record<ModelName, Crowd>;
		if (options.renderer === 'webgl') {
			const armyOf = (name: ModelName) => {
				const army: number[] = [];
				for (let i = 0; i < units; i++)
					if ((unitKindOf(i) === UnitKind.mech) === (name === 'mech')) army.push(i & 1);
				return (slot: number) => army[slot] as number;
			};
			const materials = UNIT_TINTS.map(
				(tint) =>
					new three.MeshStandardMaterial({
						color: new three.Color(tint),
						vertexColors: true,
						roughness: BATTLE_MATERIALS.unit.roughness,
						metalness: BATTLE_MATERIALS.unit.metalness,
						fog,
					}),
			) as unknown as [ThreeModule.Material, ThreeModule.Material];
			for (const name of ['soldier', 'mech'] as const) {
				const crowd = new SkinnedCrowd(
					three,
					posers[name],
					models[name].scene,
					cloneModel,
					MODELS[name].scale,
					{ armyOf: armyOf(name), materials, shadows },
				);
				scene.add(crowd.group);
				crowds[name] = crowd;
			}
		} else {
			const webgpu = three as unknown as typeof import('three/webgpu');
			const tsl = await import('three/tsl');
			for (const name of ['soldier', 'mech'] as const) {
				const crowd = new DrawCrowd(webgpu, tsl, posers[name], MODELS[name].scale, {
					capacity: Math.max(1, slots[name]),
					tints: new Float32Array(tints[name]),
					textures: options.renderer === 'webgpu-webgl2',
					roughness: BATTLE_MATERIALS.unit.roughness,
					metalness: BATTLE_MATERIALS.unit.metalness,
					fog,
					shadows,
				});
				scene.add(crowd.mesh as unknown as ThreeModule.Object3D);
				crowds[name] = crowd;
			}
		}

		// Tanks: hull, turret and barrel, in the army's color.
		const tankCapacity = state.tankCapacity * 2;
		const tankMaterial = makeMaterial(three, { ...BATTLE_MATERIALS.tank, color: '#ffffff' }, fog);
		const hulls = makeBatch(
			three,
			toGeometry(three, meshes.tankHull),
			tankMaterial,
			tankCapacity,
			true,
			shadows,
		);
		const turrets = makeBatch(
			three,
			toGeometry(three, meshes.tankTurret),
			tankMaterial,
			tankCapacity,
			true,
			shadows,
		);
		const barrels = makeBatch(
			three,
			toGeometry(three, meshes.tankBarrel),
			tankMaterial,
			tankCapacity,
			true,
			shadows,
		);
		for (let t = 0; t < tankCapacity; t++) {
			color.set(ARMY_COLORS[t & 1] as string);
			hulls.setColorAt(t, color);
			turrets.setColorAt(t, color);
			barrels.setColorAt(t, color);
		}
		// Tracers, shells and blasts: the pools' active entries, packed to the front each frame.
		const tracers = makeBatch(
			three,
			toGeometry(three, meshes.tracer),
			makeMaterial(three, BATTLE_MATERIALS.tracer, fog),
			state.flights,
			true,
			false,
		);
		const shells = makeBatch(
			three,
			toGeometry(three, meshes.shell),
			makeMaterial(three, BATTLE_MATERIALS.shell, fog),
			state.flights,
			true,
			shadows,
		);
		const blasts = makeBatch(
			three,
			toGeometry(three, meshes.blast),
			makeMaterial(three, BATTLE_MATERIALS.blast, fog),
			state.blasts,
			true,
			false,
		);
		const ground = new three.Mesh(
			toGeometry(three, meshes.ground),
			makeMaterial(three, BATTLE_MATERIALS.ground, fog),
		);
		ground.receiveShadow = shadows;
		scene.add(hulls, turrets, barrels, tracers, shells, blasts, ground);

		const setCount = (count: number) => setActiveSoldiers(state, count);
		setCount(options.count);

		const position = new Float64Array(3);
		const rotation = new Float64Array(4);
		const cameraPosition = new Float64Array(3);
		const cameraTarget = new Float64Array(3);
		const hullMatrices = hulls.instanceMatrix.array as Float32Array;
		const turretMatrices = turrets.instanceMatrix.array as Float32Array;
		const barrelMatrices = barrels.instanceMatrix.array as Float32Array;
		const tracerMatrices = tracers.instanceMatrix.array as Float32Array;
		const shellMatrices = shells.instanceMatrix.array as Float32Array;
		const blastMatrices = blasts.instanceMatrix.array as Float32Array;
		const soldierPoser = posers.soldier;
		const mechPoser = posers.mech;
		const soldierCrowd = crowds.soldier;
		const mechCrowd = crowds.mech;
		const [barrelX, barrelY, barrelZ] = TANK_BARREL_OFFSET;

		const pose = (seconds: number) => {
			// Units, one pose at a time.
			const active = state.active * 2;
			for (let i = 0; i < active; i++) {
				const mech = state.kind[i] === UnitKind.mech;
				const poser = mech ? mechPoser : soldierPoser;
				poser.pose(
					state.clip[i] as number,
					state.clipTime[i] as number,
					state.previousClip[i] as number,
					state.previousTime[i] as number,
					state.fade[i] as number,
					state.aim[i] as number,
				);
				(mech ? mechCrowd : soldierCrowd).write(
					slotOf[i] as number,
					state.x[i] as number,
					state.z[i] as number,
					state.heading[i] as number,
				);
			}
			const mechs = mechsPerArmy(state.active) * 2;
			soldierCrowd.show(active - mechs);
			mechCrowd.show(mechs);

			// Tanks: the turret turns on the hull; the barrel sits at the turret's front.
			const tanks = activeTanks(state) * 2;
			for (let t = 0; t < tanks; t++) {
				const x = state.tankX[t] as number;
				const z = state.tankZ[t] as number;
				const heading = state.tankHeading[t] as number;
				const turn = heading + (state.tankTurret[t] as number);
				const hc = Math.cos(heading);
				const hs = Math.sin(heading);
				const tc = Math.cos(turn);
				const ts = Math.sin(turn);
				writeMatrix(hullMatrices, t * 16, hc, 0, -hs, 0, 1, 0, hs, 0, hc, x, 0, z);
				writeMatrix(
					turretMatrices,
					t * 16,
					tc,
					0,
					-ts,
					0,
					1,
					0,
					ts,
					0,
					tc,
					x,
					TANK_TURRET_HEIGHT,
					z,
				);
				writeMatrix(
					barrelMatrices,
					t * 16,
					tc,
					0,
					-ts,
					0,
					1,
					0,
					ts,
					0,
					tc,
					x + tc * barrelX + ts * barrelZ,
					TANK_TURRET_HEIGHT + barrelY,
					z - ts * barrelX + tc * barrelZ,
				);
			}
			hulls.count = tanks;
			turrets.count = tanks;
			barrels.count = tanks;
			uploadCopies(hulls, tanks);
			uploadCopies(turrets, tanks);
			uploadCopies(barrels, tanks);

			// Flights and blasts in use.
			let tracerCount = 0;
			let shellCount = 0;
			for (let f = 0; f < state.flights; f++) {
				if (state.flightActive[f] === 0) continue;
				flightTransform(state, f, position, rotation);
				const shell = state.flightKind[f] === 1;
				writeQuaternionMatrix(
					shell ? shellMatrices : tracerMatrices,
					(shell ? shellCount++ : tracerCount++) * 16,
					rotation[0] as number,
					rotation[1] as number,
					rotation[2] as number,
					rotation[3] as number,
					position[0] as number,
					position[1] as number,
					position[2] as number,
				);
			}
			tracers.count = tracerCount;
			shells.count = shellCount;
			uploadCopies(tracers, tracerCount);
			uploadCopies(shells, shellCount);
			let blastCount = 0;
			for (let b = 0; b < state.blasts; b++) {
				if (state.blastActive[b] === 0) continue;
				const size = blastScale(state, b);
				writeMatrix(
					blastMatrices,
					blastCount++ * 16,
					size,
					0,
					0,
					0,
					size,
					0,
					0,
					0,
					size,
					state.blastPosition[b * 3] as number,
					state.blastPosition[b * 3 + 1] as number,
					state.blastPosition[b * 3 + 2] as number,
				);
			}
			blasts.count = blastCount;
			uploadCopies(blasts, blastCount);

			sampleCameraLoop(BATTLE_CAMERA, seconds, cameraPosition, cameraTarget);
			camera.position.set(
				cameraPosition[0] as number,
				cameraPosition[1] as number,
				cameraPosition[2] as number,
			);
			camera.lookAt(
				cameraTarget[0] as number,
				cameraTarget[1] as number,
				cameraTarget[2] as number,
			);
		};

		return {
			scene,
			camera,
			setCount,
			step: () => stepBattle(state),
			pose,
			objects: () => battleObjects(state),
			triangles: () => battleTriangles(state, meshes, MODEL_TRIANGLES),
		};
	},
};
