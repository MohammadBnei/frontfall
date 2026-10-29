import { describe, expect, it } from "vitest";
import { degree, PALETTE } from "../src/audio/palettes.ts";
import { hz, seeded } from "../src/audio/voices.ts";

describe("sound design helpers", () => {
  it("draws the same numbers from one seed and others from another", () => {
    const a = seeded(5);
    const b = seeded(5);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(seeded(6)()).not.toBe(first[0]);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("turns MIDI numbers into hertz", () => {
    expect(hz(69)).toBeCloseTo(440);
    expect(hz(81)).toBeCloseTo(880);
  });

  it("counts steps of the scale across octaves, below the tonic too", () => {
    const size = PALETTE.scale.length;
    expect(degree(PALETTE, 0)).toBe(PALETTE.tonic);
    expect(degree(PALETTE, size)).toBe(PALETTE.tonic + 12);
    expect(degree(PALETTE, -size)).toBe(PALETTE.tonic - 12);
    expect(degree(PALETTE, -1)).toBeLessThan(PALETTE.tonic);
    expect(degree(PALETTE, 1)).toBe(PALETTE.tonic + (PALETTE.scale[1] ?? 0));
  });
});
