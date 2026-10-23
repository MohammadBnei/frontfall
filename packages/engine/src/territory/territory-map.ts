import type { Topology } from "../topology.ts";

/** Owner of tiles that nobody holds. Player ids start at 1. */
export const NEUTRAL = 0;

/** Highest player id that still fits in the 16-bit owner array. */
export const MAX_PLAYER_ID = 0xffff;

const NOT_A_BORDER = -1;

/**
 * Who owns every tile, kept in flat typed arrays: about 6 bytes per tile and
 * no allocation per ownership change once the border lists have grown.
 *
 * A border tile is an owned tile with at least one neighbour held by someone
 * else, neutral tiles included. Every player's border tiles live in an
 * unordered list that is patched on each change, so expansion and attacks find
 * their front line without scanning the map. The list order only depends on
 * the sequence of changes, which keeps picks by index deterministic.
 *
 * Changed tiles are also logged, for the renderer and for the worker that
 * forwards them to it. The log has a fixed capacity; past it, consumers are
 * told to redraw everything instead.
 */
export class TerritoryMap {
  /** Owner of each tile, indexed like the grid. Write through setOwner only. */
  readonly owners: Uint16Array;
  private readonly borderSlots: Int32Array;
  private readonly borderLists: Int32Array[];
  private readonly borderSizes: Int32Array;
  private readonly tileCounts: Int32Array;
  private readonly around = new Int32Array(4);
  private readonly aroundNeighbor = new Int32Array(4);
  private readonly changeLog: Int32Array;
  private changeCount = 0;
  private overflowed = false;

  constructor(
    readonly grid: Topology,
    readonly maxPlayers: number,
    changeLogCapacity = 1 << 16,
  ) {
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > MAX_PLAYER_ID) {
      throw new RangeError(`invalid player limit ${String(maxPlayers)}`);
    }
    if (!Number.isInteger(changeLogCapacity) || changeLogCapacity < 1) {
      throw new RangeError(`invalid change log capacity ${String(changeLogCapacity)}`);
    }
    this.owners = new Uint16Array(grid.size);
    this.borderSlots = new Int32Array(grid.size).fill(NOT_A_BORDER);
    this.borderLists = Array.from({ length: maxPlayers + 1 }, () => new Int32Array(16));
    this.borderSizes = new Int32Array(maxPlayers + 1);
    this.tileCounts = new Int32Array(maxPlayers + 1);
    this.tileCounts[NEUTRAL] = grid.size;
    this.changeLog = new Int32Array(changeLogCapacity);
  }

  ownerOf(tile: number): number {
    return this.owners[this.checkTile(tile)] as number;
  }

  tileCount(player: number): number {
    return this.tileCounts[this.checkPlayer(player)] as number;
  }

  isBorder(tile: number): boolean {
    return this.borderSlots[this.checkTile(tile)] !== NOT_A_BORDER;
  }

  borderCount(player: number): number {
    return player === NEUTRAL ? 0 : (this.borderSizes[this.checkPlayer(player)] as number);
  }

  /** The i-th border tile of a player, for 0 <= i < borderCount(player). */
  borderTile(player: number, i: number): number {
    if (!Number.isInteger(i) || i < 0 || i >= this.borderCount(player)) {
      throw new RangeError(`border index ${String(i)} is out of range`);
    }
    return (this.borderLists[player] as Int32Array)[i] as number;
  }

  setOwner(tile: number, player: number): void {
    this.checkTile(tile);
    this.checkPlayer(player);
    const previous = this.owners[tile] as number;
    if (previous === player) return;

    if (previous !== NEUTRAL) this.removeBorder(tile, previous);
    this.owners[tile] = player;
    this.tileCounts[previous] = (this.tileCounts[previous] as number) - 1;
    this.tileCounts[player] = (this.tileCounts[player] as number) + 1;
    this.logChange(tile);

    // Only this tile and its direct neighbours can gain or lose border status.
    this.refreshBorder(tile);
    const around = this.around;
    const count = this.grid.neighborsInto(tile, around);
    for (let i = 0; i < count; i++) this.refreshBorder(around[i] as number);
  }

  /** Tiles changed since the last clearChanges(), possibly repeated. */
  changes(): Int32Array {
    return this.changeLog.subarray(0, this.changeCount);
  }

  /** True when more tiles changed than the log holds: redraw the whole map. */
  get changesOverflowed(): boolean {
    return this.overflowed;
  }

  clearChanges(): void {
    this.changeCount = 0;
    this.overflowed = false;
  }

  /** Bytes held by the typed arrays of this map. */
  memoryBytes(): number {
    let total = this.owners.byteLength + this.borderSlots.byteLength;
    total += this.borderSizes.byteLength + this.tileCounts.byteLength + this.changeLog.byteLength;
    for (const list of this.borderLists) total += list.byteLength;
    return total;
  }

  private refreshBorder(tile: number): void {
    const owner = this.owners[tile] as number;
    const wanted = owner !== NEUTRAL && this.touchesOtherOwner(tile, owner);
    const listed = this.borderSlots[tile] !== NOT_A_BORDER;
    if (wanted === listed) return;
    if (wanted) this.addBorder(tile, owner);
    else this.removeBorder(tile, owner);
  }

  private touchesOtherOwner(tile: number, owner: number): boolean {
    const around = this.aroundNeighbor;
    const count = this.grid.neighborsInto(tile, around);
    for (let i = 0; i < count; i++) {
      if (this.owners[around[i] as number] !== owner) return true;
    }
    return false;
  }

  private addBorder(tile: number, owner: number): void {
    const size = this.borderSizes[owner] as number;
    let list = this.borderLists[owner] as Int32Array;
    if (size === list.length) {
      const grown = new Int32Array(list.length * 2);
      grown.set(list);
      this.borderLists[owner] = list = grown;
    }
    list[size] = tile;
    this.borderSlots[tile] = size;
    this.borderSizes[owner] = size + 1;
  }

  private removeBorder(tile: number, owner: number): void {
    const slot = this.borderSlots[tile] as number;
    if (slot === NOT_A_BORDER) return;
    const list = this.borderLists[owner] as Int32Array;
    const last = (this.borderSizes[owner] as number) - 1;
    const moved = list[last] as number;
    list[slot] = moved;
    this.borderSlots[moved] = slot;
    this.borderSlots[tile] = NOT_A_BORDER;
    this.borderSizes[owner] = last;
  }

  private logChange(tile: number): void {
    if (this.changeCount < this.changeLog.length) this.changeLog[this.changeCount++] = tile;
    else this.overflowed = true;
  }

  private checkTile(tile: number): number {
    if (!Number.isInteger(tile) || tile < 0 || tile >= this.grid.size) {
      throw new RangeError(`tile ${String(tile)} is outside the map`);
    }
    return tile;
  }

  private checkPlayer(player: number): number {
    if (!Number.isInteger(player) || player < 0 || player > this.maxPlayers) {
      throw new RangeError(`unknown player ${String(player)}`);
    }
    return player;
  }
}
