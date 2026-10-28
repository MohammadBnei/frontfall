import { describe, expect, it } from "vitest";
import tokens from "../../../assets/brand/tokens.json" with { type: "json" };
import {
  SURF_EAST,
  SURF_NORTH,
  SURF_SOUTH,
  SURF_WEST,
  TERRAIN_COLORS,
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

  it("matches the brand tokens", () => {
    expect(TERRAIN_COLORS).toEqual({
      landLight: tokens.map["land-light"],
      seaShallow: tokens.map["sea-shallow"],
      foam: tokens.map.foam,
    });
  });

  it("darkens the sea away from the coast and lights slopes that face the north-west", () => {
    const width = 16;
    const kinds = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    // Open water, then the coast; land rising to the east, then falling.
    const relief = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 10, 16, 10, 4, 4, 4]);
    const rgba = bakeTerrainColors({ width, height: 1, kinds, relief, wrapsX: false });
    expect(luminance(rgba, 0)).toBeLessThan(luminance(rgba, 7));
    // Rising towards the east faces away from the light; falling faces it.
    expect(luminance(rgba, 13)).toBeGreaterThan(luminance(rgba, 10));
  });
});
