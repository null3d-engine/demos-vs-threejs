// What every tuned three.js scene shares. A scene receives the three.js module it must use: `three`
// for the WebGL renderer, `three/webgpu` for the WebGPU renderer. Objects from one module do not
// draw with the other module's renderer, so scenes never import three.js classes themselves.

import type * as ThreeModule from 'three';
import type { Effects } from '../scenes/effects';
import type { MeshData } from '../scenes/geometry';

export { writeMatrix, writeQuaternionMatrix } from './matrices';

export type Three = typeof ThreeModule;

export interface BuildOptions {
	/** The largest count of this run: every object is made up front, and a count only shows some. */
	capacity: number;
	count: number;
	effects: Effects;
}

/** A built scene, ready to step and draw. */
export interface SceneBuild {
	scene: ThreeModule.Scene;
	camera: ThreeModule.PerspectiveCamera;
	/** Shows `count` of the scene (in the scene's own unit). */
	setCount(count: number): void;
	/** Runs one simulation step. */
	step(): void;
	/** Writes every moving object's transform and the camera for scene time `seconds`. */
	pose(seconds: number): void;
	objects(): number;
	triangles(): number;
}

export type Builder = (three: Three, options: BuildOptions) => SceneBuild;

/** A BufferGeometry that holds the shared mesh data as it is. */
export function toGeometry(three: Three, mesh: MeshData): ThreeModule.BufferGeometry {
	const geometry = new three.BufferGeometry();
	geometry.setAttribute('position', new three.BufferAttribute(mesh.position, 3));
	geometry.setAttribute('normal', new three.BufferAttribute(mesh.normal, 3));
	geometry.setIndex(new three.BufferAttribute(mesh.index, 1));
	geometry.computeBoundingSphere();
	return geometry;
}

export interface MaterialSpec {
	color?: string;
	roughness?: number;
	metalness?: number;
	unlit?: boolean;
}

/**
 * A material from a scene's description. Lit surfaces use the standard (metalness and roughness)
 * material, as null3D's standard material does; unlit ones show their color as it is. Colors are
 * sRGB hex strings, which three.js converts to linear values, as null3D does.
 */
export function makeMaterial(three: Three, spec: MaterialSpec, fog: boolean): ThreeModule.Material {
	const color = new three.Color(spec.color ?? '#ffffff');
	if (spec.unlit) return new three.MeshBasicMaterial({ color, fog });
	return new three.MeshStandardMaterial({
		color,
		roughness: spec.roughness ?? 0.8,
		metalness: spec.metalness ?? 0,
		fog,
	});
}

/**
 * An instanced mesh made for `capacity` copies. Moving batches upload every frame; still ones only
 * when told. Culling is off: the batches cover the whole scene, which the camera always sees.
 */
export function makeBatch(
	three: Three,
	geometry: ThreeModule.BufferGeometry,
	material: ThreeModule.Material,
	capacity: number,
	moving: boolean,
	shadows: boolean,
): ThreeModule.InstancedMesh {
	const batch = new three.InstancedMesh(geometry, material, capacity);
	batch.instanceMatrix.setUsage(moving ? three.DynamicDrawUsage : three.StaticDrawUsage);
	batch.frustumCulled = false;
	batch.castShadow = shadows;
	batch.receiveShadow = shadows;
	return batch;
}

/** Uploads only the copies in use: the first `count` matrices. */
export function uploadCopies(batch: ThreeModule.InstancedMesh, count: number): void {
	const matrices = batch.instanceMatrix;
	matrices.clearUpdateRanges();
	matrices.addUpdateRange(0, count * 16);
	matrices.needsUpdate = true;
}

/** The scene's lights, fog and background, from its view description. */
export interface ViewSpec {
	background: string;
	camera: { fov: number; near: number; far: number };
	sun: { direction: readonly number[]; color: string; intensity: number };
	hemisphere: { sky: string; ground: string; intensity: number };
	pointLights: readonly {
		position: readonly number[];
		color: string;
		intensity: number;
		range: number;
	}[];
	fog: { color: string; near: number; far: number };
}

/**
 * Makes the scene with its background, lights and fog, and the camera. The sun casts shadows over
 * a square of `shadowReach` meters around the origin when shadows are on.
 */
export function makeView(
	three: Three,
	view: ViewSpec,
	effects: Effects,
	shadowReach: number,
): { scene: ThreeModule.Scene; camera: ThreeModule.PerspectiveCamera } {
	const scene = new three.Scene();
	scene.background = new three.Color(view.background);
	if (effects.fog)
		scene.fog = new three.Fog(new three.Color(view.fog.color), view.fog.near, view.fog.far);
	const sun = new three.DirectionalLight(new three.Color(view.sun.color), view.sun.intensity);
	const [dx = 0, dy = -1, dz = 0] = view.sun.direction;
	const length = Math.hypot(dx, dy, dz);
	sun.position.set((-dx / length) * 100, (-dy / length) * 100, (-dz / length) * 100);
	sun.target.position.set(0, 0, 0);
	scene.add(sun, sun.target);
	if (effects.shadows) {
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		const camera = sun.shadow.camera;
		camera.left = -shadowReach;
		camera.right = shadowReach;
		camera.top = shadowReach;
		camera.bottom = -shadowReach;
		camera.near = 1;
		camera.far = 250;
		sun.shadow.bias = -0.0005;
		sun.shadow.normalBias = 0.02;
	}
	scene.add(
		new three.HemisphereLight(
			new three.Color(view.hemisphere.sky),
			new three.Color(view.hemisphere.ground),
			view.hemisphere.intensity,
		),
	);
	for (const light of view.pointLights) {
		const point = new three.PointLight(
			new three.Color(light.color),
			light.intensity,
			light.range,
			2,
		);
		point.position.set(light.position[0] ?? 0, light.position[1] ?? 0, light.position[2] ?? 0);
		scene.add(point);
	}
	const camera = new three.PerspectiveCamera(
		view.camera.fov,
		16 / 9,
		view.camera.near,
		view.camera.far,
	);
	return { scene, camera };
}
