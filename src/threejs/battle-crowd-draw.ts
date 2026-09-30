// The battle's crowd, drawn the way three.js's crowd example skins its copies
// (webgpu_skinning_instancing_individual): the bone matrices of every unit sit in one buffer, and
// one draw per model draws every unit of that model. The example skins in a compute pass that
// stores each copy's skinned vertices, which at 40,000 soldiers would take about 4.3 GB; here the
// same skinning math runs while drawing, so memory holds bones, not skinned vertices.
//
// On WebGPU the tables are storage buffers, and each frame uploads only the units in use. In the
// WebGPU renderer's WebGL2 mode they are float textures: that mode reads storage buffers through
// textures of its own that it does not refresh from the CPU, and it uploads a whole texture.

import type * as ThreeModule from 'three';
import type * as TSL from 'three/tsl';
import type * as WebGPU from 'three/webgpu';
import type { Poser } from './battle-pose';

type WebGPUModule = typeof WebGPU;
type TSLModule = typeof TSL;
type UintNode = WebGPU.Node<'uint'>;
type Vec4Node = WebGPU.Node<'vec4'>;

/** Texture rows are this many texels wide. */
const TABLE_WIDTH = 2048;

/** A table of vec4 values that shaders read by index. */
class Vec4Table {
	private readonly attribute: WebGPU.StorageBufferAttribute | null;
	private readonly texture: ThreeModule.DataTexture | null;
	private readonly node: WebGPU.StorageBufferNode<'vec4'> | null;

	constructor(
		webgpu: WebGPUModule,
		private readonly tsl: TSLModule,
		length: number,
		asTexture: boolean,
	) {
		if (asTexture) {
			const height = Math.max(1, Math.ceil(length / TABLE_WIDTH));
			this.texture = new webgpu.DataTexture(
				new Float32Array(TABLE_WIDTH * height * 4),
				TABLE_WIDTH,
				height,
				webgpu.RGBAFormat,
				webgpu.FloatType,
			);
			this.texture.needsUpdate = true;
			this.attribute = null;
			this.node = null;
		} else {
			this.attribute = new webgpu.StorageBufferAttribute(new Float32Array(length * 4), 4);
			this.node = tsl.storage(this.attribute, 'vec4', length).toReadOnly();
			this.texture = null;
		}
	}

	/** The values: four floats per entry. */
	get data(): Float32Array {
		return (this.texture ? this.texture.image.data : this.attribute?.array) as Float32Array;
	}

	/** A shader node that reads entry `index`. */
	read(index: UintNode): Vec4Node {
		const { tsl } = this;
		if (this.texture) {
			const x = tsl.int(index.mod(tsl.uint(TABLE_WIDTH)));
			const y = tsl.int(index.div(tsl.uint(TABLE_WIDTH)));
			return tsl.textureLoad(this.texture, tsl.ivec2(x, y)) as unknown as Vec4Node;
		}
		return (this.node as WebGPU.StorageBufferNode<'vec4'>).element(index) as unknown as Vec4Node;
	}

	/** Sends the first `entries` entries to the GPU (all of them in texture mode). */
	upload(entries: number): void {
		if (this.texture) {
			this.texture.needsUpdate = true;
			return;
		}
		const attribute = this.attribute as WebGPU.StorageBufferAttribute;
		attribute.clearUpdateRanges();
		attribute.addUpdateRange(0, entries * 4);
		attribute.needsUpdate = true;
	}
}

export interface DrawCrowdOptions {
	/** Largest number of units of this model. */
	capacity: number;
	/** Each unit slot's color, which multiplies the model's own colors: rgb per slot. */
	tints: Float32Array;
	/** Read tables from textures: the WebGPU renderer's WebGL2 mode. */
	textures: boolean;
	roughness: number;
	metalness: number;
	fog: boolean;
	shadows: boolean;
}

/**
 * Units per chunk in texture mode. The WebGPU renderer's WebGL2 mode uploads a whole texture when
 * it changes, so the tables are split into chunks with their own textures and draw, and only the
 * chunks with units in use are uploaded: the upload follows the count, not the most units.
 */
const TEXTURE_CHUNK_UNITS = 2048;

/** A run of unit slots with its own tables and draw. */
interface Chunk {
	first: number;
	size: number;
	bones: Vec4Table;
	units: Vec4Table;
	mesh: WebGPU.Mesh;
}

export class DrawCrowd {
	/** The crowd's draws: one on WebGPU, one per chunk in texture mode. */
	readonly object: WebGPU.Group;
	private readonly chunks: Chunk[] = [];
	private readonly chunkSize: number;
	private readonly boneFloats: number;
	private readonly frame: ThreeModule.Matrix4;
	private readonly place: ThreeModule.Matrix4;
	private readonly world: ThreeModule.Matrix4;
	private readonly scale: number;

	constructor(
		webgpu: WebGPUModule,
		tsl: TSLModule,
		private readonly poser: Poser,
		scale: number,
		options: DrawCrowdOptions,
	) {
		const { capacity } = options;
		this.boneFloats = poser.boneCount * 16;
		this.scale = scale;
		// The model's points in its bind pose: bone matrices then carry them to the posed model.
		const geometry = poser.mesh.geometry.clone();
		geometry.applyMatrix4(poser.mesh.bindMatrix);
		this.frame = poser.meshFrame.clone();
		this.place = new webgpu.Matrix4();
		this.world = new webgpu.Matrix4();
		this.object = new webgpu.Group();
		this.chunkSize = options.textures ? TEXTURE_CHUNK_UNITS : capacity;
		for (let first = 0; first < capacity; first += this.chunkSize) {
			const size = Math.min(this.chunkSize, capacity - first);
			const chunk = this.makeChunk(webgpu, tsl, geometry, first, size, options);
			this.chunks.push(chunk);
			this.object.add(chunk.mesh);
		}
	}

	private makeChunk(
		webgpu: WebGPUModule,
		tsl: TSLModule,
		geometry: ThreeModule.BufferGeometry,
		first: number,
		size: number,
		options: DrawCrowdOptions,
	): Chunk {
		const boneCount = this.poser.boneCount;
		const bones = new Vec4Table(webgpu, tsl, size * boneCount * 4, options.textures);
		const units = new Vec4Table(webgpu, tsl, size * 5, options.textures);
		const unitData = units.data;
		for (let local = 0; local < size; local++) {
			const slot = first + local;
			unitData[local * 20 + 16] = options.tints[slot * 3] ?? 1;
			unitData[local * 20 + 17] = options.tints[slot * 3 + 1] ?? 1;
			unitData[local * 20 + 18] = options.tints[slot * 3 + 2] ?? 1;
			unitData[local * 20 + 19] = 1;
		}
		units.upload(size * 5);

		const { Fn, attribute, instanceIndex, uint, mat4, mat3, vec4, add, normalLocal } = tsl;
		const unitMatrix = (unit: UintNode) => {
			const at = unit.mul(uint(5));
			return mat4(
				units.read(at),
				units.read(at.add(uint(1))),
				units.read(at.add(uint(2))),
				units.read(at.add(uint(3))),
			);
		};
		const boneMatrix = (unit: UintNode, joint: UintNode) => {
			const at = unit.mul(uint(boneCount * 4)).add(joint.mul(uint(4)));
			return mat4(
				bones.read(at),
				bones.read(at.add(uint(1))),
				bones.read(at.add(uint(2))),
				bones.read(at.add(uint(3))),
			);
		};
		const material = new webgpu.MeshStandardNodeMaterial({
			roughness: options.roughness,
			metalness: options.metalness,
			fog: options.fog,
		});
		material.vertexColors = true;
		material.positionNode = Fn(() => {
			const unit = instanceIndex;
			const joints = attribute('skinIndex', 'uvec4');
			const weights = attribute('skinWeight', 'vec4');
			// The skinning math of three.js's example and of its own skinned meshes.
			const skin = add(
				boneMatrix(unit, joints.x).mul(weights.x),
				boneMatrix(unit, joints.y).mul(weights.y),
				boneMatrix(unit, joints.z).mul(weights.z),
				boneMatrix(unit, joints.w).mul(weights.w),
			);
			const toWorld = unitMatrix(unit).mul(skin).toVar();
			normalLocal.assign(mat3(toWorld).mul(attribute('normal', 'vec3')).normalize());
			return toWorld.mul(vec4(attribute('position', 'vec3'), 1)).xyz;
		})();
		material.colorNode = units.read(instanceIndex.mul(uint(5)).add(uint(4)));
		const mesh = new webgpu.Mesh(geometry, material);
		mesh.frustumCulled = false;
		mesh.castShadow = options.shadows;
		mesh.receiveShadow = options.shadows;
		mesh.count = 0;
		mesh.visible = false;
		return { first, size, bones, units, mesh };
	}

	/** Writes slot `slot` from the poser's current pose, standing at (x, z) and facing `heading`. */
	write(slot: number, x: number, z: number, heading: number): void {
		const chunk = this.chunks[Math.floor(slot / this.chunkSize)] as Chunk;
		const local = slot - chunk.first;
		chunk.bones.data.set(this.poser.skeleton.boneMatrices as Float32Array, local * this.boneFloats);
		const c = Math.cos(heading) * this.scale;
		const s = Math.sin(heading) * this.scale;
		// Turn about +Y by the heading, scale to the unit's height, stand at (x, 0, z).
		this.place.set(c, 0, s, x, 0, this.scale, 0, 0, -s, 0, c, z, 0, 0, 0, 1);
		this.world.multiplyMatrices(this.place, this.frame);
		this.world.toArray(chunk.units.data, local * 20);
	}

	/** Draws the first `count` slots, and sends only their chunks' data to the GPU. */
	show(count: number): void {
		for (const chunk of this.chunks) {
			const used = Math.max(0, Math.min(chunk.size, count - chunk.first));
			chunk.mesh.count = used;
			chunk.mesh.visible = used > 0;
			if (used === 0) continue;
			chunk.bones.upload(used * this.poser.boneCount * 4);
			chunk.units.upload(used * 5);
		}
	}
}
