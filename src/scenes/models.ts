// The battle's animated models: the figures of each converted model, from the manifest that
// `bun run assets` writes next to the model files. Each engine loads the model files itself.

import manifest from '../../assets/models/manifest.json';
import type { Clip } from './battle';

export type ModelName = 'soldier' | 'mech';
export type ClipName = keyof typeof Clip;

export interface ModelInfo {
	/** The model file, from the repository root. */
	readonly file: string;
	readonly triangles: number;
	readonly vertices: number;
	readonly joints: number;
	/** The index in the skin's joint list of the joint that turns to aim. */
	readonly aimJoint: number;
	/** The height of the rest pose in the file's units. */
	readonly restHeight: number;
	/** The scale that makes the rest pose the unit's height in the battle. */
	readonly scale: number;
	/** Clip lengths in seconds. */
	readonly clips: Readonly<Record<ClipName, number>>;
}

export const MODEL_NAMES: readonly ModelName[] = ['soldier', 'mech'];

export const MODELS: Readonly<Record<ModelName, ModelInfo>> = manifest;

/** Triangles per copy of each model, for the battle's triangle count. */
export const MODEL_TRIANGLES: Readonly<Record<ModelName, number>> = {
	soldier: MODELS.soldier.triangles,
	mech: MODELS.mech.triangles,
};
