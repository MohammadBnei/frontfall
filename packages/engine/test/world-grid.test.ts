import { describe, expect, it } from "vitest";
import { Random } from "../src/random.ts";
import { WorldGrid } from "../src/world-grid.ts";

describe("WorldGrid", () => {
  const grid = new WorldGrid(10, 5);
  const flat = new WorldGrid(10, 5, { wrapsX: false });

  it("wraps east-west unless told otherwise (R-MAP-03)", () => {
    expect(grid.wrapsX).toBe(true);
    expect(flat.wrapsX).toBe(false);
  });

  it("wraps columns in both directions", () => {
    expect(grid.wrapX(10)).toBe(0);
    expect(grid.wrapX(-1)).toBe(9);
    expect(grid.wrapX(-21)).toBe(9);
  });

  it("round-trips coordinates through an index", () => {
    const index = grid.index(7, 3);
    expect([grid.x(index), grid.y(index)]).toEqual([7, 3]);
  });

  it("rejects rows beyond the poles, and columns beyond the edges of a flat map", () => {
    expect(() => grid.index(0, -1)).toThrow(RangeError);
    expect(() => grid.index(0, 5)).toThrow(RangeError);
    expect(grid.index(10, 0)).toBe(0);
    expect(() => flat.index(10, 0)).toThrow(RangeError);
    expect(() => flat.index(-1, 0)).toThrow(RangeError);
  });

  it("crosses the east-west seam of a cylinder only (R-MAP-04)", () => {
    expect(grid.neighbors(grid.index(9, 2))).toEqual([19, 20, 28, 39]);
    expect(grid.neighbors(grid.index(0, 2))).toEqual([10, 21, 29, 30]);
    expect(flat.neighbors(flat.index(9, 2))).toEqual([19, 28, 39]);
    expect(flat.neighbors(flat.index(0, 2))).toEqual([10, 21, 30]);
  });

  it("has no neighbours past the poles", () => {
    expect(grid.neighbors(grid.index(4, 0))).toHaveLength(3);
    expect(grid.neighbors(grid.index(4, 4))).toHaveLength(3);
    expect(grid.neighbors(grid.index(4, 2))).toHaveLength(4);
    expect(flat.neighbors(flat.index(0, 0))).toEqual([1, 10]);
  });

  it("does not list the same tile twice on very narrow worlds", () => {
    expect(new WorldGrid(1, 3).neighbors(1)).toEqual([0, 2]);
    expect(new WorldGrid(2, 1).neighbors(0)).toEqual([1]);
    expect(new WorldGrid(2, 1).neighbors(1)).toEqual([0]);
    expect(new WorldGrid(2, 1, { wrapsX: false }).neighbors(1)).toEqual([0]);
  });

  it("measures distance the short way around a cylinder only", () => {
    expect(grid.distance(grid.index(0, 0), grid.index(9, 0))).toBe(1);
    expect(flat.distance(flat.index(0, 0), flat.index(9, 0))).toBe(9);
    expect(grid.distance(grid.index(1, 1), grid.index(6, 4))).toBe(8);
  });

  it("lists the tiles within a radius across the seam", () => {
    expect(grid.tilesWithin(grid.index(0, 0), 1)).toEqual([0, 1, 9, 10]);
    expect(flat.tilesWithin(flat.index(0, 0), 1)).toEqual([0, 1, 10]);
    expect(grid.tilesWithin(grid.index(3, 2), 0)).toEqual([23]);
    expect(() => grid.tilesWithin(0, -1)).toThrow(RangeError);
    expect(() => grid.tilesWithin(0, 1.5)).toThrow(RangeError);
  });

  it("projects tile centres onto latitude and longitude", () => {
    const world = new WorldGrid(360, 180);
    expect(world.toLatLon(world.index(0, 0))).toEqual({ lat: 89.5, lon: -179.5 });
    expect(world.toLatLon(world.index(359, 179))).toEqual({ lat: -89.5, lon: 179.5 });
  });

  it("rejects invalid sizes", () => {
    expect(() => new WorldGrid(0, 5)).toThrow(RangeError);
    expect(() => new WorldGrid(3.5, 5)).toThrow(RangeError);
  });
});

// Every geometric rule must hold for both shapes and down to degenerate sizes.
describe.each([
  [1, 1, true],
  [1, 4, false],
  [2, 3, true],
  [3, 3, true],
  [7, 5, true],
  [7, 5, false],
  [16, 9, true],
])("Topology invariants on %ix%i, wrapping %s", (width, height, wrapsX) => {
  const grid = new WorldGrid(width, height, { wrapsX });
  const random = new Random(width * 100 + height);
  const sample = Array.from({ length: 40 }, () => random.nextInt(0, grid.size));

  it("writes the same neighbours without allocating", () => {
    const out = new Int32Array(4);
    for (let tile = 0; tile < grid.size; tile++) {
      const count = grid.neighborsInto(tile, out);
      expect(Array.from(out.subarray(0, count))).toEqual(grid.neighbors(tile));
    }
  });

  it("keeps neighbours distinct, symmetric and at distance one", () => {
    for (let tile = 0; tile < grid.size; tile++) {
      const neighbors = grid.neighbors(tile);
      expect(new Set(neighbors).size).toBe(neighbors.length);
      expect(neighbors).not.toContain(tile);
      for (const next of neighbors) {
        expect(grid.neighbors(next)).toContain(tile);
        expect(grid.distance(tile, next)).toBe(1);
      }
    }
  });

  it("measures a symmetric distance that obeys the triangle inequality", () => {
    for (const a of sample) {
      for (const b of sample) {
        expect(grid.distance(a, b)).toBe(grid.distance(b, a));
        expect(grid.distance(a, b)).toBeLessThanOrEqual(
          grid.distance(a, sample[0] ?? 0) + grid.distance(sample[0] ?? 0, b),
        );
      }
    }
  });

  it("finds exactly the tiles a scan by distance finds", () => {
    for (const center of sample.slice(0, 10)) {
      for (const radius of [0, 1, 2, 3, width + height]) {
        const expected = Array.from({ length: grid.size }, (_, tile) => tile).filter(
          (tile) => grid.distance(center, tile) <= radius,
        );
        expect(grid.tilesWithin(center, radius)).toEqual(expected);
      }
    }
  });
});
