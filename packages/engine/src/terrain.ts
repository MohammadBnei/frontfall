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
  private landmasses: Int32Array | undefined;
  private readonly around = new Int32Array(4);

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

  /** Ownable land next to water: where transport ships land and leave (R-UNIT-02). */
  isCoast(tile: number): boolean {
    if (!this.isOwnable(tile)) return false;
    const count = this.topology.neighborsInto(tile, this.around);
    for (let i = 0; i < count; i++) {
      if (this.kinds[this.around[i] as number] === TileKind.Water) return true;
    }
    return false;
  }

  /**
   * Number of the land mass a tile belongs to: ownable tiles reachable from
   * one another over ownable land share a number, counted from 0 in tile
   * order. Water and impassable tiles give -1. Computed once, on first use.
   */
  landmassOf(tile: number): number {
    this.landmasses ??= this.findLandmasses();
    return this.landmasses[tile] as number;
  }

  private findLandmasses(): Int32Array {
    const { topology } = this;
    const masses = new Int32Array(topology.size).fill(-1);
    const queue = new Int32Array(topology.size);
    const around = new Int32Array(4);
    let next = 0;
    for (let start = 0; start < topology.size; start++) {
      if (masses[start] !== -1 || !this.isOwnable(start)) continue;
      masses[start] = next;
      queue[0] = start;
      let head = 0;
      let tail = 1;
      while (head < tail) {
        const count = topology.neighborsInto(queue[head++] as number, around);
        for (let i = 0; i < count; i++) {
          const tile = around[i] as number;
          if (masses[tile] !== -1 || !this.isOwnable(tile)) continue;
          masses[tile] = next;
          queue[tail++] = tile;
        }
      }
      next++;
    }
    return masses;
  }
}
