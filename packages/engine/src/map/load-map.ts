import { Terrain, TileKind } from "../terrain.ts";
import { WorldGrid } from "../world-grid.ts";
import {
  MAGNITUDE_IMPASSABLE,
  MapFileError,
  TILE_LAND,
  TILE_MAGNITUDE,
  TILE_SHORE,
  decodeMapFile,
} from "./map-file.ts";
import { sha256Hex } from "./sha256.ts";

/** Lowest land magnitude counted as hills, then as mountains (docs/map-format.md). */
export const HILLS_FROM = 10;
export const MOUNTAINS_FROM = 20;

/**
 * The part of a map manifest the engine checks the terrain file against. The
 * full manifest schema lives in the protocol package; any parsed manifest fits.
 */
export interface MapDescription {
  readonly width: number;
  readonly height: number;
  readonly topology: "flat" | "cylinder";
  readonly terrain: { readonly sha256: string };
}

export interface LoadedMap {
  readonly topology: WorldGrid;
  readonly terrain: Terrain;
  /** 1 for land tiles next to water, 0 elsewhere. Kept apart for ports. */
  readonly shore: Uint8Array;
  /** Raw magnitude of every tile: elevation band on land, depth band on water. */
  readonly magnitude: Uint8Array;
}

/** Builds the terrain and topology of a map from its file, refusing anything inconsistent. */
export function loadMap(bytes: Uint8Array, description: MapDescription): LoadedMap {
  const file = decodeMapFile(bytes);
  if (file.width !== description.width || file.height !== description.height) {
    throw new MapFileError(
      `file is ${String(file.width)}x${String(file.height)}, the manifest says ${String(description.width)}x${String(description.height)}`,
    );
  }
  if (file.wrapsX !== (description.topology === "cylinder")) {
    throw new MapFileError(`file and manifest disagree on the topology (${description.topology})`);
  }
  const checksum = sha256Hex(bytes);
  if (checksum !== description.terrain.sha256) {
    throw new MapFileError(`checksum ${checksum} does not match the manifest`);
  }

  const size = file.tiles.length;
  const kinds = new Uint8Array(size);
  const shore = new Uint8Array(size);
  const magnitude = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const tile = file.tiles[i] as number;
    const level = tile & TILE_MAGNITUDE;
    magnitude[i] = level;
    if ((tile & TILE_SHORE) !== 0) shore[i] = 1;
    kinds[i] = (tile & TILE_LAND) === 0 ? TileKind.Water : landKind(level);
  }
  const topology = new WorldGrid(file.width, file.height, { wrapsX: file.wrapsX });
  return { topology, terrain: new Terrain(topology, kinds), shore, magnitude };
}

function landKind(level: number): TileKind {
  if (level === MAGNITUDE_IMPASSABLE) return TileKind.Impassable;
  if (level >= MOUNTAINS_FROM) return TileKind.Mountains;
  if (level >= HILLS_FROM) return TileKind.Hills;
  return TileKind.Plains;
}
