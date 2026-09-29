import { describe, expect, test } from 'bun:test';
import { BoxGeometry } from 'three';
import {
	boxGeometry,
	cylinderGeometry,
	type MeshData,
	merged,
	sphereGeometry,
	translated,
	triangleCount,
} from './geometry';

/** Checks unit normals, and that every triangle faces away from the mesh's center point. */
function expectClosedOutward(mesh: MeshData, center: readonly number[]): void {
	const p = mesh.position;
	for (let v = 0; v < p.length / 3; v++) {
		const n = mesh.normal;
		expect(Math.hypot(n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!)).toBeCloseTo(1, 5);
	}
	for (let t = 0; t < mesh.index.length; t += 3) {
		const [a, b, c] = [mesh.index[t]!, mesh.index[t + 1]!, mesh.index[t + 2]!];
		const e1 = [
			p[b * 3]! - p[a * 3]!,
			p[b * 3 + 1]! - p[a * 3 + 1]!,
			p[b * 3 + 2]! - p[a * 3 + 2]!,
		];
		const e2 = [
			p[c * 3]! - p[a * 3]!,
			p[c * 3 + 1]! - p[a * 3 + 1]!,
			p[c * 3 + 2]! - p[a * 3 + 2]!,
		];
		const normal = [
			e1[1]! * e2[2]! - e1[2]! * e2[1]!,
			e1[2]! * e2[0]! - e1[0]! * e2[2]!,
			e1[0]! * e2[1]! - e1[1]! * e2[0]!,
		];
		const centroid = [0, 1, 2].map(
			(axis) => (p[a * 3 + axis]! + p[b * 3 + axis]! + p[c * 3 + axis]!) / 3,
		);
		const outward = centroid.map((value, axis) => value - center[axis]!);
		const dot = normal[0]! * outward[0]! + normal[1]! * outward[1]! + normal[2]! * outward[2]!;
		expect(dot).toBeGreaterThan(0);
	}
}

describe('boxGeometry', () => {
	test("matches three.js's BoxGeometry value for value", () => {
		const ours = boxGeometry(1.5, 0.7, 2.25);
		const theirs = new BoxGeometry(1.5, 0.7, 2.25);
		expect([...ours.position]).toEqual([
			...(theirs.getAttribute('position').array as Float32Array),
		]);
		expect([...ours.normal]).toEqual([...(theirs.getAttribute('normal').array as Float32Array)]);
		expect([...ours.index]).toEqual([...(theirs.getIndex()!.array as Uint16Array)]);
	});

	test('has 12 triangles, all facing out', () => {
		const box = boxGeometry(1, 2, 3);
		expect(triangleCount(box)).toBe(12);
		expectClosedOutward(box, [0, 0, 0]);
	});
});

describe('cylinderGeometry', () => {
	test('has 4 triangles per segment, all facing out', () => {
		const cylinder = cylinderGeometry(0.5, 2, 24);
		expect(triangleCount(cylinder)).toBe(24 * 4);
		expectClosedOutward(cylinder, [0, 0, 0]);
	});
});

describe('sphereGeometry', () => {
	test('has 2 × segments × (rings - 1) triangles, all facing out, on its radius', () => {
		const sphere = sphereGeometry(2, 12, 8);
		expect(triangleCount(sphere)).toBe(2 * 12 * 7);
		expectClosedOutward(sphere, [0, 0, 0]);
		const p = sphere.position;
		for (let v = 0; v < p.length / 3; v++)
			expect(Math.hypot(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!)).toBeCloseTo(2, 5);
	});
});

describe('translated and merged', () => {
	test('translated moves every vertex and keeps the source', () => {
		const box = boxGeometry(1, 1, 1);
		const moved = translated(box, 0, 0.5, 0);
		expect(
			Math.min(...Array.from({ length: 24 }, (_, v) => moved.position[v * 3 + 1]!)),
		).toBeCloseTo(0, 6);
		expect([...box.position]).toEqual([...boxGeometry(1, 1, 1).position]);
		expectClosedOutward(moved, [0, 0.5, 0]);
	});

	test('merged keeps every triangle, with indices moved to the right vertices', () => {
		const a = translated(boxGeometry(1, 1, 1), -3, 0, 0);
		const b = translated(boxGeometry(1, 1, 1), 3, 0, 0);
		const both = merged(a, b);
		expect(triangleCount(both)).toBe(24);
		expect(both.index[12 * 3]).toBe(both.index[0]! + 24);
		expect(both.position[24 * 3]).toBe(b.position[0]!);
	});
});
