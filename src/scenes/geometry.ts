// Mesh data that both engines upload as they are, so every shape and its triangle count match
// exactly. Setup code only: these functions allocate.

/** Vertex data of an indexed triangle mesh. */
export interface MeshData {
	/** Three floats per vertex. */
	position: Float32Array;
	/** Three floats per vertex, of unit length. */
	normal: Float32Array;
	/** Three vertex indices per triangle, counter-clockwise when seen from the front. */
	index: Uint16Array;
}

export function triangleCount(mesh: MeshData): number {
	return mesh.index.length / 3;
}

/**
 * The faces of a box, in three.js's BoxGeometry order (+X, -X, +Y, -Y, +Z, -Z). For each face: the
 * axes along the face's width, height and normal (0 = X, 1 = Y, 2 = Z), the direction of each
 * in-face axis, and which box dimension spans each axis, with its sign for the normal axis.
 */
const BOX_FACES = [
	{ u: 2, v: 1, w: 0, uDir: -1, vDir: -1, uSize: 2, vSize: 1, wSize: 0, wSign: 1 },
	{ u: 2, v: 1, w: 0, uDir: 1, vDir: -1, uSize: 2, vSize: 1, wSize: 0, wSign: -1 },
	{ u: 0, v: 2, w: 1, uDir: 1, vDir: 1, uSize: 0, vSize: 2, wSize: 1, wSign: 1 },
	{ u: 0, v: 2, w: 1, uDir: 1, vDir: -1, uSize: 0, vSize: 2, wSize: 1, wSign: -1 },
	{ u: 0, v: 1, w: 2, uDir: 1, vDir: -1, uSize: 0, vSize: 1, wSize: 2, wSign: 1 },
	{ u: 0, v: 1, w: 2, uDir: -1, vDir: -1, uSize: 0, vSize: 1, wSize: 2, wSign: -1 },
] as const;

/**
 * A box centered on the origin, with 24 vertices (4 per face, so each face has its own normal) and
 * 36 indices. It matches three.js's `BoxGeometry(width, height, depth)` value for value. Copied
 * from the null3D engine, bench/scenes/spec.ts at commit 51fb3c3 (MIT OR Apache-2.0).
 */
export function boxGeometry(width: number, height: number, depth: number): MeshData {
	const size = [width, height, depth] as const;
	const position = new Float32Array(24 * 3);
	const normal = new Float32Array(24 * 3);
	const index = new Uint16Array(36);
	for (const [f, face] of BOX_FACES.entries()) {
		const faceWidth = size[face.uSize];
		const faceHeight = size[face.vSize];
		const halfDepth = (size[face.wSize] * face.wSign) / 2;
		for (let corner = 0; corner < 4; corner++) {
			const vertex = (f * 4 + corner) * 3;
			const x = (corner & 1) * faceWidth - faceWidth / 2;
			const y = (corner >> 1) * faceHeight - faceHeight / 2;
			position[vertex + face.u] = x * face.uDir;
			position[vertex + face.v] = y * face.vDir;
			position[vertex + face.w] = halfDepth;
			normal[vertex + face.w] = face.wSign;
		}
		const first = f * 4;
		index.set([first, first + 2, first + 1, first + 2, first + 3, first + 1], f * 6);
	}
	return { position, normal, index };
}

/**
 * A closed cylinder around the Y axis, centered on the origin: `segments` side faces with smooth
 * normals, and two flat caps.
 */
export function cylinderGeometry(radius: number, height: number, segments: number): MeshData {
	const sideVertices = (segments + 1) * 2;
	const capVertices = (segments + 1) * 2;
	const vertexCount = sideVertices + capVertices;
	const position = new Float32Array(vertexCount * 3);
	const normal = new Float32Array(vertexCount * 3);
	const index = new Uint16Array(segments * 12);
	const half = height / 2;
	let v = 0;
	let t = 0;
	// Side: a bottom and a top vertex per segment edge; the seam repeats the first edge.
	for (let s = 0; s <= segments; s++) {
		const angle = (s / segments) * 2 * Math.PI;
		const x = Math.sin(angle);
		const z = Math.cos(angle);
		for (const y of [-half, half]) {
			position.set([x * radius, y, z * radius], v * 3);
			normal.set([x, 0, z], v * 3);
			v++;
		}
	}
	for (let s = 0; s < segments; s++) {
		const a = s * 2;
		index.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], t);
		t += 6;
	}
	// Caps: a center vertex and a ring vertex per segment, with flat normals.
	for (const [y, ny] of [
		[-half, -1],
		[half, 1],
	] as const) {
		const center = v;
		position.set([0, y, 0], v * 3);
		normal.set([0, ny, 0], v * 3);
		v++;
		const ring = v;
		for (let s = 0; s < segments; s++) {
			const angle = (s / segments) * 2 * Math.PI;
			position.set([Math.sin(angle) * radius, y, Math.cos(angle) * radius], v * 3);
			normal.set([0, ny, 0], v * 3);
			v++;
		}
		for (let s = 0; s < segments; s++) {
			const a = ring + s;
			const b = ring + ((s + 1) % segments);
			// Counter-clockwise seen from outside: from above for the top cap, from below for the bottom.
			if (ny > 0) index.set([center, a, b], t);
			else index.set([center, b, a], t);
			t += 3;
		}
	}
	return {
		position: position.subarray(0, v * 3),
		normal: normal.subarray(0, v * 3),
		index: index.subarray(0, t),
	};
}

/** A sphere centered on the origin, with `segments` around and `rings` from pole to pole. */
export function sphereGeometry(radius: number, segments: number, rings: number): MeshData {
	const position = new Float32Array((segments + 1) * (rings + 1) * 3);
	const normal = new Float32Array(position.length);
	const index = new Uint16Array(segments * (rings - 1) * 6);
	let v = 0;
	for (let r = 0; r <= rings; r++) {
		const polar = (r / rings) * Math.PI;
		for (let s = 0; s <= segments; s++) {
			const azimuth = (s / segments) * 2 * Math.PI;
			const x = Math.sin(polar) * Math.sin(azimuth);
			const y = Math.cos(polar);
			const z = Math.sin(polar) * Math.cos(azimuth);
			position.set([x * radius, y * radius, z * radius], v * 3);
			normal.set([x, y, z], v * 3);
			v++;
		}
	}
	let t = 0;
	for (let r = 0; r < rings; r++) {
		for (let s = 0; s < segments; s++) {
			const a = r * (segments + 1) + s;
			const b = a + segments + 1;
			// Skip the flat triangles at the poles.
			if (r !== 0) {
				index.set([a, b, a + 1], t);
				t += 3;
			}
			if (r !== rings - 1) {
				index.set([a + 1, b, b + 1], t);
				t += 3;
			}
		}
	}
	return { position, normal, index: index.subarray(0, t) };
}

/** A copy of the mesh, moved by (x, y, z). */
export function translated(mesh: MeshData, x: number, y: number, z: number): MeshData {
	const position = Float32Array.from(mesh.position);
	for (let i = 0; i < position.length; i += 3) {
		position[i] = (position[i] as number) + x;
		position[i + 1] = (position[i + 1] as number) + y;
		position[i + 2] = (position[i + 2] as number) + z;
	}
	return { position, normal: Float32Array.from(mesh.normal), index: Uint16Array.from(mesh.index) };
}

/** One mesh made of several: one draw instead of several, for parts that never move apart. */
export function merged(...meshes: MeshData[]): MeshData {
	let vertices = 0;
	let indices = 0;
	for (const mesh of meshes) {
		vertices += mesh.position.length / 3;
		indices += mesh.index.length;
	}
	if (vertices > 65536)
		throw new RangeError(`A merged mesh has ${vertices} vertices; the limit is 65536.`);
	const position = new Float32Array(vertices * 3);
	const normal = new Float32Array(vertices * 3);
	const index = new Uint16Array(indices);
	let v = 0;
	let t = 0;
	for (const mesh of meshes) {
		position.set(mesh.position, v * 3);
		normal.set(mesh.normal, v * 3);
		for (let i = 0; i < mesh.index.length; i++) index[t + i] = (mesh.index[i] as number) + v;
		v += mesh.position.length / 3;
		t += mesh.index.length;
	}
	return { position, normal, index };
}
