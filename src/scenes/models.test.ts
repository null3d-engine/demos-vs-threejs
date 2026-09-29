import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type Document, NodeIO } from '@gltf-transform/core';
import sources from '../../assets/source.json';
import { Clip } from './battle';
import { MODEL_NAMES, MODEL_TRIANGLES, MODELS } from './models';

const ROOT = join(import.meta.dir, '..', '..');
const io = new NodeIO();

/** The last key time of any channel of a clip: its length. */
function clipLength(document: Document, name: string): number {
	const clip = document
		.getRoot()
		.listAnimations()
		.find((animation) => animation.getName() === name);
	if (!clip) throw new Error(`The model has no clip "${name}".`);
	let length = 0;
	for (const sampler of clip.listSamplers()) {
		const times = sampler.getInput()?.getArray();
		if (times) length = Math.max(length, times[times.length - 1] as number);
	}
	return length;
}

describe('battle models', () => {
	test('the manifest lists each source model once', () => {
		expect(Object.keys(MODELS).sort()).toEqual([...MODEL_NAMES].sort());
		expect(sources.models.map((source) => source.name).sort()).toEqual([...MODEL_NAMES].sort());
	});

	for (const name of MODEL_NAMES) {
		const info = MODELS[name];
		const source = sources.models.find((model) => model.name === name);
		if (!source) throw new Error(`assets/source.json has no model "${name}".`);

		test(`the ${name} file holds one skinned mesh with the manifest's figures`, async () => {
			const document = await io.read(join(ROOT, info.file));
			const root = document.getRoot();
			const meshes = root.listMeshes();
			expect(meshes).toHaveLength(1);
			const primitives = meshes[0]?.listPrimitives() ?? [];
			expect(primitives).toHaveLength(1);
			const primitive = primitives[0];
			if (!primitive) return;
			expect((primitive.getIndices()?.getCount() ?? 0) / 3).toBe(info.triangles);
			expect(primitive.getAttribute('POSITION')?.getCount()).toBe(info.vertices);
			// Each part's material color is baked into a vertex color.
			expect(primitive.getAttribute('COLOR_0')).not.toBeNull();

			const skins = root.listSkins();
			expect(skins).toHaveLength(1);
			const joints = skins[0]?.listJoints() ?? [];
			expect(joints).toHaveLength(info.joints);
			expect(joints[info.aimJoint]?.getName()).toBe(source.aimJoint);

			// Every vertex names kept joints only, and its weights add up to 1.
			const jointArray = primitive.getAttribute('JOINTS_0')?.getArray() ?? [];
			for (const joint of jointArray) expect(joint).toBeLessThan(info.joints);
			const weights = primitive.getAttribute('WEIGHTS_0');
			const weight = [0, 0, 0, 0];
			for (let v = 0; v < (weights?.getCount() ?? 0); v++) {
				weights?.getElement(v, weight);
				expect(weight.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 2);
			}

			const clips = root.listAnimations().map((animation) => animation.getName());
			expect(clips.sort()).toEqual(Object.keys(Clip).sort());
			for (const clip of Object.keys(Clip) as (keyof typeof Clip)[]) {
				expect(clipLength(document, clip)).toBeCloseTo(info.clips[clip], 5);
			}
		});

		test(`the ${name} scales to its height in the battle, near its triangle target`, () => {
			expect(info.restHeight * info.scale).toBeCloseTo(source.height, 6);
			expect(Math.abs(info.triangles / source.triangles - 1)).toBeLessThan(0.1);
			expect(MODEL_TRIANGLES[name]).toBe(info.triangles);
		});
	}
});
