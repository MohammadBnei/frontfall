import type { Topology } from "../topology.ts";

/**
 * Breadth-first fill that gives up once more than `limit` tiles match. It
 * answers questions such as "is this pocket enclosed?", where only small
 * regions matter and an unbounded fill could walk the whole map every tick.
 *
 * Visited tiles are stamped with a generation number instead of being cleared,
 * so starting a fill costs nothing; the stamps are wiped once every 65,535
 * fills. The queue grows up to the largest limit used and is then reused.
 */
export class BoundedFloodFill {
  private readonly stamps: Uint16Array;
  private stamp = 0;
  private queue = new Int32Array(64);
  private readonly around = new Int32Array(4);
  private found = 0;

  constructor(readonly grid: Topology) {
    this.stamps = new Uint16Array(grid.size);
  }

  /**
   * Fills from `start` through orthogonal neighbours accepted by `accepts`.
   * Returns how many tiles were reached, or -1 if there are more than `limit`.
   */
  fill(start: number, accepts: (tile: number) => boolean, limit: number): number {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`invalid fill limit ${String(limit)}`);
    }
    this.found = 0;
    if (!accepts(start)) return 0;
    this.nextStamp();
    const { stamps, stamp, around, grid } = this;

    stamps[start] = stamp;
    this.push(0, start, limit);
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const count = grid.neighborsInto(this.queue[head++] as number, around);
      for (let i = 0; i < count; i++) {
        const next = around[i] as number;
        if (stamps[next] === stamp || !accepts(next)) continue;
        if (tail === limit) return -1;
        stamps[next] = stamp;
        this.push(tail++, next, limit);
      }
    }
    this.found = tail;
    return tail;
  }

  /** Tiles reached by the last fill, in visiting order; empty if it gave up. */
  tiles(): Int32Array {
    return this.queue.subarray(0, this.found);
  }

  /** Bytes held by the stamp array and the queue. */
  memoryBytes(): number {
    return this.stamps.byteLength + this.queue.byteLength;
  }

  private push(position: number, tile: number, limit: number): void {
    if (position === this.queue.length) {
      const grown = new Int32Array(Math.min(this.queue.length * 2, limit));
      grown.set(this.queue);
      this.queue = grown;
    }
    this.queue[position] = tile;
  }

  private nextStamp(): void {
    if (this.stamp === 0xffff) {
      this.stamps.fill(0);
      this.stamp = 0;
    }
    this.stamp++;
  }
}
