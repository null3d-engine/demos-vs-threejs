// The tuned three.js factory. Each part shape is one batch of copies (InstancedMesh). Every frame one
// JavaScript loop (poseFactory) computes the world transform of every moving part, and only the
// copies in use are uploaded.

import { sampleCameraLoop } from '../scenes/common';
import {
	CRATES_PER_CELL,
	createFactory,
	FACTORY_CAMERA,
	FACTORY_MATERIALS,
	FACTORY_VIEW,
	type FactoryMesh,
	factoryCells,
	factoryMeshes,
	factoryObjects,
	factoryTriangles,
	MOVING_PER_CELL,
	setActiveCells,
	stepFactory,
	stillPartPosition,
} from '../scenes/factory';
import {
	type Builder,
	makeBatch,
	makeMaterial,
	makeView,
	toGeometry,
	uploadCopies,
	writeMatrix,
} from './common';
import { type FactoryMatrices, poseFactory } from './factory-pose';

export const buildFactory: Builder = (three, options) => {
	const capacity = factoryCells(options.capacity);
	const state = createFactory(capacity);
	const meshes = factoryMeshes(capacity);
	const { scene, camera } = makeView(three, FACTORY_VIEW, options.effects, 45);
	const shadows = options.effects.shadows;
	const fog = options.effects.fog;

	const batch = (name: FactoryMesh, copies: number, moving: boolean) => {
		const mesh = makeBatch(
			three,
			toGeometry(three, meshes[name]),
			makeMaterial(three, FACTORY_MATERIALS[name], fog),
			copies,
			moving,
			shadows && name !== 'line',
		);
		scene.add(mesh);
		return mesh;
	};
	const base = batch('base', capacity, false);
	const belt = batch('belt', capacity, false);
	const pallet = batch('pallet', capacity, false);
	const line = batch('line', capacity, false);
	const turntable = batch('turntable', capacity, true);
	const upperArm = batch('upperArm', capacity, true);
	const forearm = batch('forearm', capacity, true);
	const wrist = batch('wrist', capacity, true);
	const finger = batch('finger', capacity * 2, true);
	const crate = batch('crate', capacity * CRATES_PER_CELL, true);
	const floor = new three.Mesh(
		toGeometry(three, meshes.floor),
		makeMaterial(three, FACTORY_MATERIALS.floor, fog),
	);
	floor.receiveShadow = shadows;
	scene.add(floor);

	// Still parts: written once for every cell.
	const at = new Float64Array(3);
	for (let c = 0; c < capacity; c++) {
		const ox = state.origin[c * 2] as number;
		const oz = state.origin[c * 2 + 1] as number;
		writeMatrix(
			base.instanceMatrix.array as Float32Array,
			c * 16,
			1,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			1,
			ox,
			0,
			oz,
		);
		stillPartPosition(state, c, 0, at);
		writeMatrix(
			belt.instanceMatrix.array as Float32Array,
			c * 16,
			1,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			1,
			at[0] as number,
			at[1] as number,
			at[2] as number,
		);
		stillPartPosition(state, c, 1, at);
		writeMatrix(
			pallet.instanceMatrix.array as Float32Array,
			c * 16,
			1,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			1,
			at[0] as number,
			at[1] as number,
			at[2] as number,
		);
		stillPartPosition(state, c, 2, at);
		writeMatrix(
			line.instanceMatrix.array as Float32Array,
			c * 16,
			1,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			1,
			at[0] as number,
			at[1] as number,
			at[2] as number,
		);
	}
	for (const still of [base, belt, pallet, line]) still.instanceMatrix.needsUpdate = true;

	const perCell = [base, belt, pallet, line, turntable, upperArm, forearm, wrist];
	let cells = capacity;
	const setCount = (count: number) => {
		cells = Math.min(capacity, factoryCells(count));
		setActiveCells(state, cells);
		for (const mesh of perCell) mesh.count = cells;
		finger.count = cells * 2;
		crate.count = cells * CRATES_PER_CELL;
	};
	setCount(options.count);

	const matrices: FactoryMatrices = {
		turntable: turntable.instanceMatrix.array as Float32Array,
		upperArm: upperArm.instanceMatrix.array as Float32Array,
		forearm: forearm.instanceMatrix.array as Float32Array,
		wrist: wrist.instanceMatrix.array as Float32Array,
		finger: finger.instanceMatrix.array as Float32Array,
		crate: crate.instanceMatrix.array as Float32Array,
	};
	const cameraPosition = new Float64Array(3);
	const cameraTarget = new Float64Array(3);

	const pose = (seconds: number) => {
		poseFactory(state, cells, matrices);
		uploadCopies(turntable, cells);
		uploadCopies(upperArm, cells);
		uploadCopies(forearm, cells);
		uploadCopies(wrist, cells);
		uploadCopies(finger, cells * 2);
		uploadCopies(crate, cells * CRATES_PER_CELL);
		sampleCameraLoop(FACTORY_CAMERA, seconds, cameraPosition, cameraTarget);
		camera.position.set(
			cameraPosition[0] as number,
			cameraPosition[1] as number,
			cameraPosition[2] as number,
		);
		camera.lookAt(cameraTarget[0] as number, cameraTarget[1] as number, cameraTarget[2] as number);
	};

	return {
		scene,
		camera,
		setCount,
		step: () => stepFactory(state),
		pose,
		objects: () => factoryObjects(cells * MOVING_PER_CELL),
		triangles: () => factoryTriangles(cells * MOVING_PER_CELL, meshes),
	};
};
