import type { Game } from "./game.ts";
import { TileKind } from "./terrain.ts";
import type { Topology } from "./topology.ts";

/**
 * Routes by sea between ports (#44). When a port opens, one search from it
 * finds every open port within B-TRADE-RANGE of sea and the shortest route
 * to each; the route between two ports is the one found from the newer of
 * the two. Water never changes, so a route stays valid until one of its
 * ports closes.
 *
 * One search can walk most of the sea of a large map. With a budget, ports
 * wait in line and `work` searches at most that many water tiles per call,
 * so a search spreads over several ticks instead of stalling one; a port
 * has its routes once its search is over. A route lists the water tiles from the side of its first
 * port to the side of its second, neither coast included.
 *
 * Every port of a sea has a route to every other, so a map with hundreds of
 * ports holds tens of thousands of routes. Each is kept once, packed: its
 * first tile, then each next one as the neighbour it is, two bits a step.
 * `route` unpacks it, the way asked, into an array of its own.
 */
export class SeaRoutes {
  private readonly game: Game;
  private readonly range: number;
  private readonly size: number;
  /** Routes by `from * size + to`, one way only: the other way is the same tiles backwards. */
  private readonly routes = new Map<number, PackedRoute>();
  /** Open ports, and the ports each one has routes to, in the order they opened. */
  private readonly partners = new Map<number, number[]>();
  private readonly search: SeaSearch;
  /** Water tiles searched per call of `work`; without one, a port's search ends as it opens. */
  private readonly budget: number;
  /** Ports opened and still waiting for their routes, the first one being searched. */
  private readonly waiting: number[] = [];
  private searching = -1;

  constructor(game: Game, range: number, budget = Number.POSITIVE_INFINITY) {
    this.game = game;
    this.range = range;
    this.size = game.terrain.topology.size;
    this.search = new SeaSearch(game, range);
    this.budget = budget;
  }

  /** The route from port `from` to port `to`, or undefined when they are out of reach of each other. */
  route(from: number, to: number): Int32Array | undefined {
    const { topology } = this.game.terrain;
    const there = this.routes.get(from * this.size + to);
    if (there) return unpackRoute(topology, there);
    const back = this.routes.get(to * this.size + from);
    return back && unpackRoute(topology, back).reverse();
  }

  /** Water tiles of the route from port `from` to port `to`, or undefined when there is none; unpacks nothing. */
  length(from: number, to: number): number | undefined {
    return (this.routes.get(from * this.size + to) ?? this.routes.get(to * this.size + from))
      ?.length;
  }

  /** Ports with a route from this one, in the order they opened. */
  partnersOf(port: number): readonly number[] {
    return this.partners.get(port) ?? [];
  }

  /** Open ports, in the order they opened, then those waiting for their routes. */
  openPorts(): number[] {
    return [...this.partners.keys(), ...this.waiting];
  }

  isOpen(port: number): boolean {
    return this.partners.has(port);
  }

  /**
   * Opens a port: one search over the sea around it gives its routes to
   * every open port in reach, at once without a budget, else as `work` gets to it.
   */
  open(port: number): void {
    if (this.partners.has(port) || this.waiting.includes(port)) return;
    this.waiting.push(port);
    if (this.budget === Number.POSITIVE_INFINITY) this.work();
  }

  /**
   * What a snapshot keeps: the ports with their routes, in the order they got
   * them, the ports still waiting, and how far the first one's search has gone
   * (-1 when it has not started), so `restore` gets every route at the same tick.
   */
  state(): { ready: number[]; waiting: number[]; searched: number } {
    const searched = this.searching >= 0 ? this.search.searched : -1;
    return { ready: [...this.partners.keys()], waiting: [...this.waiting], searched };
  }

  /** Back to a `state`, in a fresh instance: the routes are searched again, in the same order. */
  restore(ready: readonly number[], waiting: readonly number[], searched: number): void {
    for (const port of ready) {
      this.waiting.push(port);
      this.work(Number.POSITIVE_INFINITY);
    }
    this.waiting.push(...waiting);
    const first = this.waiting[0];
    if (searched >= 0 && first !== undefined) {
      this.search.from(first);
      this.searching = first;
      this.search.advance(searched);
    }
  }

  /** Searches for the waiting ports' routes, oldest first, up to the budget. */
  work(budget = this.budget): void {
    const { topology } = this.game.terrain;
    let left = budget;
    while (this.waiting.length > 0 && left > 0) {
      const port = this.waiting[0] as number;
      if (this.searching !== port) {
        // No sea route is shorter than the distance between two ports: skip the search when none is in range.
        const near = (other: number) =>
          other !== port && topology.distance(port, other) <= this.range + 1;
        if (![...this.partners.keys(), ...this.waiting].some(near)) {
          this.finish(port, false);
          continue;
        }
        this.search.from(port);
        this.searching = port;
      }
      left = this.search.advance(left);
      if (this.search.done) this.finish(port, true);
    }
  }

  /** The search of the first waiting port is over: its routes to every open port in reach. */
  private finish(port: number, searched: boolean): void {
    this.waiting.shift();
    this.searching = -1;
    const { topology } = this.game.terrain;
    const others = [...this.partners.keys()].filter(
      (other) => topology.distance(port, other) <= this.range + 1,
    );
    const mine: number[] = [];
    this.partners.set(port, mine);
    if (!searched) return;
    for (const other of others) {
      const path = this.search.pathTo(other);
      if (!path) continue;
      this.routes.set(other * this.size + port, packRoute(topology, path));
      mine.push(other);
      this.partners.get(other)?.push(port);
    }
  }

  /** Closes a port: its routes go with it. */
  close(port: number): void {
    const waiting = this.waiting.indexOf(port);
    if (waiting >= 0) {
      this.waiting.splice(waiting, 1);
      if (this.searching === port) this.searching = -1;
      return;
    }
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

/** A route of `length` water tiles: the first one, then each next one as its index among the neighbours of the one before. */
export interface PackedRoute {
  readonly first: number;
  readonly length: number;
  /** Two bits a step, four steps a byte, the first step in the low bits. */
  readonly moves: Uint8Array;
}

const neighbours = new Int32Array(4);

/** Packs a path of water tiles each next to the one before, as sea routes are; throws on any other. */
export function packRoute(topology: Topology, path: Int32Array): PackedRoute {
  const moves = new Uint8Array(Math.ceil(Math.max(0, path.length - 1) / 4));
  for (let i = 1; i < path.length; i++) {
    const count = topology.neighborsInto(path[i - 1] as number, neighbours);
    let move = 0;
    while (move < count && neighbours[move] !== path[i]) move++;
    // A route steps from a tile to one of its neighbours, of which a tile has four at most.
    if (move === count || move > 3) throw new Error("a sea route skips a tile");
    moves[(i - 1) >> 2] = ((moves[(i - 1) >> 2] as number) | (move << (((i - 1) & 3) * 2))) & 0xff;
  }
  return { first: path[0] ?? -1, length: path.length, moves };
}

/** The tiles of a packed route; throws on a step to a neighbour the tile does not have, which only damage gives. */
export function unpackRoute(topology: Topology, route: PackedRoute): Int32Array {
  const path = new Int32Array(route.length);
  let tile = route.first;
  for (let i = 0; i < route.length; i++) {
    if (i > 0) {
      const count = topology.neighborsInto(tile, neighbours);
      const move = ((route.moves[(i - 1) >> 2] as number) >> (((i - 1) & 3) * 2)) & 3;
      if (move >= count) throw new Error("a sea route steps off the map");
      tile = neighbours[move] as number;
    }
    path[i] = tile;
  }
  return path;
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
  private head = 0;
  private tail = 0;
  private readonly around = new Int32Array(4);
  private readonly step = new Int32Array(4);

  constructor(game: Game, range: number) {
    this.game = game;
    this.range = Math.min(range, 0xffff);
  }

  /** Whether the search started by `from` has marked all the sea in range. */
  get done(): boolean {
    return this.head >= this.tail;
  }

  /** Water tiles the current search has gone through: what `advance` took of its budgets. */
  get searched(): number {
    return this.head;
  }

  /** Starts marking the sea around `port` with each tile's distance from the port's shore; `advance` goes on. */
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
    this.head = 0;
    this.tail = tail;
  }

  /** Searches up to `budget` more water tiles; gives back what is left of the budget. */
  advance(budget: number): number {
    // A search walks most of the sea of a large map: the loop reads the typed arrays directly.
    const { topology, kinds } = this.game.terrain;
    const { marks, around, range, generation } = this;
    let { head, tail } = this;
    let left = budget;
    while (head < tail && left > 0) {
      left--;
      const water = this.queue[head++] as number;
      const distance = ((marks[water] as number) & 0xffff) + 1;
      if (distance >= range) continue;
      const next = topology.neighborsInto(water, around);
      for (let i = 0; i < next; i++) {
        const tile = around[i] as number;
        if (kinds[tile] !== TileKind.Water || (marks[tile] as number) >>> 16 === generation) {
          continue;
        }
        marks[tile] = ((generation << 16) | distance) >>> 0;
        tail = this.enqueue(tail, tile);
      }
    }
    this.head = head;
    this.tail = tail;
    return left;
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
