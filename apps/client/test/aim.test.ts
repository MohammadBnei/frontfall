import { describe, expect, it } from "vitest";
import {
  AIM_MAX_TILES,
  AIM_MIN_TILES,
  AIM_PIXELS,
  AIM_PIXELS_FINGER,
  aimReach,
} from "../src/input/aim.ts";

describe("aimReach", () => {
  it("turns the pixels a click may miss by into tiles at the zoom", () => {
    // World on a laptop at the zoom that shows it all: under a pixel per tile.
    expect(aimReach(0.8)).toBe(Math.ceil(AIM_PIXELS / 0.8));
    expect(aimReach(0.8, true)).toBe(Math.ceil(AIM_PIXELS_FINGER / 0.8));
    expect(aimReach(0.8, true)).toBeGreaterThan(aimReach(0.8));
  });

  it("keeps a few tiles zoomed in and a bound zoomed out", () => {
    expect(aimReach(40)).toBe(AIM_MIN_TILES);
    expect(aimReach(0.05)).toBe(AIM_MAX_TILES);
    expect(aimReach(0)).toBe(AIM_MAX_TILES);
    expect(aimReach(Number.NaN)).toBe(AIM_MAX_TILES);
  });
});
