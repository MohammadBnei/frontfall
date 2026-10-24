/** Where a player's name goes: the tile of their land farthest from its edge. */
export interface LabelAnchor {
  readonly player: number;
  readonly tile: number;
  /** Steps from that tile to the nearest tile that is not theirs: how big a name fits. */
  readonly depth: number;
}

/**
 * The deepest tile of every player's land, by a two-pass city-block distance
 * transform: a name placed there sits inside the land whatever its shape,
 * crescents and rings included, and the depth says how large it can be.
 * Map edges count as borders, also on a map that wraps, which only matters
 * for land that straddles the seam. Ties go to the first tile in row order.
 */
export function labelAnchors(
  owners: Uint16Array,
  width: number,
  maxOwner: number,
  depth: Uint16Array = new Uint16Array(owners.length),
): LabelAnchor[] {
  const height = owners.length / width;
  // From the north-west: each tile is one step deeper than its western and northern neighbours.
  for (let y = 0, tile = 0; y < height; y++) {
    for (let x = 0; x < width; x++, tile++) {
      const owner = owners[tile] as number;
      if (owner === 0) {
        depth[tile] = 0;
        continue;
      }
      // A tile next to another owner, or to the map edge, is one step deep.
      const west = x > 0 && owners[tile - 1] === owner ? (depth[tile - 1] as number) + 1 : 1;
      const north =
        y > 0 && owners[tile - width] === owner ? (depth[tile - width] as number) + 1 : 1;
      depth[tile] = Math.min(west, north);
    }
  }
  // Back from the south-east, keeping the shorter of both ways.
  const best = new Int32Array(maxOwner + 1).fill(-1);
  const bestDepth = new Uint16Array(maxOwner + 1);
  for (let y = height - 1, tile = owners.length - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--, tile--) {
      const owner = owners[tile] as number;
      if (owner === 0) continue;
      const east =
        x < width - 1 && owners[tile + 1] === owner ? (depth[tile + 1] as number) + 1 : 1;
      const south =
        y < height - 1 && owners[tile + width] === owner ? (depth[tile + width] as number) + 1 : 1;
      const d = Math.min(depth[tile] as number, east, south);
      depth[tile] = d;
      // Walking backwards, ">=" keeps the first tile in row order on ties.
      if (owner <= maxOwner && d >= (bestDepth[owner] as number)) {
        bestDepth[owner] = d;
        best[owner] = tile;
      }
    }
  }
  const anchors: LabelAnchor[] = [];
  for (let player = 1; player <= maxOwner; player++) {
    const tile = best[player] as number;
    if (tile >= 0) anchors.push({ player, tile, depth: bestDepth[player] as number });
  }
  return anchors;
}
