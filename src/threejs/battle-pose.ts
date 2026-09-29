// Poses the battle's units the way three.js's crowd example does
// (webgpu_skinning_instancing_individual): one AnimationMixer per model type, set to each unit's
// clips and times in turn, then the skeleton's bone matrices are read. The battle adds a blend of
// two clips while a unit changes clip, and an aim turn of the torso.

import type * as ThreeModule from 'three';
import { Clip } from '../scenes/battle';
import type { ClipName, ModelInfo } from '../scenes/models';

/** The three.js module in use: `three` or `three/webgpu` (they share these classes). */
type Three = typeof ThreeModule;

const CLIP_NAMES: readonly ClipName[] = ['idle', 'run', 'shoot', 'die'];

/**
 * The time to sample a clip at: idle, run and shoot loop; the fall plays once and holds its last
 * frame.
 */
export function clipSampleTime(clip: number, time: number, duration: number): number {
	if (clip === Clip.die) return Math.min(Math.max(time, 0), duration);
	const wrapped = time % duration;
	return wrapped < 0 ? wrapped + duration : wrapped;
}

/**
 * The weight of the current clip while a unit fades from the previous clip to it: `fade`, from 0 to
 * 1. The previous clip gets the rest. The same clip twice gets all the weight.
 */
export function currentClipWeight(clip: number, previousClip: number, fade: number): number {
	if (clip === previousClip) return 1;
	return Math.min(Math.max(fade, 0), 1);
}

/** A loaded animated model: its scene (with one skinned mesh) and its clips. */
export interface LoadedModel {
	scene: ThreeModule.Object3D;
	animations: ThreeModule.AnimationClip[];
}

export class Poser {
	readonly mesh: ThreeModule.SkinnedMesh;
	readonly skeleton: ThreeModule.Skeleton;
	readonly boneCount: number;
	/** The model's own frame: skinned points times this matrix give the model at the origin. */
	readonly meshFrame: ThreeModule.Matrix4;
	private readonly root: ThreeModule.Object3D;
	private readonly mixer: ThreeModule.AnimationMixer;
	private readonly actions: ThreeModule.AnimationAction[];
	private readonly durations: number[];
	private readonly aimBone: ThreeModule.Bone;
	private readonly up: ThreeModule.Vector3;
	private readonly axis: ThreeModule.Vector3;
	private readonly turn: ThreeModule.Quaternion;
	private readonly parentTurn: ThreeModule.Matrix4;
	/** The torso's turn from the mixer, kept while an aim turn is added to it. */
	private readonly mixerTurn: ThreeModule.Quaternion;
	private aimed = false;

	constructor(three: Three, model: LoadedModel, info: ModelInfo) {
		let mesh: ThreeModule.SkinnedMesh | null = null;
		model.scene.traverse((object) => {
			if ((object as ThreeModule.SkinnedMesh).isSkinnedMesh)
				mesh = object as ThreeModule.SkinnedMesh;
		});
		if (!mesh) throw new Error('The model has no skinned mesh.');
		this.mesh = mesh;
		this.skeleton = (mesh as ThreeModule.SkinnedMesh).skeleton;
		this.boneCount = this.skeleton.bones.length;
		if (this.boneCount !== info.joints)
			throw new Error(`The model has ${this.boneCount} joints; its manifest says ${info.joints}.`);
		this.root = model.scene;
		this.root.updateMatrixWorld(true);
		this.meshFrame = new three.Matrix4().multiplyMatrices(
			this.mesh.matrixWorld,
			this.mesh.bindMatrixInverse,
		);
		this.mixer = new three.AnimationMixer(this.root);
		this.actions = CLIP_NAMES.map((name) => {
			const clip = model.animations.find((animation) => animation.name === name);
			if (!clip) throw new Error(`The model has no clip "${name}".`);
			// Keys that repeat their neighbors go, as three.js's own clip clean-up does.
			clip.optimize();
			const action = this.mixer.clipAction(clip);
			action.play();
			action.setEffectiveWeight(0);
			return action;
		});
		this.durations = this.actions.map((action) => action.getClip().duration);
		const aimBone = this.skeleton.bones[info.aimJoint];
		if (!aimBone) throw new Error(`The model has no joint ${info.aimJoint} to aim with.`);
		this.aimBone = aimBone;
		this.up = new three.Vector3(0, 1, 0);
		this.axis = new three.Vector3();
		this.turn = new three.Quaternion();
		this.parentTurn = new three.Matrix4();
		this.mixerTurn = new three.Quaternion();
	}

	/**
	 * Poses the model: `clip` at `clipTime` with weight `fade`, `previousClip` at `previousTime`
	 * with the rest, and the torso turned by `aim` radians about the vertical. The bone matrices
	 * are then in `skeleton.boneMatrices`, and each bone holds its local transform.
	 */
	pose(
		clip: number,
		clipTime: number,
		previousClip: number,
		previousTime: number,
		fade: number,
		aim: number,
	): void {
		// The mixer writes a joint only when its value changes, so the torso gets back the mixer's
		// value before the next pose; else one unit's aim would carry over to the next.
		if (this.aimed) {
			this.aimBone.quaternion.copy(this.mixerTurn);
			this.aimed = false;
		}
		const current = currentClipWeight(clip, previousClip, fade);
		const previous = 1 - current;
		for (let a = 0; a < this.actions.length; a++)
			(this.actions[a] as ThreeModule.AnimationAction).setEffectiveWeight(0);
		const now = this.actions[clip] as ThreeModule.AnimationAction;
		now.time = clipSampleTime(clip, clipTime, this.durations[clip] as number);
		now.setEffectiveWeight(current);
		if (previous > 0) {
			const before = this.actions[previousClip] as ThreeModule.AnimationAction;
			before.time = clipSampleTime(
				previousClip,
				previousTime,
				this.durations[previousClip] as number,
			);
			before.setEffectiveWeight(previous);
		}
		this.mixer.update(0);
		this.root.updateMatrixWorld(true);
		if (aim !== 0) {
			// Turn the torso about the model's vertical, which is the parent's inverse turn of +Y.
			const bone = this.aimBone;
			const parent = bone.parent as ThreeModule.Object3D;
			this.parentTurn.extractRotation(parent.matrixWorld).transpose();
			this.axis.copy(this.up).transformDirection(this.parentTurn);
			this.turn.setFromAxisAngle(this.axis, aim);
			this.mixerTurn.copy(bone.quaternion);
			this.aimed = true;
			bone.quaternion.premultiply(this.turn);
			bone.updateMatrixWorld(true);
		}
		this.skeleton.update();
	}
}
