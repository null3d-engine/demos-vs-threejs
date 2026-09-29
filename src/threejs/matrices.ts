// Transform matrices written straight into batch arrays, in three.js order: column after column.
// No three.js import, so tests can use them.

/**
 * Writes a transform matrix (three.js order: column after column) from a rotation given as three
 * columns (x axis, y axis, z axis) and a position.
 */
export function writeMatrix(
	out: Float32Array,
	offset: number,
	xx: number,
	xy: number,
	xz: number,
	yx: number,
	yy: number,
	yz: number,
	zx: number,
	zy: number,
	zz: number,
	px: number,
	py: number,
	pz: number,
): void {
	out[offset] = xx;
	out[offset + 1] = xy;
	out[offset + 2] = xz;
	out[offset + 3] = 0;
	out[offset + 4] = yx;
	out[offset + 5] = yy;
	out[offset + 6] = yz;
	out[offset + 7] = 0;
	out[offset + 8] = zx;
	out[offset + 9] = zy;
	out[offset + 10] = zz;
	out[offset + 11] = 0;
	out[offset + 12] = px;
	out[offset + 13] = py;
	out[offset + 14] = pz;
	out[offset + 15] = 1;
}

/** Writes a matrix from a quaternion (x, y, z, w) and a position. */
export function writeQuaternionMatrix(
	out: Float32Array,
	offset: number,
	x: number,
	y: number,
	z: number,
	w: number,
	px: number,
	py: number,
	pz: number,
): void {
	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;
	writeMatrix(
		out,
		offset,
		1 - (yy + zz),
		xy + wz,
		xz - wy,
		xy - wz,
		1 - (xx + zz),
		yz + wx,
		xz + wy,
		yz - wx,
		1 - (xx + yy),
		px,
		py,
		pz,
	);
}
