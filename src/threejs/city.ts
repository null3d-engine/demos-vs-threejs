// The tuned three.js city. Still objects are grouped into squares of CHUNK × CHUNK blocks, one batch
// per kind of object per square, so three.js skips whole squares outside the view; the camera's far
// plane ends just past the fog. Within a square, copies are sorted by block, so a count shows a
// prefix of each batch. Cars and people move every frame in one batch each.

import type * as ThreeModule from 'three';
import {
	BUILDING_COLORS,
	BUILDINGS_PER_BLOCK,
	blockCell,
	buildingOf,
	CAR_COLORS,
	CARS_PER_BLOCK,
	CITY_CAMERA,
	CITY_MATERIALS,
	CITY_VIEW,
	carTransform,
	cityBlocks,
	cityMeshes,
	cityObjects,
	cityTriangles,
	createCity,
	LAMP_POLE_HEIGHT,
	LAMPS_PER_BLOCK,
	lampOf,
	PEOPLE_PER_BLOCK,
	PITCH,
	personTransform,
	setActiveBlocks,
	stepCity,
	WINDOW_COLORS,
	WINDOWS_PER_BUILDING,
	windowOf,
} from '../scenes/city';
import { sampleCameraLoop } from '../scenes/common';
import {
	type Builder,
	makeBatch,
	makeMaterial,
	makeView,
	toGeometry,
	uploadCopies,
	writeMatrix,
} from './common';

/** Blocks per side of a square of still objects. */
export const CHUNK = 10;
/** The tallest building, for the squares' bounding spheres. */
const TALLEST = 8 + 44 + 60;

interface Square {
	/** Block indices in this square, in increasing order. */
	blocks: number[];
	batches: ThreeModule.InstancedMesh[];
}

export const buildCity: Builder = (three, options) => {
	const capacity = cityBlocks(options.capacity);
	const state = createCity(capacity);
	const meshes = cityMeshes(capacity);
	const { scene, camera } = makeView(three, CITY_VIEW, options.effects, 0);
	const fog = options.effects.fog;
	const white = { ...CITY_MATERIALS.building, color: '#ffffff' };
	const materials = {
		building: makeMaterial(three, white, fog),
		window: makeMaterial(three, { ...CITY_MATERIALS.window, color: '#ffffff' }, fog),
		lampPole: makeMaterial(three, CITY_MATERIALS.lampPole, fog),
		lampHead: makeMaterial(three, CITY_MATERIALS.lampHead, fog),
		car: makeMaterial(three, { ...CITY_MATERIALS.car, color: '#ffffff' }, fog),
		person: makeMaterial(three, CITY_MATERIALS.person, fog),
	};
	const geometries = {
		building: toGeometry(three, meshes.building),
		window: toGeometry(three, meshes.window),
		lampPole: toGeometry(three, meshes.lampPole),
		lampHead: toGeometry(three, meshes.lampHead),
		car: toGeometry(three, meshes.car),
		person: toGeometry(three, meshes.person),
	};

	// Sort the blocks into squares.
	const squares = new Map<string, Square>();
	const cell = new Int32Array(2);
	for (let b = 0; b < capacity; b++) {
		blockCell(b, cell);
		const key = `${Math.floor((cell[0] as number) / CHUNK)},${Math.floor((cell[1] as number) / CHUNK)}`;
		let square = squares.get(key);
		if (!square) {
			square = { blocks: [], batches: [] };
			squares.set(key, square);
		}
		square.blocks.push(b);
	}

	// Fill each square's batches, block by block.
	const position = new Float64Array(3);
	const size = new Float64Array(3);
	const yaw = new Float64Array(1);
	const color = new three.Color();
	for (const square of squares.values()) {
		const n = square.blocks.length;
		const buildings = makeBatch(
			three,
			geometries.building,
			materials.building,
			n * BUILDINGS_PER_BLOCK,
			false,
			false,
		);
		const windows = makeBatch(
			three,
			geometries.window,
			materials.window,
			n * BUILDINGS_PER_BLOCK * WINDOWS_PER_BUILDING,
			false,
			false,
		);
		const poles = makeBatch(
			three,
			geometries.lampPole,
			materials.lampPole,
			n * LAMPS_PER_BLOCK,
			false,
			false,
		);
		const heads = makeBatch(
			three,
			geometries.lampHead,
			materials.lampHead,
			n * LAMPS_PER_BLOCK,
			false,
			false,
		);
		const buildingMatrices = buildings.instanceMatrix.array as Float32Array;
		const windowMatrices = windows.instanceMatrix.array as Float32Array;
		const poleMatrices = poles.instanceMatrix.array as Float32Array;
		const headMatrices = heads.instanceMatrix.array as Float32Array;
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minZ = Number.POSITIVE_INFINITY;
		let maxZ = Number.NEGATIVE_INFINITY;
		square.blocks.forEach((block, i) => {
			blockCell(block, cell);
			minX = Math.min(minX, (cell[0] as number) * PITCH);
			maxX = Math.max(maxX, (cell[0] as number) * PITCH);
			minZ = Math.min(minZ, (cell[1] as number) * PITCH);
			maxZ = Math.max(maxZ, (cell[1] as number) * PITCH);
			for (let b = 0; b < BUILDINGS_PER_BLOCK; b++) {
				const at = i * BUILDINGS_PER_BLOCK + b;
				const shade = buildingOf(block, b, position, size);
				writeMatrix(
					buildingMatrices,
					at * 16,
					size[0] as number,
					0,
					0,
					0,
					size[1] as number,
					0,
					0,
					0,
					size[2] as number,
					position[0] as number,
					position[1] as number,
					position[2] as number,
				);
				buildings.setColorAt(at, color.set(BUILDING_COLORS[shade] as string));
				for (let w = 0; w < WINDOWS_PER_BUILDING; w++) {
					const window = at * WINDOWS_PER_BUILDING + w;
					const tint = windowOf(block, b, w, position, size, yaw);
					const c = Math.cos(yaw[0] as number);
					const s = Math.sin(yaw[0] as number);
					writeMatrix(
						windowMatrices,
						window * 16,
						c * (size[0] as number),
						0,
						-s * (size[0] as number),
						0,
						size[1] as number,
						0,
						s * (size[2] as number),
						0,
						c * (size[2] as number),
						position[0] as number,
						position[1] as number,
						position[2] as number,
					);
					windows.setColorAt(window, color.set(WINDOW_COLORS[tint] as string));
				}
			}
			for (let l = 0; l < LAMPS_PER_BLOCK; l++) {
				const at = i * LAMPS_PER_BLOCK + l;
				lampOf(block, l, position);
				const x = position[0] as number;
				const z = position[2] as number;
				writeMatrix(poleMatrices, at * 16, 1, 0, 0, 0, 1, 0, 0, 0, 1, x, 0, z);
				writeMatrix(headMatrices, at * 16, 1, 0, 0, 0, 1, 0, 0, 0, 1, x, LAMP_POLE_HEIGHT, z);
			}
		});
		// One sphere around the whole square, from the ground to the tallest building.
		const halfX = (maxX - minX) / 2 + PITCH / 2;
		const halfZ = (maxZ - minZ) / 2 + PITCH / 2;
		const sphere = new three.Sphere(
			new three.Vector3((minX + maxX) / 2, TALLEST / 2, (minZ + maxZ) / 2),
			Math.hypot(halfX, TALLEST / 2, halfZ),
		);
		for (const batch of [buildings, windows, poles, heads]) {
			batch.frustumCulled = true;
			batch.boundingSphere = sphere;
			batch.instanceMatrix.needsUpdate = true;
			if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
			scene.add(batch);
			square.batches.push(batch);
		}
	}

	// Moving objects: cars and people, all in one batch each.
	const cars = makeBatch(
		three,
		geometries.car,
		materials.car,
		capacity * CARS_PER_BLOCK,
		true,
		false,
	);
	for (let c = 0; c < capacity * CARS_PER_BLOCK; c++) {
		cars.setColorAt(c, color.set(CAR_COLORS[c % CAR_COLORS.length] as string));
	}
	if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
	const people = makeBatch(
		three,
		geometries.person,
		materials.person,
		capacity * PEOPLE_PER_BLOCK,
		true,
		false,
	);
	scene.add(cars, people);
	const ground = new three.Mesh(
		toGeometry(three, meshes.ground),
		makeMaterial(three, CITY_MATERIALS.ground, fog),
	);
	scene.add(ground);

	let blocks = capacity;
	const perBlock = [
		BUILDINGS_PER_BLOCK,
		BUILDINGS_PER_BLOCK * WINDOWS_PER_BUILDING,
		LAMPS_PER_BLOCK,
		LAMPS_PER_BLOCK,
	] as const;
	const setCount = (count: number) => {
		blocks = Math.min(capacity, cityBlocks(count));
		setActiveBlocks(state, blocks);
		for (const square of squares.values()) {
			// The square's blocks are in increasing order: count those below the new block count.
			let active = 0;
			while (active < square.blocks.length && (square.blocks[active] as number) < blocks) active++;
			square.batches.forEach((batch, k) => {
				batch.count = active * (perBlock[k] as number);
				batch.visible = active > 0;
			});
		}
		cars.count = blocks * CARS_PER_BLOCK;
		people.count = blocks * PEOPLE_PER_BLOCK;
	};
	setCount(options.count);

	const carMatrices = cars.instanceMatrix.array as Float32Array;
	const peopleMatrices = people.instanceMatrix.array as Float32Array;
	const at = new Float64Array(3);
	const cameraPosition = new Float64Array(3);
	const cameraTarget = new Float64Array(3);

	const pose = (seconds: number) => {
		const carCount = blocks * CARS_PER_BLOCK;
		for (let c = 0; c < carCount; c++) {
			const heading = carTransform(state, c, at);
			const cy = Math.cos(heading);
			const sy = Math.sin(heading);
			writeMatrix(
				carMatrices,
				c * 16,
				cy,
				0,
				-sy,
				0,
				1,
				0,
				sy,
				0,
				cy,
				at[0] as number,
				0,
				at[2] as number,
			);
		}
		const personCount = blocks * PEOPLE_PER_BLOCK;
		for (let p = 0; p < personCount; p++) {
			const heading = personTransform(state, p, at);
			const cy = Math.cos(heading);
			const sy = Math.sin(heading);
			writeMatrix(
				peopleMatrices,
				p * 16,
				cy,
				0,
				-sy,
				0,
				1,
				0,
				sy,
				0,
				cy,
				at[0] as number,
				0,
				at[2] as number,
			);
		}
		uploadCopies(cars, carCount);
		uploadCopies(people, personCount);
		sampleCameraLoop(CITY_CAMERA, seconds, cameraPosition, cameraTarget);
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
		step: () => stepCity(state),
		pose,
		objects: () => cityObjects(blocks),
		triangles: () => cityTriangles(blocks, meshes),
		glow: CITY_VIEW.glow,
	};
};
