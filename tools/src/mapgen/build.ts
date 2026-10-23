import {
  HILLS_FROM,
  MAGNITUDE_IMPASSABLE,
  MOUNTAINS_FROM,
  TILE_LAND,
  TILE_MAGNITUDE,
  encodeMapFile,
  sha256Hex,
} from "@frontfall/engine";
import { MapManifest, MapName, MapPlayers, type MapCatalog } from "@frontfall/protocol";
import { z } from "zod";
import type { GridSpec } from "./geometry.ts";
import { pickNations } from "./nations.ts";
import { encodeIndexedPng } from "./png.ts";
import type { SourceList } from "./sources.ts";
import { buildTerrain, topologyOf, type TerrainSources } from "./terrain.ts";
import type { Place } from "./geometry.ts";

/** A map to generate, as written in tools/mapgen/definitions/<id>.json. */
export const MapDefinition = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: MapName,
  version: z.number().int().positive(),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(4096),
  topology: z.enum(["flat", "cylinder"]),
  bounds: z.object({
    west: z.number().min(-180).max(180),
    east: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    north: z.number().min(-90).max(90),
  }),
  ice: z.object({ north: z.number(), south: z.number() }),
  minIslandTiles: z.number().int().nonnegative(),
  minLakeTiles: z.number().int().nonnegative(),
  players: MapPlayers,
  nations: z.object({ count: z.number().int().nonnegative(), minDistance: z.number().int() }),
});
export type MapDefinition = z.infer<typeof MapDefinition>;

export interface MapSources extends TerrainSources {
  places: Place[];
}

export interface BuiltMap {
  manifest: MapManifest;
  terrain: Uint8Array;
  thumbnail: Buffer;
}

export const THUMBNAIL_WIDTH = 256;

/** Thumbnail colours, from the map colours of the brand guide (docs/brand.md). */
const THUMBNAIL_PALETTE = [
  [0x0e, 0x22, 0x33], // shelf water
  [0x0a, 0x1a, 0x28], // deep water
  [0x3d, 0x4a, 0x3b], // plains
  [0x4c, 0x5a, 0x47], // hills
  [0x66, 0x70, 0x5c], // mountains
  [0xc8, 0xd2, 0xda], // ice
] as const;

export function buildMap(
  definition: MapDefinition,
  sources: MapSources,
  dataset: SourceList["dataset"],
): BuiltMap {
  const grid: GridSpec = {
    width: definition.width,
    height: definition.height,
    ...definition.bounds,
  };
  const topology = topologyOf(grid, definition.topology === "cylinder");
  const tiles = buildTerrain(grid, topology, sources, definition);
  const terrain = encodeMapFile({
    width: grid.width,
    height: grid.height,
    wrapsX: topology.wrapsX,
    tiles,
  });
  const nations = pickNations(grid, topology, tiles, sources.places, definition.nations);

  const manifest = MapManifest.parse({
    format: 1,
    id: definition.id,
    name: definition.name,
    version: definition.version,
    width: grid.width,
    height: grid.height,
    topology: definition.topology,
    projection: { type: "equirectangular", ...definition.bounds },
    terrain: { file: `${definition.id}.bin`, bytes: terrain.length, sha256: sha256Hex(terrain) },
    thumbnail: `${definition.id}.png`,
    players: definition.players,
    nations,
    credits: [dataset],
  });
  return { manifest, terrain, thumbnail: thumbnail(grid, tiles) };
}

function thumbnail(grid: GridSpec, tiles: Uint8Array): Buffer {
  const width = THUMBNAIL_WIDTH;
  const height = Math.max(1, Math.round((width * grid.height) / grid.width));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(((y + 0.5) * grid.height) / height);
    for (let x = 0; x < width; x++) {
      const column = Math.floor(((x + 0.5) * grid.width) / width);
      pixels[y * width + x] = colorIndex(tiles[row * grid.width + column] as number);
    }
  }
  return encodeIndexedPng(width, height, THUMBNAIL_PALETTE, pixels);
}

function colorIndex(tile: number): number {
  const magnitude = tile & TILE_MAGNITUDE;
  if ((tile & TILE_LAND) === 0) return magnitude === 0 ? 0 : 1;
  if (magnitude === MAGNITUDE_IMPASSABLE) return 5;
  if (magnitude >= MOUNTAINS_FROM) return 4;
  if (magnitude >= HILLS_FROM) return 3;
  return 2;
}

export function catalog(manifests: readonly MapManifest[]): MapCatalog {
  return {
    format: 1,
    maps: manifests.map((m) => ({
      id: m.id,
      name: m.name,
      width: m.width,
      height: m.height,
      topology: m.topology,
      players: m.players,
      manifest: `${m.id}.json`,
      thumbnail: m.thumbnail,
    })),
  };
}

/** SHA-256 of every published map version: `{ id: { version: sha256 } }`. */
export const PublishedMaps = z.record(z.string(), z.record(z.string(), z.string()));
export type PublishedMaps = z.infer<typeof PublishedMaps>;

/**
 * Checks a built map against the versions already published. The same id and
 * version must always mean the same terrain bytes; changing them needs a new
 * version in the definition. Returns the updated record.
 */
export function recordPublished(
  published: PublishedMaps,
  manifest: MapManifest,
  allowNew: boolean,
): PublishedMaps {
  const version = String(manifest.version);
  const known = published[manifest.id]?.[version];
  if (known === manifest.terrain.sha256) return published;
  if (known !== undefined) {
    throw new Error(
      `${manifest.id} version ${version} was published with SHA-256 ${known} and now builds to ${manifest.terrain.sha256}: bump "version" in its definition`,
    );
  }
  if (!allowNew) {
    throw new Error(`${manifest.id} version ${version} is not in tools/mapgen/published.json`);
  }
  return {
    ...published,
    [manifest.id]: { ...published[manifest.id], [version]: manifest.terrain.sha256 },
  };
}
