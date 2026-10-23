import { BoundedFloodFill, NEUTRAL, Random, TerritoryMap, WorldGrid } from "@frontfall/engine";

export interface WorkloadOptions {
  readonly width: number;
  readonly height: number;
  readonly players: number;
  /** Tiles changing hands per tick, spread evenly over the players. */
  readonly capturesPerTick: number;
  /** Captured tiles per tick whose surroundings are checked for enclosed pockets. */
  readonly enclosureChecks: number;
  /** Largest pocket that gets annexed; bigger regions stop the fill early. */
  readonly enclosureLimit: number;
  readonly seed: number;
}

export interface TickResult {
  readonly captured: number;
  readonly annexed: number;
}

/**
 * Stand-in for the expansion phase of a tick, built only from engine data
 * structures: every player pushes its front line into neutral or enemy land,
 * then small pockets cut off by the new tiles are annexed. Real game rules
 * will replace it; the access pattern (random border picks, ownership
 * changes, bounded fills) is the one they are expected to share.
 */
export class ExpansionWorkload {
  readonly grid: WorldGrid;
  readonly territory: TerritoryMap;
  readonly land: Uint8Array;
  private readonly fill: BoundedFloodFill;
  private readonly random: Random;
  private readonly around = new Int32Array(4);
  private readonly aroundCapture = new Int32Array(4);
  private readonly recent: Int32Array;
  private recentCount = 0;

  constructor(readonly options: WorkloadOptions) {
    this.grid = new WorldGrid(options.width, options.height);
    this.territory = new TerritoryMap(this.grid, options.players);
    this.fill = new BoundedFloodFill(this.grid);
    this.random = new Random(options.seed);
    this.land = generateBlockyLand(this.grid, this.random);
    this.recent = new Int32Array(Math.max(1, options.enclosureChecks));
    this.spawnPlayers();
    this.territory.clearChanges();
  }

  tick(): TickResult {
    const { territory, random, around, land, options } = this;
    const perPlayer = Math.max(1, Math.floor(options.capturesPerTick / options.players));
    let captured = 0;
    this.recentCount = 0;

    for (let player = 1; player <= options.players; player++) {
      for (let attempt = 0; attempt < perPlayer; attempt++) {
        const borders = territory.borderCount(player);
        if (borders === 0) break;
        const from = territory.borderTile(player, random.nextInt(0, borders));
        const count = this.grid.neighborsInto(from, around);
        const offset = random.nextInt(0, count);
        for (let i = 0; i < count; i++) {
          const target = around[(i + offset) % count] as number;
          if (land[target] === 0 || territory.owners[target] === player) continue;
          territory.setOwner(target, player);
          captured++;
          if (this.recentCount < this.recent.length) this.recent[this.recentCount++] = target;
          break;
        }
      }
    }

    let annexed = 0;
    for (let i = 0; i < Math.min(this.recentCount, options.enclosureChecks); i++) {
      annexed += this.annexPocketsAround(this.recent[i] as number);
    }
    return { captured, annexed };
  }

  /** FNV-1a over the owner array: equal digests mean equal simulations. */
  digest(): number {
    let hash = 0x811c9dc5;
    const owners = this.territory.owners;
    for (let i = 0; i < owners.length; i++) {
      hash = Math.imul(hash ^ (owners[i] as number), 0x01000193);
    }
    return hash >>> 0;
  }

  memoryBytes(): number {
    return this.territory.memoryBytes() + this.fill.memoryBytes() + this.land.byteLength;
  }

  private annexPocketsAround(tile: number): number {
    const { territory, fill, land } = this;
    const owner = territory.owners[tile] as number;
    const around = this.aroundCapture;
    const count = this.grid.neighborsInto(tile, around);
    const foreign = (t: number): boolean => land[t] === 1 && territory.owners[t] !== owner;
    let annexed = 0;
    for (let i = 0; i < count; i++) {
      const start = around[i] as number;
      if (!foreign(start)) continue;
      if (fill.fill(start, foreign, this.options.enclosureLimit) <= 0) continue;
      for (const pocket of fill.tiles()) territory.setOwner(pocket, owner);
      annexed += fill.tiles().length;
    }
    return annexed;
  }

  private spawnPlayers(): void {
    const { grid, territory, random, land } = this;
    for (let player = 1; player <= this.options.players; player++) {
      let center: number;
      do center = random.nextInt(0, grid.size);
      while (land[center] === 0 || territory.owners[center] !== NEUTRAL);
      const cx = grid.x(center);
      const cy = grid.y(center);
      for (let dy = -2; dy <= 2; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= grid.height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const tile = grid.index(cx + dx, y);
          if (land[tile] === 1 && territory.owners[tile] === NEUTRAL)
            territory.setOwner(tile, player);
        }
      }
    }
  }
}

/**
 * Continents made of 64x64 blocks with a little noise on the coasts: cheap to
 * build on a 4096x2048 map, and with enough coastline to look like a real one
 * to the border code. Roughly 60 % land.
 */
function generateBlockyLand(grid: WorldGrid, random: Random): Uint8Array {
  const block = 64;
  const columns = Math.ceil(grid.width / block);
  const rows = Math.ceil(grid.height / block);
  const blocks = new Uint8Array(columns * rows);
  for (let i = 0; i < blocks.length; i++) blocks[i] = random.nextInt(0, 10) < 6 ? 1 : 0;

  const land = new Uint8Array(grid.size);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const jitterX = random.nextInt(-3, 4);
      const jitterY = random.nextInt(-3, 4);
      const bx = Math.floor(grid.wrapX(x + jitterX) / block);
      const by = Math.min(rows - 1, Math.max(0, Math.floor((y + jitterY) / block)));
      land[y * grid.width + x] = blocks[by * columns + bx] as number;
    }
  }
  return land;
}
