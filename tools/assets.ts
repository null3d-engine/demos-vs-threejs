// Makes the battle's web models from the CC0 source files listed in assets/source.json.
//
// For each model it downloads the source (or uses the copy in assets/sources/), checks its SHA-256,
// then writes assets/models/<name>.glb with:
// - one skinned mesh with one primitive and one material: each part's material color becomes a
//   vertex color, and rigid parts hung on bones (a head, a rifle) are folded into the skinned mesh,
//   bound fully to their bone, so they keep their place;
// - fewer joints: finger and helper joints go, and their weights move to the nearest kept joint;
// - only the four clips the battle plays, renamed idle, run, shoot and die;
// - a simplified mesh of about the listed triangle count (meshoptimizer).
// It also writes assets/models/manifest.json with each model's figures, which the shared battle
// description reads. Run: bun run assets

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	type Accessor,
	type AnimationChannel,
	type Document,
	type Node,
	NodeIO,
	type Primitive,
} from '@gltf-transform/core';
import { joinPrimitives, prune, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Matrix3, Matrix4, Vector3 } from 'three';

interface Source {
	name: string;
	pack: string;
	packUrl: string;
	file: string;
	local: string;
	driveId: string;
	sha256: string;
	license: string;
	skinnedNode: string;
	attachments: string[];
	dropJoints: string[];
	clips: Record<'idle' | 'run' | 'shoot' | 'die', string>;
	aimJoint: string;
	height: number;
	triangles: number;
}

export interface ModelFacts {
	file: string;
	triangles: number;
	vertices: number;
	joints: number;
	/** The index in the skin's joint list of the joint that turns to aim. */
	aimJoint: number;
	/** Height of the rest pose in the file's units, and the scale that makes it the listed height. */
	restHeight: number;
	scale: number;
	/** Clip lengths in seconds. */
	clips: Record<'idle' | 'run' | 'shoot' | 'die', number>;
	source: { pack: string; url: string; file: string; license: string };
}

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');

/** The checked path of a source file, downloaded first when it is missing. */
async function sourcePath(source: Source): Promise<string> {
	const path = join(ROOT, 'assets/sources', source.local);
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await readFile(path));
	} catch {
		const url = `https://drive.google.com/uc?export=download&id=${source.driveId}`;
		console.log(`Downloading ${source.file} from ${source.pack}.`);
		const response = await fetch(url);
		if (!response.ok)
			throw new Error(`Download of ${source.file} failed: HTTP ${response.status}.`);
		bytes = new Uint8Array(await response.arrayBuffer());
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, bytes);
	}
	const hash = createHash('sha256').update(bytes).digest('hex');
	if (hash !== source.sha256)
		throw new Error(
			`${source.local} has SHA-256 ${hash}; assets/source.json expects ${source.sha256}.`,
		);
	return path;
}

/**
 * True when a channel holds its node at the node's own rest value all through the clip. Without
 * the channel the node keeps that value, so the channel only costs time.
 */
function holdsRest(channel: AnimationChannel, node: Node): boolean {
	const path = channel.getTargetPath();
	const rest =
		path === 'translation'
			? node.getTranslation()
			: path === 'rotation'
				? node.getRotation()
				: null;
	const output = channel.getSampler()?.getOutput()?.getArray();
	if (!rest || !output) return false;
	for (let i = 0; i < output.length; i++) {
		const value = output[i] as number;
		const wanted = rest[i % rest.length] as number;
		// A rotation and its negative are the same turn.
		const negated = path === 'rotation' ? -wanted : wanted;
		if (Math.abs(value - wanted) > 1e-5 && Math.abs(value - negated) > 1e-5) return false;
	}
	return true;
}

/** The node with this name; a node that carries a mesh wins over a joint of the same name. */
function findNode(document: Document, name: string): Node {
	const named = document
		.getRoot()
		.listNodes()
		.filter((n) => n.getName() === name);
	const node = named.find((n) => n.getMesh()) ?? named[0];
	if (!node) throw new Error(`The model has no node named ${name}.`);
	return node;
}

function parentOf(document: Document, node: Node): Node | null {
	return (
		document
			.getRoot()
			.listNodes()
			.find((n) => n.listChildren().includes(node)) ?? null
	);
}

/** A per-vertex copy of the primitive's material color, as COLOR_0 (linear RGB, float). */
function bakeColor(document: Document, primitive: Primitive): void {
	const count = (primitive.getAttribute('POSITION') as Accessor).getCount();
	const [r, g, b] = primitive.getMaterial()?.getBaseColorFactor() ?? [1, 1, 1, 1];
	const colors = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3);
	const buffer = document.getRoot().listBuffers()[0];
	primitive.setAttribute(
		'COLOR_0',
		document
			.createAccessor()
			.setType('VEC3')
			.setArray(colors)
			.setBuffer(buffer ?? null),
	);
}

/** Keeps only the attributes every primitive of the joined mesh has. */
function keepAttributes(primitive: Primitive): void {
	for (const semantic of primitive.listSemantics()) {
		if (!['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0', 'COLOR_0'].includes(semantic))
			primitive.setAttribute(semantic, null);
	}
}

/**
 * Folds a rigid part hung on a joint into the skin: its vertices move into the skin's bind space
 * (the joint's bind matrix times the part's local transform), and each is bound fully to the joint.
 */
function foldIntoSkin(
	document: Document,
	part: Node,
	jointIndex: number,
	inverseBind: Matrix4,
	like: Primitive,
): Primitive[] {
	const toBind = inverseBind.clone().invert().multiply(new Matrix4().fromArray(part.getMatrix()));
	const normalMatrix = new Matrix3().getNormalMatrix(toBind);
	const buffer = document.getRoot().listBuffers()[0] ?? null;
	const jointsLike = like.getAttribute('JOINTS_0') as Accessor;
	const weightsLike = like.getAttribute('WEIGHTS_0') as Accessor;
	const folded: Primitive[] = [];
	for (const primitive of part.getMesh()?.listPrimitives() ?? []) {
		const copy = primitive.clone();
		bakeColor(document, copy);
		keepAttributes(copy);
		const position = copy.getAttribute('POSITION') as Accessor;
		const normal = copy.getAttribute('NORMAL') as Accessor;
		const count = position.getCount();
		const p = new Float32Array(count * 3);
		const n = new Float32Array(count * 3);
		const v = new Vector3();
		const element: number[] = [0, 0, 0];
		for (let i = 0; i < count; i++) {
			position.getElement(i, element);
			v.fromArray(element)
				.applyMatrix4(toBind)
				.toArray(p, i * 3);
			normal.getElement(i, element);
			v.fromArray(element)
				.applyMatrix3(normalMatrix)
				.normalize()
				.toArray(n, i * 3);
		}
		copy.setAttribute(
			'POSITION',
			document.createAccessor().setType('VEC3').setArray(p).setBuffer(buffer),
		);
		copy.setAttribute(
			'NORMAL',
			document.createAccessor().setType('VEC3').setArray(n).setBuffer(buffer),
		);
		// Joints and weights with the same storage as the skinned mesh's, so the primitives can join.
		const JointArray = (jointsLike.getArray() as Uint8Array).constructor as new (
			length: number,
		) => Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer>;
		const WeightArray = (weightsLike.getArray() as Float32Array).constructor as new (
			length: number,
		) => Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer>;
		const joints = new JointArray(count * 4);
		const weights = new WeightArray(count * 4);
		const full = weightsLike.getNormalized() ? (weights instanceof Uint8Array ? 255 : 65535) : 1;
		for (let i = 0; i < count; i++) {
			joints[i * 4] = jointIndex;
			weights[i * 4] = full;
		}
		copy.setAttribute(
			'JOINTS_0',
			document.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer),
		);
		copy.setAttribute(
			'WEIGHTS_0',
			document
				.createAccessor()
				.setType('VEC4')
				.setArray(weights)
				.setNormalized(weightsLike.getNormalized())
				.setBuffer(buffer),
		);
		folded.push(copy);
	}
	return folded;
}

async function makeModel(io: NodeIO, source: Source): Promise<ModelFacts> {
	const document = await io.read(await sourcePath(source));
	const root = document.getRoot();
	const skinned = findNode(document, source.skinnedNode);
	const skin = skinned.getSkin();
	const mesh = skinned.getMesh();
	if (!skin || !mesh) throw new Error(`${source.skinnedNode} is not a skinned mesh.`);
	const joints = skin.listJoints();
	const inverseBinds = skin.getInverseBindMatrices() as Accessor;
	const bindOf = (index: number) =>
		new Matrix4().fromArray(inverseBinds.getElement(index, new Array(16).fill(0)));

	// 1. One primitive list: the skinned mesh's own, with baked colors, then the folded parts.
	const primitives = mesh.listPrimitives().map((primitive) => {
		const copy = primitive.clone();
		bakeColor(document, copy);
		keepAttributes(copy);
		return copy;
	});
	const like = primitives[0] as Primitive;
	for (const name of source.attachments) {
		const part = findNode(document, name);
		const bone = parentOf(document, part);
		const jointIndex = bone ? joints.indexOf(bone) : -1;
		if (jointIndex < 0) throw new Error(`${name} does not hang on a joint of the skin.`);
		primitives.push(...foldIntoSkin(document, part, jointIndex, bindOf(jointIndex), like));
	}
	const material = document
		.createMaterial('VertexColors')
		.setBaseColorFactor([1, 1, 1, 1])
		.setRoughnessFactor(0.8)
		.setMetallicFactor(0);
	for (const primitive of primitives) primitive.setMaterial(material);
	const joined = joinPrimitives(primitives);
	joined.setMaterial(material);
	const newMesh = document.createMesh(source.name).addPrimitive(joined);
	skinned.setMesh(newMesh);
	for (const primitive of primitives) primitive.dispose();
	// Every other mesh node goes: weapons not chosen, and the parts now folded in.
	for (const node of root.listNodes()) if (node !== skinned && node.getMesh()) node.dispose();

	// 2. Fewer joints: dropped joints hand their weights to the nearest kept ancestor.
	const drop = source.dropJoints.map((pattern) => new RegExp(pattern));
	const dropped = (node: Node) => drop.some((pattern) => pattern.test(node.getName()));
	const kept = joints.filter((joint) => !dropped(joint));
	const remap = joints.map((joint) => {
		let at: Node | null = joint;
		while (at && dropped(at)) at = parentOf(document, at);
		const index = at ? kept.indexOf(at) : -1;
		if (index < 0) throw new Error(`Joint ${joint.getName()} has no kept ancestor in the skin.`);
		return index;
	});
	const jointAttribute = joined.getAttribute('JOINTS_0') as Accessor;
	const jointArray = jointAttribute.getArray() as
		| Uint8Array<ArrayBuffer>
		| Uint16Array<ArrayBuffer>;
	for (let i = 0; i < jointArray.length; i++)
		jointArray[i] = remap[jointArray[i] as number] as number;
	jointAttribute.setArray(jointArray);
	const keptBinds = new Float32Array(kept.length * 16);
	kept.forEach((joint, k) => {
		keptBinds.set(inverseBinds.getElement(joints.indexOf(joint), new Array(16).fill(0)), k * 16);
	});
	for (const joint of joints) skin.removeJoint(joint);
	for (const joint of kept) skin.addJoint(joint);
	skin.setInverseBindMatrices(
		document
			.createAccessor()
			.setType('MAT4')
			.setArray(keptBinds)
			.setBuffer(root.listBuffers()[0] ?? null),
	);

	// 3. Only the battle's clips, renamed; channels of dropped joints go.
	const clipLengths = { idle: 0, run: 0, shoot: 0, die: 0 };
	const wanted = new Map(
		Object.entries(source.clips).map(([id, name]) => [name, id as keyof typeof clipLengths]),
	);
	for (const animation of root.listAnimations()) {
		const id = wanted.get(animation.getName());
		if (!id) {
			animation.dispose();
			continue;
		}
		animation.setName(id);
		for (const channel of animation.listChannels()) {
			const target = channel.getTargetNode();
			if (!target || dropped(target) || holdsRest(channel, target)) channel.dispose();
		}
		// Samplers that no channel uses any more go too.
		const used = new Set(animation.listChannels().map((channel) => channel.getSampler()));
		for (const sampler of animation.listSamplers()) if (!used.has(sampler)) sampler.dispose();
		let length = 0;
		for (const sampler of animation.listSamplers()) {
			const times = sampler.getInput()?.getArray();
			if (times && times.length > 0) length = Math.max(length, times[times.length - 1] as number);
		}
		clipLengths[id] = length;
	}
	for (const id of Object.keys(clipLengths) as (keyof typeof clipLengths)[])
		if (clipLengths[id] === 0) throw new Error(`${source.name} has no clip ${source.clips[id]}.`);
	// Dropped joints and helper nodes go from the scene, so nothing moves them for nothing.
	for (const node of root.listNodes()) if (dropped(node)) node.dispose();

	// 4. Simplify, then drop what nothing uses.
	const before = (joined.getIndices()?.getCount() ?? 0) / 3;
	await MeshoptSimplifier.ready;
	await document.transform(
		weld(),
		simplify({
			simplifier: MeshoptSimplifier,
			ratio: Math.min(1, source.triangles / before),
			error: 0.02,
			lockBorder: false,
		}),
		resample(),
		prune(),
	);
	const final = skinned.getMesh()?.listPrimitives()[0] as Primitive;
	const positions = final.getAttribute('POSITION') as Accessor;
	const min = positions.getMin([0, 0, 0]);
	const max = positions.getMax([0, 0, 0]);
	const restHeight = (max[1] as number) - (min[1] as number);
	const file = `assets/models/${source.name}.glb`;
	await io.write(join(ROOT, file), document);
	return {
		file,
		triangles: (final.getIndices()?.getCount() ?? 0) / 3,
		vertices: positions.getCount(),
		joints: kept.length,
		aimJoint: kept.findIndex((joint) => joint.getName() === source.aimJoint),
		restHeight,
		scale: source.height / restHeight,
		clips: clipLengths,
		source: { pack: source.pack, url: source.packUrl, file: source.file, license: source.license },
	};
}

async function main(): Promise<void> {
	const list = JSON.parse(await readFile(join(ROOT, 'assets/source.json'), 'utf8')) as {
		models: Source[];
	};
	const io = new NodeIO();
	const manifest: Record<string, ModelFacts> = {};
	for (const source of list.models) {
		const facts = await makeModel(io, source);
		if (facts.aimJoint < 0)
			throw new Error(`${source.name} lost its aim joint ${source.aimJoint}.`);
		manifest[source.name] = facts;
		console.log(
			`${source.name}: ${facts.triangles} triangles, ${facts.vertices} vertices, ${facts.joints} joints, rest height ${facts.restHeight.toFixed(3)}, scale ${facts.scale.toFixed(4)}`,
		);
	}
	await writeFile(
		join(ROOT, 'assets/models/manifest.json'),
		`${JSON.stringify(manifest, null, '\t')}\n`,
	);
}

await main();
