// Building blocks that every scene description shares. Everything here is plain data and pure
// functions with no engine imports. Functions that run every frame write into arrays that the
// caller owns, so they allocate nothing.

/** A list of numbers that a per-frame function fills: a typed array or a plain array. */
export type OutArray = Float32Array | Float64Array | number[];

export const TAU = 2 * Math.PI;

/**
 * A deterministic pseudo-random number generator (mulberry32). Each call returns the next float in
 * [0, 1), and the same seed always gives the same sequence. Copied from the null3D engine,
 * bench/scenes/spec.ts at commit 51fb3c3 (MIT OR Apache-2.0). Use it in setup code: the returned
 * closure is made once.
 */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), state | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * A float in [0, 1) from three integers, with no state: per-object, per-event randomness inside
 * frame code without a stored generator. The same inputs always give the same value.
 */
export function hash01(a: number, b: number, c = 0): number {
	let t =
		(Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>>
		0;
	t = (t + 0x6d2b79f5) >>> 0;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** An S-curve from 0 to 1 for t in [0, 1]: zero speed at both ends. */
export function smoothstep(t: number): number {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

/** The angle a - b wrapped into (-π, π]. */
export function angleDifference(a: number, b: number): number {
	let d = (a - b) % TAU;
	if (d > Math.PI) d -= TAU;
	else if (d <= -Math.PI) d += TAU;
	return d;
}

// The fixed-step simulation. Every scene moves in steps of SIM_STEP seconds, so both engines reach
// the same state after the same number of steps, whatever their frame rates.

/**
 * Seconds per simulation step. 120 steps a second match a 120 Hz display, so motion changes on
 * every frame there; a 60 Hz display runs two steps a frame.
 */
export const SIM_STEP = 1 / 120;
/** Steps a frame may run. A frame that falls further behind drops the rest: the scene slows. */
export const MAX_STEPS_PER_FRAME = 8;

/** Turns frame times into whole simulation steps. */
export class FixedClock {
	/** Simulation seconds so far: steps times SIM_STEP. */
	time = 0;
	/** Steps so far. */
	steps = 0;
	private carry = 0;

	/** Adds a frame's time and returns how many steps to run now. */
	advance(frameSeconds: number): number {
		this.carry += frameSeconds > 0 ? frameSeconds : 0;
		let steps = Math.floor(this.carry / SIM_STEP + 1e-9);
		if (steps > MAX_STEPS_PER_FRAME) {
			steps = MAX_STEPS_PER_FRAME;
			this.carry = 0;
		} else {
			this.carry -= steps * SIM_STEP;
		}
		this.steps += steps;
		this.time = this.steps * SIM_STEP;
		return steps;
	}
}

/** The number of steps from 0 to `seconds`: the state that hold frames and tests look at. */
export function stepsUntil(seconds: number): number {
	return Math.round(seconds / SIM_STEP);
}

// Rotations as quaternions (x, y, z, w), written into caller-owned arrays at an offset.

/** Writes the rotation of `angle` radians about the unit axis (ax, ay, az). */
export function quatAxisAngle(
	out: OutArray,
	offset: number,
	ax: number,
	ay: number,
	az: number,
	angle: number,
): void {
	const s = Math.sin(angle / 2);
	out[offset] = ax * s;
	out[offset + 1] = ay * s;
	out[offset + 2] = az * s;
	out[offset + 3] = Math.cos(angle / 2);
}

/** Writes a turn about +Y (yaw). */
export function quatYaw(out: OutArray, offset: number, angle: number): void {
	quatAxisAngle(out, offset, 0, 1, 0, angle);
}

/** Writes a turn about +X (pitch): +Y tips toward +Z for a positive angle. */
export function quatPitch(out: OutArray, offset: number, angle: number): void {
	quatAxisAngle(out, offset, 1, 0, 0, angle);
}

/** Writes a × b, the rotation b followed by a. `out` may not share storage with a or b. */
export function quatMultiply(
	out: OutArray,
	o: number,
	a: ArrayLike<number>,
	ao: number,
	b: ArrayLike<number>,
	bo: number,
): void {
	const ax = a[ao] as number;
	const ay = a[ao + 1] as number;
	const az = a[ao + 2] as number;
	const aw = a[ao + 3] as number;
	const bx = b[bo] as number;
	const by = b[bo + 1] as number;
	const bz = b[bo + 2] as number;
	const bw = b[bo + 3] as number;
	out[o] = aw * bx + ax * bw + ay * bz - az * by;
	out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
	out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
	out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

// Camera paths: closed loops through control points, sampled with a centripetal-free (uniform)
// Catmull-Rom spline so the camera moves smoothly through every point.

/** A closed camera loop. Positions and targets have three floats per control point. */
export interface CameraLoop {
	/** Seconds per loop. */
	seconds: number;
	positions: readonly number[];
	targets: readonly number[];
}

function catmullRom(p: readonly number[], count: number, u: number, axis: number): number {
	const segment = Math.floor(u);
	const t = u - segment;
	const i1 = ((segment % count) + count) % count;
	const i0 = (i1 - 1 + count) % count;
	const i2 = (i1 + 1) % count;
	const i3 = (i1 + 2) % count;
	const p0 = p[i0 * 3 + axis] as number;
	const p1 = p[i1 * 3 + axis] as number;
	const p2 = p[i2 * 3 + axis] as number;
	const p3 = p[i3 * 3 + axis] as number;
	const t2 = t * t;
	const t3 = t2 * t;
	return (
		0.5 *
		(2 * p1 +
			(-p0 + p2) * t +
			(2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
			(-p0 + 3 * p1 - 3 * p2 + p3) * t3)
	);
}

/** Writes the camera position and look-at target at time t on a closed loop. */
export function sampleCameraLoop(
	loop: CameraLoop,
	t: number,
	outPosition: OutArray,
	outTarget: OutArray,
): void {
	const count = loop.positions.length / 3;
	const phase = (t / loop.seconds) % 1;
	const u = (phase < 0 ? phase + 1 : phase) * count;
	for (let axis = 0; axis < 3; axis++) {
		outPosition[axis] = catmullRom(loop.positions, count, u, axis);
		outTarget[axis] = catmullRom(loop.targets, count, u, axis);
	}
}

/**
 * The grid cell of the i-th entry of a square spiral that starts at (0, 0) and grows ring by ring,
 * so the first n entries always form a compact patch around the origin. Setup code only.
 */
export function spiralCell(i: number, out: Int32Array, offset: number): void {
	if (i === 0) {
		out[offset] = 0;
		out[offset + 1] = 0;
		return;
	}
	// Ring r holds the 8r cells at Chebyshev distance r; rings 1..r-1 hold (2r-1)^2 - 1 cells.
	const ring = Math.ceil((Math.sqrt(i + 1) - 1) / 2);
	const side = 2 * ring;
	const before = (2 * ring - 1) * (2 * ring - 1);
	const k = i - before;
	const edge = Math.floor(k / side);
	const along = k % side;
	let x: number;
	let z: number;
	if (edge === 0) {
		x = ring;
		z = -ring + 1 + along;
	} else if (edge === 1) {
		x = ring - 1 - along;
		z = ring;
	} else if (edge === 2) {
		x = -ring;
		z = ring - 1 - along;
	} else {
		x = -ring + 1 + along;
		z = -ring;
	}
	out[offset] = x;
	out[offset + 1] = z;
}

/** Colors are sRGB hex strings. Engines convert them to linear values and light in linear space. */
export type Hex = `#${string}`;
