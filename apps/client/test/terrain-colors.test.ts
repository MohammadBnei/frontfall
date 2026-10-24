import { describe, expect, it } from "vitest";
import {
  SURF_EAST,
  SURF_NORTH,
  SURF_SOUTH,
  SURF_WEST,
  bakeTerrainColors,
} from "../src/render/terrain-colors.ts";

const luminance = (rgba: Uint8Array, tile: number): number =>
  (rgba[tile * 4] as number) + (rgba[tile * 4 + 1] as number) + (rgba[tile * 4 + 2] as number);

describe("bakeTerrainColors", () => {
  it("marks the sides of water tiles that touch land", () => {
    // One land tile in the middle of a 3 x 3 sea.
    const kinds = Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const rgba = bakeTerrainColors({
      width: 3,
      height: 3,
      kinds,
      relief: new Uint8Array(9),
      wrapsX: false,
    });
    expect(rgba[3 * 4 + 3]).toBe(SURF_EAST);
    expect(rgba[5 * 4 + 3]).toBe(SURF_WEST);
    expect(rgba[1 * 4 + 3]).toBe(SURF_SOUTH);
    expect(rgba[7 * 4 + 3]).toBe(SURF_NORTH);
    expect(rgba[4 * 4 + 3]).toBe(0);
    expect(rgba[0 * 4 + 3]).toBe(0);
  });

  it("darkens the deep sea and lights slopes that face the north-west", () => {
    const width = 8;
    const kinds = Uint8Array.from([0, 0, 1, 1, 1, 1, 1, 1]);
    // Shelf then deep water; land rising to the east, then falling.
    const relief = Uint8Array.from([0, 12, 4, 4, 10, 16, 10, 4]);
    const rgba = bakeTerrainColors({ width, height: 1, kinds, relief, wrapsX: false });
    expect(luminance(rgba, 1)).toBeLessThan(luminance(rgba, 0));
    // Rising towards the east faces away from the light; falling faces it.
    expect(luminance(rgba, 6)).toBeGreaterThan(luminance(rgba, 4));
  });
});
