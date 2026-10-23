import { describe, expect, it } from "vitest";
import { MapCatalog, MapManifest } from "../src/maps.ts";

const manifest = {
  format: 1,
  id: "tiny-world",
  name: { en: "Tiny world", fr: "Petit monde" },
  version: 1,
  width: 4,
  height: 2,
  topology: "cylinder",
  projection: { type: "equirectangular", west: -180, east: 180, south: -90, north: 90 },
  terrain: { file: "tiny-world.bin", bytes: 24, sha256: "a".repeat(64) },
  thumbnail: "tiny-world.png",
  players: { min: 2, recommended: 2, max: 4 },
  nations: [{ name: "Westland", capital: "Port", tile: 5 }],
  credits: [
    { title: "Natural Earth", url: "https://www.naturalearthdata.com/", license: "Public domain" },
  ],
};

const issues = (value: unknown): string[] => {
  const result = MapManifest.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("MapManifest", () => {
  it("accepts a consistent manifest", () => {
    expect(issues(manifest)).toEqual([]);
  });

  it("rejects a terrain file whose length does not match the declared size", () => {
    expect(issues({ ...manifest, width: 8 })).toEqual(["a 8x2 map has 32 bytes"]);
  });

  it("rejects a cylinder that does not go all the way round", () => {
    const projection = { ...manifest.projection, west: -170 };
    expect(issues({ ...manifest, projection })).toEqual(["a cylinder map spans every longitude"]);
  });

  it("rejects empty bounds on a flat map", () => {
    const projection = { ...manifest.projection, south: 40, north: 40 };
    expect(issues({ ...manifest, topology: "flat", projection })).toEqual(["empty bounds"]);
  });

  it("rejects a nation outside the map and inconsistent player counts", () => {
    expect(issues({ ...manifest, nations: [{ name: "N", capital: "C", tile: 8 }] })).toEqual([
      "tile outside the map",
    ]);
    expect(issues({ ...manifest, players: { min: 3, recommended: 2, max: 4 } })).toEqual([
      "min <= recommended <= max",
    ]);
  });

  it("rejects file names that leave the map folder", () => {
    const terrain = { ...manifest.terrain, file: "../secret.bin" };
    expect(issues({ ...manifest, terrain })).toEqual(["a file next to the manifest"]);
  });
});

describe("MapCatalog", () => {
  it("lists maps for the menu", () => {
    const entry = {
      id: "tiny-world",
      name: manifest.name,
      width: 4,
      height: 2,
      topology: "cylinder",
      players: manifest.players,
      manifest: "tiny-world.json",
      thumbnail: "tiny-world.png",
    };
    expect(MapCatalog.parse({ format: 1, maps: [entry] }).maps).toHaveLength(1);
    expect(MapCatalog.safeParse({ format: 2, maps: [] }).success).toBe(false);
  });
});
