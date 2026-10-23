import {
  MAGNITUDE_IMPASSABLE,
  MOUNTAINS_FROM,
  TILE_LAND,
  TILE_MAGNITUDE,
  loadMap,
} from "@frontfall/engine";
import { MapCatalog, MapManifest } from "@frontfall/protocol";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MapDefinition, PublishedMaps } from "../src/mapgen/build.ts";
import { tileAt, type GridSpec } from "../src/mapgen/geometry.ts";

const root = resolve(import.meta.dirname, "../..");
const mapsDir = join(root, "apps/client/public/maps");
const definitionsDir = join(root, "tools/mapgen/definitions");
const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8")) as unknown;

const definitions = readdirSync(definitionsDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => MapDefinition.parse(json(join(definitionsDir, file))));

const maps = definitions.map((definition) => {
  const manifest = MapManifest.parse(json(join(mapsDir, `${definition.id}.json`)));
  const bytes = new Uint8Array(readFileSync(join(mapsDir, manifest.terrain.file)));
  const tiles = bytes.subarray(16);
  const grid: GridSpec = { width: manifest.width, height: manifest.height, ...definition.bounds };
  return { definition, manifest, bytes, tiles, grid };
});

const isLand = (tile: number): boolean => (tile & TILE_LAND) !== 0;
const magnitude = (tile: number): number => tile & TILE_MAGNITUDE;

describe.each(maps)("map $definition.id", ({ definition, manifest, bytes, tiles, grid }) => {
  it("matches its definition and its published checksum", () => {
    expect(manifest).toMatchObject({
      id: definition.id,
      version: definition.version,
      width: definition.width,
      height: definition.height,
      topology: definition.topology,
    });
    const published = PublishedMaps.parse(json(join(root, "tools/mapgen/published.json")));
    expect(published[manifest.id]?.[String(manifest.version)]).toBe(manifest.terrain.sha256);
  });

  it("loads in the engine with the topology of its manifest", () => {
    // Load time is measured by `pnpm maps --check`, outside coverage instrumentation.
    expect(loadMap(bytes, manifest).topology.wrapsX).toBe(manifest.topology === "cylinder");
  });

  it("keeps every nation on land a player can own", () => {
    expect(manifest.nations.length).toBeGreaterThanOrEqual(Math.min(8, definition.nations.count));
    for (const nation of manifest.nations) {
      const tile = tiles[nation.tile] as number;
      expect(isLand(tile) && magnitude(tile) !== MAGNITUDE_IMPASSABLE, nation.name).toBe(true);
    }
  });

  it("has no playable land beyond the ice latitudes (R-MAP-02)", () => {
    const rowHeight = (grid.north - grid.south) / grid.height;
    for (let y = 0; y < grid.height; y++) {
      const lat = grid.north - (y + 0.5) * rowHeight;
      if (lat <= definition.ice.north && lat >= definition.ice.south) continue;
      for (let x = 0; x < grid.width; x++) {
        const tile = tiles[y * grid.width + x] as number;
        if (isLand(tile)) expect(magnitude(tile)).toBe(MAGNITUDE_IMPASSABLE);
      }
    }
  });

  it("ships a thumbnail under 40 KB", () => {
    expect(statSync(join(mapsDir, manifest.thumbnail)).size).toBeLessThan(40 * 1024);
  });

  it.runIf(manifest.topology === "cylinder")(
    "joins its first and last columns without a break",
    () => {
      // The seam may differ no more than the most different pair of neighbouring columns.
      const mismatches = (a: number, b: number): number => {
        let count = 0;
        for (let y = 0; y < grid.height; y++) {
          if (
            isLand(tiles[y * grid.width + a] as number) !==
            isLand(tiles[y * grid.width + b] as number)
          )
            count++;
        }
        return count;
      };
      let worst = 0;
      for (let x = 0; x + 1 < grid.width; x++) worst = Math.max(worst, mismatches(x, x + 1));
      expect(mismatches(grid.width - 1, 0)).toBeLessThanOrEqual(worst);
    },
  );
});

describe("relief", () => {
  const at = (id: string, lon: number, lat: number): number => {
    const map = maps.find((m) => m.definition.id === id);
    if (!map) throw new Error(`no map ${id}`);
    return magnitude(map.tiles[tileAt(map.grid, lon, lat) as number] as number);
  };

  it.each([
    ["the Himalayas", 86.9, 28.0],
    ["the Andes", -70.0, -32.7],
    ["the Alps", 7.5, 46.2],
  ])("puts %s among the mountains of the World map", (_, lon, lat) => {
    expect(at("world", lon, lat)).toBeGreaterThanOrEqual(MOUNTAINS_FROM);
  });

  it("puts the Alps and the Pyrenees among the mountains of Europe", () => {
    expect(at("europe", 7.5, 46.2)).toBeGreaterThanOrEqual(MOUNTAINS_FROM);
    expect(at("europe", 0.6, 42.7)).toBeGreaterThanOrEqual(MOUNTAINS_FROM);
  });

  it("keeps the Paris basin as plains", () => {
    expect(at("europe", 2.35, 48.85)).toBeLessThan(10);
  });
});

describe("seas", () => {
  /** Water tiles connected to the largest body of water of the map (R-MAP-05). */
  const ocean = (id: string): { inOcean: (lon: number, lat: number) => boolean } => {
    const map = maps.find((m) => m.definition.id === id);
    if (!map) throw new Error(`no map ${id}`);
    const topology = loadMap(map.bytes, map.manifest).topology;
    const component = new Int32Array(topology.size).fill(-1);
    const sizes: number[] = [];
    const neighbours = new Int32Array(4);
    for (let start = 0; start < topology.size; start++) {
      if (isLand(map.tiles[start] as number) || component[start] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [start];
      component[start] = id;
      while (stack.length > 0) {
        const tile = stack.pop() as number;
        size++;
        const count = topology.neighborsInto(tile, neighbours);
        for (let k = 0; k < count; k++) {
          const next = neighbours[k] as number;
          if (!isLand(map.tiles[next] as number) && component[next] === -1) {
            component[next] = id;
            stack.push(next);
          }
        }
      }
      sizes.push(size);
    }
    const largest = sizes.indexOf(Math.max(...sizes));
    return {
      inOcean: (lon, lat) => component[tileAt(map.grid, lon, lat) as number] === largest,
    };
  };

  it.each(["world", "europe"])("lets ships reach the enclosed seas of %s", (id) => {
    const { inOcean } = ocean(id);
    expect(inOcean(34, 43)).toBe(true); // Black Sea, through the Bosporus
    expect(inOcean(36.8, 46)).toBe(true); // Sea of Azov, through the Kerch Strait
    expect(inOcean(19, 57)).toBe(true); // Baltic Sea
    expect(inOcean(18, 35)).toBe(true); // Mediterranean Sea
  });

  it("keeps the Caspian Sea a lake", () => {
    const { inOcean } = ocean("world");
    expect(inOcean(51, 42)).toBe(false);
  });
});

describe("catalog", () => {
  it("lists every generated map for the menu", () => {
    const catalog = MapCatalog.parse(json(join(mapsDir, "index.json")));
    expect(catalog.maps.map((m) => m.id)).toEqual(definitions.map((d) => d.id));
  });

  it("keeps the whole set small enough to download", () => {
    const total = readdirSync(mapsDir).reduce(
      (sum, file) => sum + statSync(join(mapsDir, file)).size,
      0,
    );
    // Raw bytes; served compressed, the set is about a tenth of this.
    expect(total).toBeLessThan(12 * 1024 * 1024);
  });
});
