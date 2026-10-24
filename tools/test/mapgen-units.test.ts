import { WorldGrid } from "@frontfall/engine";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { recordPublished } from "../src/mapgen/build.ts";
import { fillShapes, tileAt, type GridSpec, type Shape } from "../src/mapgen/geometry.ts";
import { pickNations } from "../src/mapgen/nations.ts";
import { encodeIndexedPng, samePngImage } from "../src/mapgen/png.ts";
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
  // 16 x 4 tiles of 1 degree, with a sea along the north.
  const wide: GridSpec = { width: 16, height: 4, west: 0, east: 16, south: 0, north: 4 };
  const topology = new WorldGrid(16, 4, { wrapsX: false });
  const tiles = new Uint8Array(64).fill(0x80);
  tiles.fill(0, 0, 16);
  const capital = (name: string, code: string, lon: number, lat: number, pop = 1) => ({
    lon,
    lat,
    properties: { adm0cap: 1, name, adm0name: `Country ${code}`, adm0_a3: code, pop_max: pop },
  });
  const country = (population: number, land = 10) => ({ population, land });

  it("places one nation per country at its capital, on land a player can own", () => {
    const nations = pickNations(
      wide,
      topology,
      tiles,
      [
        capital("Port", "AAA", 0.5, 3.5, 100), // at sea: moved one row south
        capital("Second", "AAA", 6.5, 0.5, 50), // a smaller capital of the same country
        capital("Close", "CCC", 1.5, 2.5), // too close to Port
        capital("Lost", "ZZZ", 9.5, 1.5), // no population known
        { lon: 3.5, lat: 1.5, properties: { adm0cap: 0, adm0_a3: "DDD", name: "Town" } },
        capital("Far", "BBB", 15.5, 0.5),
      ],
      new Map([
        ["AAA", country(1e6)],
        ["BBB", country(1e4)],
        ["CCC", country(1e8)],
        ["DDD", country(1e8)],
      ]),
      { count: 5, minDistance: 3 },
    );
    expect(nations).toEqual([
      { name: "Country CCC", capital: "Close", tile: 17 },
      { name: "Country BBB", capital: "Far", tile: 63 },
    ]);
  });

  it("lets a smaller country far away come before a large one next to a nation", () => {
    const pick = (popC: number) =>
      pickNations(
        wide,
        topology,
        tiles,
        [
          capital("A", "AAA", 0.5, 2.5),
          capital("B", "BBB", 2.5, 2.5),
          capital("C", "CCC", 15.5, 2.5),
        ],
        new Map([
          ["AAA", country(1e6)],
          ["BBB", country(1e6)],
          ["CCC", country(popC)],
        ]),
        { count: 3, minDistance: 2 },
      ).map((nation) => nation.capital);
    expect(pick(1e5)).toEqual(["A", "C", "B"]);
    expect(pick(1e4)).toEqual(["A", "B", "C"]);
  });

  it("keeps nations away from the edges of a flat map", () => {
    const nations = pickNations(
      wide,
      topology,
      tiles,
      [capital("Edge", "AAA", 0.5, 2.5), capital("Inland", "BBB", 8.5, 2.5)],
      new Map([
        ["AAA", country(1e9)],
        ["BBB", country(1)],
      ]),
      { count: 2, minDistance: 1, edgeMargin: 1 },
    );
    expect(nations.map((nation) => nation.capital)).toEqual(["Inland"]);
  });

  it("weighs a country by its land on the map as well as its people", () => {
    const nations = pickNations(
      wide,
      topology,
      tiles,
      [capital("Dense", "AAA", 0.5, 2.5), capital("Vast", "BBB", 15.5, 2.5)],
      new Map([
        ["AAA", country(1e6, 1)],
        ["BBB", country(1e5, 100)],
      ]),
      { count: 1, minDistance: 2 },
    );
    expect(nations.map((nation) => nation.capital)).toEqual(["Vast"]);
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

describe("samePngImage", () => {
  const palette = [
    [0, 0, 0],
    [255, 255, 255],
  ] as const;
  const image = encodeIndexedPng(2, 1, palette, Uint8Array.from([0, 1]));

  it("ignores how the pixels were compressed", () => {
    const recompressed = Buffer.from(image);
    const idat = recompressed.indexOf("IDAT");
    const stored = deflateSync(Buffer.from([0, 0, 1]), { level: 0 });
    const rebuilt = Buffer.concat([
      recompressed.subarray(0, idat - 4),
      Buffer.from([0, 0, 0, stored.length]),
      Buffer.from("IDAT"),
      stored,
      Buffer.alloc(4),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("IEND"),
      Buffer.alloc(4),
    ]);
    expect(Buffer.compare(rebuilt, image)).not.toBe(0);
    expect(samePngImage(rebuilt, image)).toBe(true);
  });

  it("tells different pixels, palettes and files apart", () => {
    expect(samePngImage(encodeIndexedPng(2, 1, palette, Uint8Array.from([1, 0])), image)).toBe(
      false,
    );
    const other = [
      [0, 0, 0],
      [9, 9, 9],
    ] as const;
    expect(samePngImage(encodeIndexedPng(2, 1, other, Uint8Array.from([0, 1])), image)).toBe(false);
    expect(samePngImage(Buffer.from("not a png"), image)).toBe(false);
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
