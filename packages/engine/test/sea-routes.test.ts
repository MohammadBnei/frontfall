import { describe, expect, it } from "vitest";
import { createGame } from "../src/create-game.ts";
import { SeaRoutes } from "../src/sea-routes.ts";
import { Terrain, TileKind } from "../src/terrain.ts";
import { WorldGrid } from "../src/world-grid.ts";

/** Water everywhere but the land given as "x,y" keys. */
function mapOf(
  width: number,
  height: number,
  land: (x: number, y: number) => boolean,
  wrapsX = false,
) {
  const grid = new WorldGrid(width, height, { wrapsX });
  const kinds = new Uint8Array(grid.size).fill(TileKind.Water);
  for (let tile = 0; tile < grid.size; tile++) {
    if (land(grid.x(tile), grid.y(tile))) kinds[tile] = TileKind.Plains;
  }
  const game = createGame({ terrain: new Terrain(grid, kinds), seed: 1, players: [] });
  const routes = new SeaRoutes(game, 500);
  /** Opens a port on each tile, in order, and gives the route from the first to the last. */
  const between = (...ports: number[]) => {
    for (const port of ports) routes.open(port);
    return routes.route(ports[0] as number, ports[ports.length - 1] as number);
  };
  return { game, grid, routes, between };
}

function isStep(grid: WorldGrid, a: number, b: number): boolean {
  return grid.distance(a, b) === 1;
}

describe("sea routes (#44)", () => {
  it("finds the shortest way between two coasts, through water only (R-UNIT-01)", () => {
    // Two coasts on columns 0 and 19 of a 20 × 9 sea, with a wall in the middle open at the bottom.
    const { grid, between, game } = mapOf(
      20,
      9,
      (x, y) => x === 0 || x === 19 || (x === 10 && y < 7),
    );
    const from = grid.index(0, 1);
    const to = grid.index(19, 1);
    const route = between(from, to) as Int32Array;
    // From (1, 1): down to row 7 (6 steps), across to column 18 (17), up again (6).
    expect(route.length).toBe(1 + 6 + 17 + 6);
    expect(isStep(grid, from, route[0] as number)).toBe(true);
    expect(isStep(grid, route[route.length - 1] as number, to)).toBe(true);
    for (let i = 1; i < route.length; i++) {
      expect(isStep(grid, route[i - 1] as number, route[i] as number)).toBe(true);
    }
    for (const tile of route) expect(game.terrain.kind(tile)).toBe(TileKind.Water);
  });

  it("takes the short way across the east-west seam", () => {
    const { grid, between } = mapOf(40, 3, (x) => x === 2 || x === 36, true);
    const route = between(grid.index(2, 1), grid.index(36, 1)) as Int32Array;
    // West from x = 2 to x = 37: 1, 0, 39, 38, 37.
    expect([...route].map((t) => grid.x(t))).toEqual([1, 0, 39, 38, 37]);
  });

  it("has no route between coasts of two separate bodies of water", () => {
    const { grid, routes } = mapOf(20, 5, (x) => x === 10 || x === 0 || x === 19);
    for (const x of [0, 19, 10]) routes.open(grid.index(x, 2));
    expect(routes.route(grid.index(0, 2), grid.index(19, 2))).toBeUndefined();
    expect(routes.route(grid.index(0, 2), grid.index(10, 2))).toBeDefined();
    expect(routes.partnersOf(grid.index(19, 2))).toEqual([grid.index(10, 2)]);
  });

  it("reaches no port beyond B-TRADE-RANGE of sea", () => {
    const { grid, game } = mapOf(60, 3, (x) => x === 0 || x === 30 || x === 59);
    const routes = new SeaRoutes(game, 28);
    for (const x of [0, 30, 59]) routes.open(grid.index(x, 1));
    // 29 water tiles from x = 1 to x = 29: one too many for a range of 28.
    expect(routes.partnersOf(grid.index(0, 1))).toEqual([]);
    const wider = new SeaRoutes(game, 29);
    for (const x of [0, 30, 59]) wider.open(grid.index(x, 1));
    expect(wider.partnersOf(grid.index(0, 1))).toEqual([grid.index(30, 1)]);
  });

  it("gives the same route both ways, and drops a port's routes when it closes", () => {
    const { grid, routes, between } = mapOf(30, 5, (x) => x === 0 || x === 15 || x === 29);
    const [a, b, c] = [0, 15, 29].map((x) => grid.index(x, 2)) as [number, number, number];
    const there = between(a, b, c);
    expect(there).toBeUndefined();
    const ab = routes.route(a, b) as Int32Array;
    expect([...(routes.route(b, a) as Int32Array)]).toEqual([...ab].reverse());
    expect(routes.partnersOf(b)).toEqual([a, c]);
    routes.close(b);
    expect(routes.route(a, b)).toBeUndefined();
    expect(routes.partnersOf(a)).toEqual([]);
    expect(routes.isOpen(b)).toBe(false);
    expect(routes.openPorts()).toEqual([a, c]);
  });

  it("finds the same routes for ports opened in the same order", () => {
    const land = (x: number, y: number) => x === 0 || x === 29 || (x % 7 === 3 && y !== x % 5);
    const first = mapOf(30, 12, land);
    const again = mapOf(30, 12, land);
    const ends = [first.grid.index(0, 4), first.grid.index(29, 8)];
    expect([...(again.between(...ends) as Int32Array)]).toEqual([
      ...(first.between(...ends) as Int32Array),
    ]);
  });
});
