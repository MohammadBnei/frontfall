import { TileKind, WorldGrid } from "@frontfall/engine";
import { generateLand } from "../terrain.ts";

/** Everything the simulation and the renderer need to know about a map. */
export interface MapData {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly wrapsX: boolean;
  /** TileKind of every tile, row 0 at the north edge. */
  readonly kinds: Uint8Array;
}

export interface MapInfo {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly wrapsX: boolean;
  /** Bots suggested for a game that fills the map without crowding it. */
  readonly suggestedBots: number;
}

interface GeneratedMap extends MapInfo {
  readonly seed: number;
  readonly seeds: number;
  readonly landShare: number;
}

/**
 * Generated test maps. They stand in for the maps built from open data and
 * are generated identically on every client from their seed.
 */
const GENERATED: readonly GeneratedMap[] = [
  {
    id: "continents",
    width: 512,
    height: 256,
    wrapsX: true,
    suggestedBots: 12,
    seed: 2026,
    seeds: 12,
    landShare: 0.35,
  },
  {
    id: "pangaea",
    width: 384,
    height: 192,
    wrapsX: true,
    suggestedBots: 8,
    seed: 7,
    seeds: 3,
    landShare: 0.45,
  },
  {
    id: "skirmish",
    width: 192,
    height: 96,
    wrapsX: false,
    suggestedBots: 3,
    seed: 5,
    seeds: 2,
    landShare: 0.5,
  },
];

export const MAPS: readonly MapInfo[] = GENERATED;

export const DEFAULT_MAP = "continents";

export function findMap(id: string): MapInfo | undefined {
  return GENERATED.find((map) => map.id === id);
}

export function loadMap(id: string): MapData {
  const map = GENERATED.find((candidate) => candidate.id === id);
  if (!map) throw new RangeError(`unknown map ${id}`);
  const grid = new WorldGrid(map.width, map.height, { wrapsX: map.wrapsX });
  const land = keepLargestLandmass(
    grid,
    generateLand(grid, map.seed, { seeds: map.seeds, landShare: map.landShare }),
  );
  const kinds = land.map((value) => (value === 1 ? TileKind.Plains : TileKind.Water));
  return { id: map.id, width: map.width, height: map.height, wrapsX: map.wrapsX, kinds };
}

/**
 * Drops every landmass but the largest. Until ships exist (R-ATTACK-09),
 * players on separate continents could never reach each other.
 */
function keepLargestLandmass(grid: WorldGrid, land: Uint8Array): Uint8Array {
  const component = new Int32Array(grid.size).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < grid.size; start++) {
    if (land[start] !== 1 || component[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    component[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const tile = stack.pop() as number;
      size++;
      for (const next of grid.neighbors(tile)) {
        if (land[next] === 1 && component[next] === -1) {
          component[next] = id;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  const largest = sizes.indexOf(Math.max(...sizes));
  return land.map((value, tile) => (value === 1 && component[tile] === largest ? 1 : 0));
}
