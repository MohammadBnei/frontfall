/** Where a player's name goes: the tile of their land farthest from its edge. */
export interface LabelAnchor {
  readonly player: number;
  readonly tile: number;
  /** Steps from that tile to the nearest tile that is not theirs: how big a name fits. */
  readonly depth: number;
}

/**
 * The tiles a name can sit on, kept from one search to the next: runs of
 * tiles that can be owned, row by row, and room for the distance transform.
 * On World a third of the tiles are land, so the search skips the rest.
 */
export interface LabelSpace {
  readonly width: number;
  /** Runs as first tile and tile past the last, two numbers each, in row order. */
  readonly runs: Int32Array;
  /** Index of the first run of each row, and one past the last row's. */
  readonly rowRuns: Int32Array;
  readonly depth: Uint16Array;
}

/** The space of a map whose tiles for which `ownable` holds; every tile without it. */
export function labelSpace(
  width: number,
  height: number,
  ownable: (tile: number) => boolean = () => true,
): LabelSpace {
  const runs: number[] = [];
  const rowRuns = new Int32Array(height + 1);
  for (let y = 0; y < height; y++) {
    rowRuns[y] = runs.length / 2;
    const row = y * width;
    let x = 0;
    while (x < width) {
      while (x < width && !ownable(row + x)) x++;
      if (x === width) break;
      const first = x;
      while (x < width && ownable(row + x)) x++;
      runs.push(row + first, row + x);
    }
  }
  rowRuns[height] = runs.length / 2;
  return {
    width,
    runs: Int32Array.from(runs),
    rowRuns,
    depth: new Uint16Array(width * height),
  };
}

/**
 * The deepest tile of every player's land, by a two-pass city-block distance
 * transform: a name placed there sits inside the land whatever its shape,
 * crescents and rings included, and the depth says how large it can be.
 * Map edges count as borders, also on a map that wraps, which only matters
 * for land that straddles the seam; so do tiles outside the space, which
 * nobody owns. Ties go to the first tile in row order.
 */
export function labelAnchors(
  owners: Uint16Array,
  width: number,
  maxOwner: number,
  space: LabelSpace = labelSpace(width, owners.length / width),
): LabelAnchor[] {
  const height = owners.length / width;
  const { runs, rowRuns, depth } = space;
  // From the north-west: each tile is one step deeper than its western and northern neighbours.
  for (let y = 0; y < height; y++) {
    for (let run = rowRuns[y] as number; run < (rowRuns[y + 1] as number); run++) {
      const first = runs[run * 2] as number;
      const end = runs[run * 2 + 1] as number;
      for (let tile = first; tile < end; tile++) {
        const owner = owners[tile] as number;
        if (owner === 0) continue;
        // A tile next to another owner, or to the map edge, is one step deep.
        const west =
          tile > first && owners[tile - 1] === owner ? (depth[tile - 1] as number) + 1 : 1;
        const north =
          y > 0 && owners[tile - width] === owner ? (depth[tile - width] as number) + 1 : 1;
        depth[tile] = Math.min(west, north);
      }
    }
  }
  // Back from the south-east, keeping the shorter of both ways.
  const best = new Int32Array(maxOwner + 1).fill(-1);
  const bestDepth = new Uint16Array(maxOwner + 1);
  for (let y = height - 1; y >= 0; y--) {
    for (let run = (rowRuns[y + 1] as number) - 1; run >= (rowRuns[y] as number); run--) {
      const first = runs[run * 2] as number;
      const last = (runs[run * 2 + 1] as number) - 1;
      for (let tile = last; tile >= first; tile--) {
        const owner = owners[tile] as number;
        if (owner === 0) continue;
        const east =
          tile < last && owners[tile + 1] === owner ? (depth[tile + 1] as number) + 1 : 1;
        const south =
          y < height - 1 && owners[tile + width] === owner
            ? (depth[tile + width] as number) + 1
            : 1;
        const d = Math.min(depth[tile] as number, east, south);
        depth[tile] = d;
        // Walking backwards, ">=" keeps the first tile in row order on ties.
        if (owner <= maxOwner && d >= (bestDepth[owner] as number)) {
          bestDepth[owner] = d;
          best[owner] = tile;
        }
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
