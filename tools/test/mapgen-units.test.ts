import { WorldGrid } from "@frontfall/engine";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { recordPublished } from "../src/mapgen/build.ts";
import { fillShapes, tileAt, type GridSpec, type Shape } from "../src/mapgen/geometry.ts";
import { pickNations } from "../src/mapgen/nations.ts";
import { encodeIndexedPng } from "../src/mapgen/png.ts";
import {
  buildTerrain,
  carveStrait,
  removeSmallComponents,
  type TerrainSources,
} from "../src/mapgen/terrain.ts";

// 8 x 4 tiles of 1 degree.
const grid: GridSpec = { width: 8, height: 4, west: 0, east: 8, south: 0, north: 4 };

const square = (west: number, south: number, east: number, north: number): [number, number][] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];
const shape = (...rings: [number, number][][]): Shape => ({ rings, properties: {} });

const rows = (mask: Uint8Array, width: number): string[] =>
  Array.from({ length: mask.length / width }, (_, y) =>
    Array.from(mask.subarray(y * width, (y + 1) * width)).join(""),
  );

describe("fillShapes", () => {
  it("marks the tiles whose centre is inside, holes excluded", () => {
    const ring = shape(square(1, 0, 7, 4), square(3, 1, 5, 3));
    expect(rows(fillShapes(grid, [ring]), 8)).toEqual([
      "01111110",
      "01100110",
      "01100110",
      "01111110",
    ]);
  });

  it("ignores a shape smaller than a tile that misses every centre", () => {
    expect(fillShapes(grid, [shape(square(0.6, 0.6, 0.9, 0.9))]).every((v) => v === 0)).toBe(true);
  });

  it("clips shapes that extend beyond the grid", () => {
    expect(rows(fillShapes(grid, [shape(square(-5, 3, 2, 10))]), 8)[0]).toBe("11000000");
  });

  it("finds the tile under a point", () => {
    expect(tileAt(grid, 0.2, 3.9)).toBe(0);
    expect(tileAt(grid, 7.9, 0.1)).toBe(31);
    expect(tileAt(grid, 8.1, 1)).toBeUndefined();
  });
});

describe("removeSmallComponents", () => {
  it("drops islands below the threshold and keeps the rest", () => {
    const topology = new WorldGrid(8, 4, { wrapsX: false });
    const mask = Uint8Array.from(
      ["00000000", "01000110", "00000110", "00000000"].join("").split("").map(Number),
    );
    expect(removeSmallComponents(topology, mask, 1, 2)).toBe(1);
    expect(rows(mask, 8)).toEqual(["00000000", "00000110", "00000110", "00000000"]);
  });

  it("keeps land touching the edge of a flat map, which continues beyond it", () => {
    const topology = new WorldGrid(8, 4, { wrapsX: false });
    const mask = new Uint8Array(32);
    mask[8] = 1;
    expect(removeSmallComponents(topology, mask, 1, 2)).toBe(0);
  });

  it("joins land across the seam of a cylinder", () => {
    const topology = new WorldGrid(8, 4, { wrapsX: true });
    const mask = new Uint8Array(32);
    mask[8] = 1;
    mask[15] = 1;
    expect(removeSmallComponents(topology, mask, 1, 2)).toBe(0);
    expect(removeSmallComponents(topology, mask, 1, 3)).toBe(1);
  });
});

const empty: TerrainSources = {
  land: [shape(square(0, 0, 8, 4), square(4, 1, 6, 3))],
  lakes: [],
  glaciers: [],
  regions: [{ rings: [square(1, 1, 3, 3)], properties: { FEATURECLA: "Range/mtn", SCALERANK: 1 } }],
  peaks: [{ lon: 1.5, lat: 1.5, properties: { elevation: 4500 } }],
  depths: [[shape(square(4, 1, 6, 3))], [], []],
  straits: [],
};

const range = empty.regions[0] as Shape;

describe("buildTerrain", () => {
  it("combines land, relief, depth, ice and shore into tile bytes", () => {
    const topology = new WorldGrid(8, 4, { wrapsX: false });
    const tiles = buildTerrain(grid, topology, empty, {
      ice: { north: 3, south: -90 },
      minIslandTiles: 0,
      minLakeTiles: 0,
    });
    // Row 0 is above the ice latitude; the 2 x 2 hole is deep water.
    expect(Array.from(tiles.subarray(0, 8), (t) => t & 0x9f)).toEqual(Array(8).fill(0x9f));
    expect(tiles[9]).toBe(0x80 | 28); // the range with a 4,500 m summit
    expect(tiles[12]).toBe(8); // water deeper than 200 m
    expect(tiles[11]).toBe(0x80 | 0x40); // plains on the shore of the hole
    expect(tiles[8]).toBe(0x80); // plains inland
  });

  it("grades ranges without a listed summit by their rank", () => {
    const topology = new WorldGrid(8, 4, { wrapsX: false });
    const options = { ice: { north: 90, south: -90 }, minIslandTiles: 0, minLakeTiles: 0 };
    const minor = {
      ...empty,
      peaks: [],
      regions: [{ ...range, properties: { FEATURECLA: "Range/mtn", SCALERANK: 5 } }],
    };
    expect((buildTerrain(grid, topology, minor, options)[9] as number) & 0x1f).toBe(13);
    const plateau = {
      ...minor,
      regions: [{ ...range, properties: { FEATURECLA: "Plateau" } }],
    };
    expect((buildTerrain(grid, topology, plateau, options)[9] as number) & 0x1f).toBe(10);
  });
});

describe("carveStrait", () => {
  it("opens a four-connected channel along the path", () => {
    const land = new Uint8Array(32).fill(1);
    carveStrait(grid, land, [
      [0.5, 3.5],
      [3.5, 0.5],
    ]);
    expect(rows(land, 8)).toEqual(["00111111", "10011111", "11001111", "11101111"]);
  });

  it("skips the parts of a path outside the grid", () => {
    const land = new Uint8Array(32).fill(1);
    carveStrait(grid, land, [
      [-3, 0.5],
      [1.5, 0.5],
    ]);
    expect(rows(land, 8)[3]).toBe("00111111");
  });
});

describe("pickNations", () => {
  const topology = new WorldGrid(8, 4, { wrapsX: false });
  const tiles = new Uint8Array(32).fill(0x80);
  tiles.fill(0, 0, 8); // a sea along the north
  const capital = (name: string, country: string, lon: number, lat: number, pop: number) => ({
    lon,
    lat,
    properties: { adm0cap: 1, name, adm0name: country, pop_max: pop },
  });

  it("takes the most populous capitals, one per country, on land, apart from each other", () => {
    const nations = pickNations(
      grid,
      topology,
      tiles,
      [
        capital("Small", "B", 7.5, 0.5, 10),
        capital("Port", "A", 0.5, 3.5, 100), // at sea: moved one row south
        capital("Second", "A", 6.5, 0.5, 50), // same country
        capital("Close", "C", 1.5, 2.5, 80), // too close to Port
        {
          lon: 3.5,
          lat: 1.5,
          properties: { adm0cap: 0, name: "Town", adm0name: "D", pop_max: 1e6 },
        },
      ],
      { count: 5, minDistance: 3 },
    );
    expect(nations).toEqual([
      { name: "A", capital: "Port", tile: 8 },
      { name: "B", capital: "Small", tile: 31 },
    ]);
  });
});

describe("recordPublished", () => {
  type Manifest = Parameters<typeof recordPublished>[1];
  const manifest = { id: "m", version: 1, terrain: { sha256: "a".repeat(64) } } as Manifest;

  it("records a new version and accepts the same bytes again", () => {
    const published = recordPublished({}, manifest, true);
    expect(published).toEqual({ m: { "1": "a".repeat(64) } });
    expect(recordPublished(published, manifest, false)).toBe(published);
  });

  it("refuses changed bytes under a published version", () => {
    const changed = { ...manifest, terrain: { ...manifest.terrain, sha256: "b".repeat(64) } };
    expect(() => recordPublished({ m: { "1": "a".repeat(64) } }, changed, true)).toThrow(
      'bump "version"',
    );
  });

  it("refuses an unpublished version in check mode", () => {
    expect(() => recordPublished({}, manifest, false)).toThrow(
      "is not in tools/mapgen/published.json",
    );
  });
});

describe("encodeIndexedPng", () => {
  it("writes a valid indexed PNG", () => {
    const png = encodeIndexedPng(
      2,
      1,
      [
        [0, 0, 0],
        [255, 255, 255],
      ],
      Uint8Array.from([0, 1]),
    );
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(2);
    const idat = png.indexOf("IDAT");
    const length = png.readUInt32BE(idat - 4);
    expect(Array.from(inflateSync(png.subarray(idat + 4, idat + 4 + length)))).toEqual([0, 0, 1]);
  });
});
