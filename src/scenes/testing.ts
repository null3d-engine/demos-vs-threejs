// Small transform math for the tests: rotate a vector, and chain parent and child transforms, the
// way an engine computes world transforms from the local ones in the scene descriptions.

/** A position and a rotation (x, y, z, w). */
export interface Pose {
	position: number[];
	rotation: number[];
}

/** Rotates vector v by quaternion q (x, y, z, w). */
export function rotate(q: ArrayLike<number>, v: readonly number[]): number[] {
	const x = q[0] ?? 0;
	const y = q[1] ?? 0;
	const z = q[2] ?? 0;
	const w = q[3] ?? 1;
	const vx = v[0] ?? 0;
	const vy = v[1] ?? 0;
	const vz = v[2] ?? 0;
	const tx = 2 * (y * vz - z * vy);
	const ty = 2 * (z * vx - x * vz);
	const tz = 2 * (x * vy - y * vx);
	return [
		vx + w * tx + (y * tz - z * ty),
		vy + w * ty + (z * tx - x * tz),
		vz + w * tz + (x * ty - y * tx),
	];
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
	const [ax = 0, ay = 0, az = 0, aw = 1] = a;
	const [bx = 0, by = 0, bz = 0, bw = 1] = b;
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
}

/** The world pose of a child: the parent's pose applied to the child's local pose. */
export function chain(parent: Pose, local: Pose): Pose {
	const moved = rotate(parent.rotation, local.position);
	return {
		position: [
			(parent.position[0] ?? 0) + (moved[0] ?? 0),
			(parent.position[1] ?? 0) + (moved[1] ?? 0),
			(parent.position[2] ?? 0) + (moved[2] ?? 0),
		],
		rotation: multiply(parent.rotation, local.rotation),
	};
}
