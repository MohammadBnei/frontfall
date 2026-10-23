import { describe, expect, it } from "vitest";
import { encodeMapFile } from "../src/map/map-file.ts";
import { loadMap, type MapDescription } from "../src/map/load-map.ts";
import { sha256Hex } from "../src/map/sha256.ts";
import { TileKind } from "../src/terrain.ts";

const file = encodeMapFile({
  width: 4,
  height: 2,
  wrapsX: true,
  tiles: Uint8Array.from([0x03, 0xc0, 0xcc, 0x9f, 0x00, 0xc5, 0xd6, 0x89]),
});

const description: MapDescription = {
  width: 4,
  height: 2,
  topology: "cylinder",
  terrain: { sha256: sha256Hex(file) },
};

describe("loadMap", () => {
  it("turns magnitudes into tile kinds (R-MAP-01, R-MAP-02)", () => {
    const map = loadMap(file, description);
    expect(Array.from(map.terrain.kinds)).toEqual([
      TileKind.Water,
      TileKind.Plains,
      TileKind.Hills,
      TileKind.Impassable,
      TileKind.Water,
      TileKind.Plains,
      TileKind.Mountains,
      TileKind.Plains,
    ]);
    expect(Array.from(map.shore)).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
    expect(Array.from(map.magnitude)).toEqual([3, 0, 12, 31, 0, 5, 22, 9]);
  });

  it("builds the topology the manifest names (R-MAP-03)", () => {
    expect(loadMap(file, description).topology.wrapsX).toBe(true);
    const flatFile = encodeMapFile({
      width: 2,
      height: 1,
      wrapsX: false,
      tiles: new Uint8Array(2),
    });
    const flat = loadMap(flatFile, {
      width: 2,
      height: 1,
      topology: "flat",
      terrain: { sha256: sha256Hex(flatFile) },
    });
    expect(flat.topology.wrapsX).toBe(false);
  });

  it.each([
    ["a size that differs from the manifest", { width: 2 }, "the manifest says 2x2"],
    ["another topology", { topology: "flat" as const }, "disagree on the topology"],
    ["a checksum mismatch", { terrain: { sha256: "0".repeat(64) } }, "does not match"],
  ])("refuses %s", (_, change, message) => {
    expect(() => loadMap(file, { ...description, ...change })).toThrow(message);
  });
});
