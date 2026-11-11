import { describe, expect, it } from "vitest";
import { flightPoint } from "../src/render/globe-flight.ts";

const W = 2048;
const H = 1024;
const length = (p: readonly [number, number, number]): number => Math.hypot(p[0], p[1], p[2]);
const gap = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

describe("globe missile flight", () => {
  const from = { x: 2000, y: 400 };
  const to = { x: 60, y: 420 };

  it("starts and ends on the ground, and is highest half way", () => {
    expect(length(flightPoint(from, to, 0, W, H))).toBeCloseTo(1, 9);
    expect(length(flightPoint(from, to, 1, W, H))).toBeCloseTo(1, 9);
    const top = length(flightPoint(from, to, 0.5, W, H));
    expect(top).toBeGreaterThan(1.001);
    expect(top).toBeLessThanOrEqual(1.08);
    expect(length(flightPoint(from, to, 0.25, W, H))).toBeLessThan(top);
  });

  it("follows one continuous arc across the antimeridian", () => {
    // 108 columns apart the short way, over the seam: never the 1,900 the flat line would cross.
    let previous = flightPoint(from, to, 0, W, H);
    let longest = 0;
    for (let i = 1; i <= 100; i++) {
      const next = flightPoint(from, to, i / 100, W, H);
      longest = Math.max(longest, gap(previous, next));
      previous = next;
    }
    expect(longest).toBeLessThan(0.02);
  });

  it("stays put for a missile aimed at its own silo", () => {
    const p = flightPoint(from, from, 0.5, W, H);
    expect(length(p)).toBeCloseTo(1, 6);
  });
});
