// The battle's crowd the documented way for three.js's WebGL renderer: each unit is its own copy of
// the model (SkeletonUtils.clone), with its own bones and one draw. The shared Poser poses the
// model; each unit's bones take the posed local transforms, and three.js skins it while drawing.
//
// Units are made as the count grows, not all up front: 40,000 separate models would be about
// 900,000 scene objects, more than a browser tab holds well.

import type * as ThreeModule from 'three';
import type { Poser } from './battle-pose';
import type { Three } from './common';

export type CloneModel = (source: ThreeModule.Object3D) => ThreeModule.Object3D;

interface Unit {
	root: ThreeModule.Object3D;
	bones: ThreeModule.Bone[];
}

export interface SkinnedCrowdOptions {
	/** Each unit slot's army: its material. */
	armyOf: (slot: number) => number;
	/** One material per army. */
	materials: [ThreeModule.Material, ThreeModule.Material];
	shadows: boolean;
}

export class SkinnedCrowd {
	readonly group: ThreeModule.Group;
	private readonly units: Unit[] = [];
	private readonly sphere: ThreeModule.Sphere;
	private shown = 0;

	constructor(
		three: Three,
		private readonly poser: Poser,
		private readonly source: ThreeModule.Object3D,
		private readonly clone: CloneModel,
		private readonly scale: number,
		private readonly options: SkinnedCrowdOptions,
	) {
		this.group = new three.Group();
		// One sphere for every unit, around the model at rest with room for any pose, so three.js
		// can skip units outside the view without measuring each posed model.
		const geometry = poser.mesh.geometry;
		geometry.computeBoundingSphere();
		this.sphere = (geometry.boundingSphere as ThreeModule.Sphere).clone();
		this.sphere.radius *= 1.6;
	}

	private makeUnit(slot: number): Unit {
		const root = this.clone(this.source);
		let bones: ThreeModule.Bone[] = [];
		root.traverse((object) => {
			const mesh = object as ThreeModule.SkinnedMesh;
			if (!mesh.isSkinnedMesh) return;
			mesh.material = this.options.materials[this.options.armyOf(slot)] as ThreeModule.Material;
			mesh.castShadow = this.options.shadows;
			mesh.receiveShadow = this.options.shadows;
			mesh.boundingSphere = this.sphere;
			bones = mesh.skeleton.bones;
		});
		root.scale.setScalar(this.scale);
		this.group.add(root);
		return { root, bones };
	}

	/** Writes slot `slot` from the poser's current pose, standing at (x, z) and facing `heading`. */
	write(slot: number, x: number, z: number, heading: number): void {
		while (this.units.length <= slot) this.units.push(this.makeUnit(this.units.length));
		const unit = this.units[slot] as Unit;
		const posed = this.poser.skeleton.bones;
		for (let j = 0; j < posed.length; j++) {
			const from = posed[j] as ThreeModule.Bone;
			const to = unit.bones[j] as ThreeModule.Bone;
			to.position.copy(from.position);
			to.quaternion.copy(from.quaternion);
			to.scale.copy(from.scale);
		}
		unit.root.position.set(x, 0, z);
		unit.root.rotation.set(0, heading, 0);
	}

	/** Draws the first `count` slots. */
	show(count: number): void {
		for (let slot = count; slot < this.shown; slot++) {
			const unit = this.units[slot];
			if (unit) unit.root.visible = false;
		}
		for (let slot = 0; slot < count && slot < this.units.length; slot++)
			(this.units[slot] as Unit).root.visible = true;
		this.shown = count;
	}
}
