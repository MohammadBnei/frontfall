import type { Topology } from "./topology.ts";

export interface WorldGridOptions {
  /** True (the default) for a cylinder that wraps east-west, false for a flat map with four edges. */
  wrapsX?: boolean;
}

/**
 * Rectangular tile grid, in either of the two shapes of the rules (R-MAP-03):
 * a cylinder that wraps east-west, or a flat map. North and south are always
 * hard edges. Rendering it on a globe later changes the projection, not this.
 */
export class WorldGrid implements Topology {
  readonly size: number;
  readonly wrapsX: boolean;

  constructor(
    readonly width: number,
    readonly height: number,
    options: WorldGridOptions = {},
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`invalid grid size ${String(width)}x${String(height)}`);
    }
    this.size = width * height;
    this.wrapsX = options.wrapsX ?? true;
  }

  /** Brings any column back into [0, width). */
  wrapX(x: number): number {
    return ((x % this.width) + this.width) % this.width;
  }

  index(x: number, y: number): number {
    if (y < 0 || y >= this.height) {
      throw new RangeError(`row ${String(y)} is outside the map`);
    }
    if (!this.wrapsX && (x < 0 || x >= this.width)) {
      throw new RangeError(`column ${String(x)} is outside the map`);
    }
    return y * this.width + this.wrapX(x);
  }

  x(tile: number): number {
    return tile % this.width;
  }

  y(tile: number): number {
    return Math.floor(tile / this.width);
  }

  neighbors(tile: number): number[] {
    const out = new Int32Array(4);
    return Array.from(out.subarray(0, this.neighborsInto(tile, out)));
  }

  neighborsInto(tile: number, out: Int32Array): number {
    const width = this.width;
    const x = tile % width;
    const rowStart = tile - x;
    let count = 0;
    if (rowStart > 0) out[count++] = tile - width;
    if (x < width - 1) out[count++] = tile + 1;
    else if (this.wrapsX && width > 1) out[count++] = rowStart;
    if (x > 0) {
      // On a two-column cylinder, west and east are the same tile.
      if (!(this.wrapsX && width === 2)) out[count++] = tile - 1;
    } else if (this.wrapsX && width > 2) {
      out[count++] = rowStart + width - 1;
    }
    if (rowStart < this.size - width) out[count++] = tile + width;
    return count;
  }

  distance(a: number, b: number): number {
    const dx = Math.abs(this.x(a) - this.x(b));
    return (this.wrapsX ? Math.min(dx, this.width - dx) : dx) + Math.abs(this.y(a) - this.y(b));
  }

  tilesWithin(center: number, radius: number): number[] {
    if (!Number.isInteger(radius) || radius < 0) {
      throw new RangeError(`invalid radius ${String(radius)}`);
    }
    const cx = this.x(center);
    const cy = this.y(center);
    const tiles: number[] = [];
    for (let y = Math.max(0, cy - radius); y <= Math.min(this.height - 1, cy + radius); y++) {
      const reach = radius - Math.abs(y - cy);
      if (this.wrapsX && 2 * reach + 1 >= this.width) {
        // The row is covered all the way round: list each column once.
        for (let x = 0; x < this.width; x++) tiles.push(y * this.width + x);
        continue;
      }
      const columns: number[] = [];
      for (let x = cx - reach; x <= cx + reach; x++) {
        if (this.wrapsX) columns.push(this.wrapX(x));
        else if (x >= 0 && x < this.width) columns.push(x);
      }
      columns.sort((p, q) => p - q);
      for (const x of columns) tiles.push(y * this.width + x);
    }
    return tiles;
  }

  toLatLon(tile: number): { lat: number; lon: number } {
    return {
      lat: 90 - ((this.y(tile) + 0.5) * 180) / this.height,
      lon: -180 + ((this.x(tile) + 0.5) * 360) / this.width,
    };
  }
}
