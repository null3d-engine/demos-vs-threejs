// The scenes that have a three.js version. The page reads this list without loading three.js,
// which runs in the worker. `runtime.ts` holds the matching builders.

import type { SceneId } from '../scenes/index';

export const THREE_SCENES: readonly SceneId[] = ['factory', 'city', 'battle'];

/** Scenes with a three.js version so far. */
export function hasThreeScene(scene: SceneId): boolean {
	return THREE_SCENES.includes(scene);
}
