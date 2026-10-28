import { describe, expect, it } from "vitest";
import tokens from "../../../assets/brand/tokens.json" with { type: "json" };
import {
  COAST_REACH,
  TERRAIN_COLORS,
  bakeTerrainColors,
  encodeCoast,
} from "../src/render/terrain-colors.ts";

const luminance = (rgba: Uint8Array, tile: number): number =>
  (rgba[tile * 4] as number) + (rgba[tile * 4 + 1] as number) + (rgba[tile * 4 + 2] as number);

/** The signed distance to the coast the alpha of a tile holds, in tiles. */
const coast = (rgba: Uint8Array, tile: number): number => {
  const r = ((rgba[tile * 4 + 3] as number) - 127.5) / 127.5;
  return Math.sign(r) * r * r * COAST_REACH;
};

describe("bakeTerrainColors", () => {
  it("holds the signed distance to the coast in alpha, every tile on its own side", () => {
    // One land tile in the middle of a 7 x 7 sea.
    const kinds = new Uint8Array(49);
    kinds[24] = 1;
    const rgba = bakeTerrainColors({
      width: 7,
      height: 7,
      kinds,
      relief: new Uint8Array(49),
      wrapsX: false,
    });
    // The lone island keeps a dot of land, though blurring rounds the coast.
    expect(coast(rgba, 24)).toBeGreaterThan(0.1);
    expect(coast(rgba, 23)).toBeLessThan(0);
    // The sea deepens away from it.
    expect(coast(rgba, 22)).toBeLessThan(coast(rgba, 23));
    expect(coast(rgba, 0)).toBeLessThan(-2);
    // Water next to land carries its colour, so filtering never greys the shore.
    expect(Array.from(rgba.slice(23 * 4, 23 * 4 + 3))).toEqual(
      Array.from(rgba.slice(24 * 4, 24 * 4 + 3)),
    );
  });

  it("carries distances across the seam of a map that wraps", () => {
    const kinds = Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const options = { width: 16, height: 1, kinds, relief: new Uint8Array(16) };
    const wrapped = bakeTerrainColors({ ...options, wrapsX: true });
    const flat = bakeTerrainColors({ ...options, wrapsX: false });
    // The last tile lies next to the first across the seam.
    expect(coast(wrapped, 15)).toBeGreaterThan(coast(flat, 15) + 5);
  });

  it("encodes the coast symmetrically around the middle", () => {
    expect(encodeCoast(0.5) + encodeCoast(-0.5)).toBe(255);
    expect(encodeCoast(COAST_REACH * 4)).toBe(255);
    expect(encodeCoast(-COAST_REACH * 4)).toBe(0);
  });

  it("matches the brand tokens", () => {
    expect(TERRAIN_COLORS).toEqual({
      landLight: tokens.map["land-light"],
      seaShallow: tokens.map["sea-shallow"],
      foam: tokens.map.foam,
    });
  });

  it("lights slopes that face the north-west", () => {
    const width = 16;
    const kinds = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    const relief = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 10, 16, 10, 4, 4, 4]);
    const rgba = bakeTerrainColors({ width, height: 1, kinds, relief, wrapsX: false });
    // Rising towards the east faces away from the light; falling faces it.
    expect(luminance(rgba, 13)).toBeGreaterThan(luminance(rgba, 10));
  });

  it("dries the land inland in the subtropics and greens it at the equator", () => {
    // A continent 200 tiles wide, from 40 degrees south to 40 north, a tile per 0.4 degree.
    const width = 240;
    const height = 200;
    const kinds = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 20; x < 220; x++) kinds[y * width + x] = 1;
    const rgba = bakeTerrainColors({
      width,
      height,
      kinds,
      relief: new Uint8Array(width * height),
      wrapsX: false,
      latitudes: [-40, 40],
    });
    const at = (latitude: number): number => Math.round((40 - latitude) / 0.4) * width + 120;
    const rgb = (tile: number): [number, number, number] => [
      rgba[tile * 4] as number,
      rgba[tile * 4 + 1] as number,
      rgba[tile * 4 + 2] as number,
    ];
    const desert = rgb(at(24));
    const forest = rgb(at(0));
    // Sand is redder than green, the rainforest greener than red.
    expect(desert[0]).toBeGreaterThan(desert[1] - 5);
    expect(forest[1]).toBeGreaterThan(forest[0]);
    expect(luminance(rgba, at(24))).toBeGreaterThan(luminance(rgba, at(0)));
  });
});
