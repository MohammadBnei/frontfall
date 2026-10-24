import type { Game } from "./game.ts";
import { TileKind } from "./terrain.ts";

/**
 * Routes by sea between ports (#44). When a port opens, one search from it
 * finds every open port within B-TRADE-RANGE of sea and the shortest route
 * to each; the route between two ports is the one found from the newer of
 * the two. Water never changes, so a route stays valid until one of its
 * ports closes. A route lists the water tiles from the side of its first
 * port to the side of its second, neither coast included; ships share the
 * arrays and never write to them.
 */
export class SeaRoutes {
  private readonly game: Game;
  private readonly range: number;
  private readonly size: number;
  /** Routes by `from * size + to`, both ways. */
  private readonly routes = new Map<number, Int32Array>();
  /** Open ports, and the ports each one has routes to, in the order they opened. */
  private readonly partners = new Map<number, number[]>();
  private readonly search: SeaSearch;

  constructor(game: Game, range: number) {
    this.game = game;
    this.range = range;
    this.size = game.terrain.topology.size;
    this.search = new SeaSearch(game, range);
  }

  /** The route from port `from` to port `to`, or undefined when they are out of reach of each other. */
  route(from: number, to: number): Int32Array | undefined {
    return this.routes.get(from * this.size + to);
  }

  /** Ports with a route from this one, in the order they opened. */
  partnersOf(port: number): readonly number[] {
    return this.partners.get(port) ?? [];
  }

  /** Open ports, in the order they opened. */
  openPorts(): number[] {
    return [...this.partners.keys()];
  }

  isOpen(port: number): boolean {
    return this.partners.has(port);
  }

  /** Opens a port: one search over the sea around it gives its routes to every open port in reach. */
  open(port: number): void {
    if (this.partners.has(port)) return;
    // No sea route is shorter than the distance between two ports: skip the search when none is in range.
    const { topology } = this.game.terrain;
    const others = [...this.partners.keys()].filter(
      (other) => topology.distance(port, other) <= this.range + 1,
    );
    const mine: number[] = [];
    this.partners.set(port, mine);
    if (others.length === 0) return;
    this.search.from(port);
    for (const other of others) {
      const path = this.search.pathTo(other);
      if (!path) continue;
      this.routes.set(other * this.size + port, path);
      this.routes.set(port * this.size + other, path.slice().reverse());
      mine.push(other);
      this.partners.get(other)?.push(port);
    }
  }

  /** Closes a port: its routes go with it. */
  close(port: number): void {
    const mine = this.partners.get(port);
    if (!mine) return;
    this.partners.delete(port);
    for (const other of mine) {
      this.routes.delete(other * this.size + port);
      this.routes.delete(port * this.size + other);
      const theirs = this.partners.get(other);
      if (theirs) theirs.splice(theirs.indexOf(port), 1);
    }
  }
}

/**
 * Breadth-first search over water tiles, in integers and in a fixed order,
 * out to a range. One 32-bit mark per tile holds the search it belongs to
 * (high 16 bits) and the distance from the start (low 16 bits).
 */
class SeaSearch {
  private readonly game: Game;
  private readonly range: number;
  /** Allocated on the first search: most games never open two ports. */
  private marks = new Uint32Array(0);
  private generation = 0;
  private queue = new Int32Array(1024);
  private readonly around = new Int32Array(4);
  private readonly step = new Int32Array(4);

  constructor(game: Game, range: number) {
    this.game = game;
    this.range = Math.min(range, 0xffff);
  }

  /** Marks the sea around `port` with each tile's distance from the port's shore. */
  from(port: number): void {
    const { topology } = this.game.terrain;
    if (this.marks.length === 0) this.marks = new Uint32Array(topology.size);
    if (this.generation === 0xffff) {
      this.marks.fill(0);
      this.generation = 0;
    }
    this.generation++;
    let tail = 0;
    const count = topology.neighborsInto(port, this.around);
    for (let i = 0; i < count; i++) {
      const water = this.around[i] as number;
      if (!this.isWater(water) || this.seen(water)) continue;
      this.mark(water, 0);
      tail = this.enqueue(tail, water);
    }
    let head = 0;
    while (head < tail) {
      const water = this.queue[head++] as number;
      const distance = this.distance(water) + 1;
      if (distance >= this.range) continue;
      const next = topology.neighborsInto(water, this.around);
      for (let i = 0; i < next; i++) {
        const tile = this.around[i] as number;
        if (!this.isWater(tile) || this.seen(tile)) continue;
        this.mark(tile, distance);
        tail = this.enqueue(tail, tile);
      }
    }
  }

  /**
   * The route from `port` to the start of the last search: from the port's
   * nearest water tile, the first in neighbour order on a tie, down the
   * distances, taking the first neighbour one step closer each time.
   */
  pathTo(port: number): Int32Array | undefined {
    const { topology } = this.game.terrain;
    let start = -1;
    const count = topology.neighborsInto(port, this.around);
    for (let i = 0; i < count; i++) {
      const water = this.around[i] as number;
      if (!this.isWater(water) || !this.seen(water)) continue;
      if (start < 0 || this.distance(water) < this.distance(start)) start = water;
    }
    if (start < 0) return undefined;
    const path = new Int32Array(this.distance(start) + 1);
    let water = start;
    for (let i = 0; i < path.length; i++) {
      path[i] = water;
      const want = this.distance(water) - 1;
      const next = topology.neighborsInto(water, this.step);
      for (let n = 0; n < next; n++) {
        const tile = this.step[n] as number;
        if (this.isWater(tile) && this.seen(tile) && this.distance(tile) === want) {
          water = tile;
          break;
        }
      }
    }
    return path;
  }

  private isWater(tile: number): boolean {
    return this.game.terrain.kinds[tile] === TileKind.Water;
  }

  private seen(tile: number): boolean {
    return (this.marks[tile] as number) >>> 16 === this.generation;
  }

  private mark(tile: number, distance: number): void {
    this.marks[tile] = ((this.generation << 16) | distance) >>> 0;
  }

  private distance(tile: number): number {
    return (this.marks[tile] as number) & 0xffff;
  }

  private enqueue(tail: number, tile: number): number {
    if (tail === this.queue.length) {
      const grown = new Int32Array(this.queue.length * 2);
      grown.set(this.queue);
      this.queue = grown;
    }
    this.queue[tail] = tile;
    return tail + 1;
  }
}
