import type { Topology } from "./topology.ts";

/** What a tile is made of (R-MAP-01, R-MAP-02). Stored as one byte per tile. */
export const TileKind = {
  Water: 0,
  Plains: 1,
  Hills: 2,
  Mountains: 3,
  Impassable: 4,
} as const;
export type TileKind = (typeof TileKind)[keyof typeof TileKind];

/** Kinds are numbered from 0 without gaps, so a range check validates them. */
const HIGHEST_KIND: number = TileKind.Impassable;

/** Kind of every tile of a map, indexed like its topology. */
export class Terrain {
  readonly topology: Topology;
  readonly kinds: Uint8Array;

  constructor(topology: Topology, kinds: Uint8Array) {
    this.topology = topology;
    this.kinds = kinds;
    if (kinds.length !== topology.size) {
      throw new RangeError(
        `terrain has ${String(kinds.length)} tiles, the map ${String(topology.size)}`,
      );
    }
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i] as number;
      if (kind > HIGHEST_KIND) throw new RangeError(`unknown tile kind ${String(kind)}`);
    }
  }

  kind(tile: number): TileKind {
    return this.kinds[tile] as TileKind;
  }

  /** Land a player can own: anything but water and impassable terrain. */
  isOwnable(tile: number): boolean {
    const kind = this.kinds[tile];
    return kind !== TileKind.Water && kind !== TileKind.Impassable;
  }
}
