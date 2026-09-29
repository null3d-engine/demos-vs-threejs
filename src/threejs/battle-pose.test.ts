import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Clip } from '../scenes/battle';
import type { ModelInfo } from '../scenes/models';
import { clipSampleTime, currentClipWeight, Poser } from './battle-pose';

describe('clip times and weights', () => {
	test('idle, run and shoot loop; the fall holds its last frame', () => {
		expect(clipSampleTime(Clip.run, 2.5, 1)).toBeCloseTo(0.5, 9);
		expect(clipSampleTime(Clip.idle, -0.25, 1)).toBeCloseTo(0.75, 9);
		expect(clipSampleTime(Clip.die, 3, 0.8)).toBe(0.8);
		expect(clipSampleTime(Clip.die, 0.3, 0.8)).toBe(0.3);
	});

	test('a fade shares the weight between the new clip and the one before', () => {
		expect(currentClipWeight(Clip.run, Clip.idle, 0.25)).toBe(0.25);
		expect(currentClipWeight(Clip.run, Clip.idle, 1)).toBe(1);
		expect(currentClipWeight(Clip.run, Clip.idle, 1.5)).toBe(1);
		expect(currentClipWeight(Clip.run, Clip.run, 0.2)).toBe(1);
	});
});

/** A model with two joints: the hips move up in `run`; the torso turns about +X in `shoot`. */
function tinyModel(): { scene: THREE.Object3D; animations: THREE.AnimationClip[] } {
	const scene = new THREE.Group();
	const hips = new THREE.Bone();
	hips.name = 'Hips';
	const torso = new THREE.Bone();
	torso.name = 'Torso';
	torso.position.set(0, 1, 0);
	hips.add(torso);
	const geometry = new THREE.BoxGeometry(1, 2, 1);
	const count = geometry.getAttribute('position').count;
	geometry.setAttribute(
		'skinIndex',
		new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4),
	);
	geometry.setAttribute(
		'skinWeight',
		new THREE.Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4),
	);
	const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
	scene.add(hips, mesh);
	scene.updateMatrixWorld(true);
	mesh.bind(new THREE.Skeleton([hips, torso]));
	const still = (name: string) =>
		new THREE.AnimationClip(name, 1, [
			new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0, 0]),
		]);
	const run = new THREE.AnimationClip('run', 1, [
		new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 2, 0, 0, 2, 0]),
	]);
	const bend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4).toArray();
	const shoot = new THREE.AnimationClip('shoot', 1, [
		new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0, 0]),
		new THREE.QuaternionKeyframeTrack('Torso.quaternion', [0, 1], [...bend, ...bend]),
	]);
	return { scene, animations: [still('idle'), run, shoot, still('die')] };
}

const INFO: ModelInfo = {
	file: 'tiny',
	triangles: 12,
	vertices: 24,
	joints: 2,
	aimJoint: 1,
	restHeight: 2,
	scale: 1,
	clips: { idle: 1, run: 1, shoot: 1, die: 1 },
};

describe('Poser', () => {
	test('blends two clips by the fade', () => {
		const model = tinyModel();
		const poser = new Poser(THREE, model, INFO);
		poser.pose(Clip.run, 0.5, Clip.idle, 0.5, 0.25, 0);
		const hips = poser.skeleton.bones[0] as THREE.Bone;
		expect(hips.position.y).toBeCloseTo(0.5, 6);
		poser.pose(Clip.run, 0.5, Clip.idle, 0.5, 1, 0);
		expect(hips.position.y).toBeCloseTo(2, 6);
	});

	test('turns the torso about the vertical to aim, and the next unit starts unturned', () => {
		const model = tinyModel();
		const poser = new Poser(THREE, model, INFO);
		const torso = poser.skeleton.bones[1] as THREE.Bone;
		const facing = new THREE.Vector3();
		poser.pose(Clip.shoot, 0.5, Clip.shoot, 0, 1, 0);
		torso.getWorldDirection(facing);
		const restYaw = Math.atan2(facing.x, facing.z);
		poser.pose(Clip.shoot, 0.5, Clip.shoot, 0, 1, 0.6);
		torso.getWorldDirection(facing);
		expect(Math.atan2(facing.x, facing.z) - restYaw).toBeCloseTo(0.6, 5);
		// The same pose without aim: the mixer does not write an unchanged joint, so the Poser must
		// undo the turn itself.
		poser.pose(Clip.shoot, 0.5, Clip.shoot, 0, 1, 0);
		torso.getWorldDirection(facing);
		expect(Math.atan2(facing.x, facing.z)).toBeCloseTo(restYaw, 5);
	});

	test('writes bone matrices that follow the pose', () => {
		const model = tinyModel();
		const poser = new Poser(THREE, model, INFO);
		poser.pose(Clip.run, 0.5, Clip.run, 0, 1, 0);
		// Bone 0 moved 2 up from its bind place: its skinning matrix lifts points by 2.
		const lifted = new THREE.Vector3(0, 0, 0).applyMatrix4(
			new THREE.Matrix4().fromArray(poser.skeleton.boneMatrices as Float32Array, 0),
		);
		expect(lifted.y).toBeCloseTo(2, 6);
	});
});
