import { describe, expect, it } from "vitest";
import {
  BUILDING_KINDS,
  GRID,
  levelFor,
  pictogram,
  settleLevel,
  type BuildingKind,
  type Level,
  type Point,
} from "../src/render/pieces-geo.ts";
import { GLYPH } from "../src/render/pieces-paint.ts";

/** Marker sizes on screen; the pictogram is drawn at its share of them. */
const SIZES = [16, 20, 24] as const;
const SAMPLES = 4;

function inside(polygon: readonly Point[], x: number, y: number): boolean {
  let odd = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] as Point;
    const [xj, yj] = polygon[j] as Point;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

/** Pixels across the pictogram of a marker `size` px wide. */
const glyphPixels = (size: number): number => Math.round((size * GRID * GLYPH) / 100);

/** How much of each pixel of a `pixels`-px square the pictogram covers, 0 to 1, cut-outs and all. */
function coverage(kind: BuildingKind, pixels: number, level: Level = 0): Float32Array {
  const shapes = pictogram(kind, level);
  const grid = new Float32Array(pixels * pixels);
  const step = GRID / (pixels * SAMPLES);
  for (let py = 0; py < pixels; py++) {
    for (let px = 0; px < pixels; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px * SAMPLES + sx + 0.5) * step;
          const y = (py * SAMPLES + sy + 0.5) * step;
          let filled = false;
          for (const shape of shapes) if (inside(shape.points, x, y)) filled = !shape.cut;
          if (filled) hits++;
        }
      }
      grid[py * pixels + px] = hits / (SAMPLES * SAMPLES);
    }
  }
  return grid;
}

/** Intersection over union of two coverages: 1 for the same shape, near 0 for unrelated ones. */
function overlap(a: Float32Array, b: Float32Array): number {
  let both = 0;
  let either = 0;
  a.forEach((v, i) => {
    const w = b[i] ?? 0;
    both += Math.min(v, w);
    either += Math.max(v, w);
  });
  return both / either;
}

/** How far the skyline is from being its own mirror image, 0 (even) to 1. */
function lopsidedness(kind: BuildingKind, size: number): number {
  const grid = coverage(kind, size);
  const heights = Array.from({ length: size }, (_, x) => {
    let rows = 0;
    for (let y = 0; y < size; y++) if ((grid[y * size + x] ?? 0) > 0.5) rows++;
    return rows;
  });
  const first = heights.findIndex((h) => h > 0);
  const last = heights.findLastIndex((h) => h > 0);
  let apart = 0;
  let total = 0;
  for (let x = first; x <= last; x++) {
    const here = heights[x] ?? 0;
    const there = heights[first + last - x] ?? 0;
    apart += Math.abs(here - there);
    total += Math.max(here, there);
  }
  return apart / total;
}

describe("pieces pictograms", () => {
  it("draws the nine buildings, each with a silhouette and its details", () => {
    expect(BUILDING_KINDS).toHaveLength(9);
    for (const kind of BUILDING_KINDS) {
      expect(pictogram(kind, 0).filter((shape) => !shape.cut).length, kind).toBeGreaterThan(0);
      expect(pictogram(kind, 1).length, kind).toBeGreaterThanOrEqual(pictogram(kind, 0).length);
    }
  });

  it("stays inside the disc", () => {
    // The disc's inner edge is 38 units from the centre, a grid unit GLYPH of them.
    const reach = 38 / GLYPH;
    for (const kind of BUILDING_KINDS) {
      for (const shape of pictogram(kind, 1)) {
        if (shape.cut) continue;
        for (const [x, y] of shape.points) {
          expect(Math.hypot(x - GRID / 2, y - GRID / 2), kind).toBeLessThanOrEqual(reach);
        }
      }
    }
  });

  it("chooses the level of detail from the size on screen", () => {
    expect([16, 29, 30, 200].map(levelFor)).toEqual([0, 0, 1, 1]);
  });

  it("keeps the same silhouette when the details are added", () => {
    for (const kind of BUILDING_KINDS) {
      expect(overlap(coverage(kind, 24, 0), coverage(kind, 24, 1)), kind).toBeGreaterThan(0.8);
    }
  });

  it("draws nothing finer than the first level can show", () => {
    for (const kind of BUILDING_KINDS) {
      for (const shape of pictogram(kind, 0)) {
        const xs = shape.points.map(([x]) => x);
        const ys = shape.points.map(([, y]) => y);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        expect(Math.min(width, height), kind).toBeGreaterThanOrEqual(1.4);
      }
    }
  });

  it.each(SIZES)("tells the nine pictograms apart on a marker of %i px", (size) => {
    const grids = BUILDING_KINDS.map((kind) => coverage(kind, glyphPixels(size)));
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        const value = overlap(grids[i] as Float32Array, grids[j] as Float32Array);
        expect(
          value,
          `${BUILDING_KINDS[i] as string} / ${BUILDING_KINDS[j] as string}`,
        ).toBeLessThan(0.72);
      }
    }
  });

  it.each(SIZES)("keeps the city, the fort and the palace clearly apart at %i px", (size) => {
    const [city, fort, palace] = (["city", "fort", "palace"] as const).map((kind) =>
      coverage(kind, glyphPixels(size)),
    );
    expect(overlap(city as Float32Array, fort as Float32Array)).toBeLessThan(0.66);
    expect(overlap(city as Float32Array, palace as Float32Array)).toBeLessThan(0.7);
    expect(overlap(fort as Float32Array, palace as Float32Array)).toBeLessThan(0.7);
  });

  it("makes the city lopsided, the palace and the fort even", () => {
    expect(lopsidedness("city", 48)).toBeGreaterThan(0.25);
    expect(lopsidedness("palace", 48)).toBeLessThan(0.15);
    expect(lopsidedness("fort", 48)).toBeLessThan(0.15);
  });

  it("makes the fort low and wide and the city tall", () => {
    const rows = (kind: BuildingKind): number => {
      const grid = coverage(kind, 24);
      let top = 24;
      grid.forEach((v, i) => {
        if (v > 0.5) top = Math.min(top, Math.floor(i / 24));
      });
      return 24 - top;
    };
    expect(rows("fort")).toBeLessThan(rows("city") - 3);
    expect(rows("palace")).toBeGreaterThan(rows("fort"));
  });
});

describe("settleLevel", () => {
  it("rises past the threshold only by a margin, and falls back the same way", () => {
    expect(settleLevel(0, 31)).toBe(0);
    expect(settleLevel(0, 34)).toBe(1);
    expect(settleLevel(1, 29)).toBe(1);
    expect(settleLevel(1, 26)).toBe(0);
  });

  it("jumps straight to the level a large change calls for", () => {
    expect(settleLevel(0, 120)).toBe(1);
    expect(settleLevel(1, 10)).toBe(0);
  });
});
