import { readFileSync } from "node:fs";
import {
  createGame,
  DEFAULT_BALANCE,
  loadMap,
  seaRoute,
  TurnClock,
  type Game,
  type MapDescription,
} from "@frontfall/engine";
import { describe, expect, it } from "vitest";

const maps = new URL("../../apps/client/public/maps/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("world.json", maps), "utf8")) as MapDescription;
const world = loadMap(readFileSync(new URL("world.bin", maps)), manifest);
const { topology, terrain } = world;

/** The coastal tile closest to a place, so a test can name cities instead of tiles. */
function coastNear(lat: number, lon: number): number {
  const x = Math.floor(((lon + 180) / 360) * topology.width);
  const y = Math.floor(((90 - lat) / 180) * topology.height);
  const near = topology.tilesWithin(topology.index(x, y), 8).filter((t) => terrain.isCoast(t));
  const centre = topology.index(x, y);
  near.sort((a, b) => topology.distance(a, centre) - topology.distance(b, centre) || a - b);
  const coast = near[0];
  if (coast === undefined) throw new Error(`no coast near ${String(lat)}, ${String(lon)}`);
  return coast;
}

function duel(home: number): Game {
  const game = createGame({
    terrain,
    seed: 81,
    players: [
      { id: 1, name: "West" },
      { id: 2, name: "East" },
    ],
    balance: { ...DEFAULT_BALANCE, spawnPhaseTicks: 0 },
  });
  game.territory.setOwner(home, 1);
  return game;
}

/** Whether a route steps over the east-west seam of the map. */
const crossesSeam = (path: Int32Array): boolean =>
  path.some(
    (tile, i) => i > 0 && Math.abs(topology.x(tile) - topology.x(path[i - 1] as number)) > 1,
  );

describe("transport ships on the World map (#81)", () => {
  const lisbon = coastNear(38.7, -9.1);
  const newYork = coastNear(40.7, -74.0);
  const tokyo = coastNear(35.7, 139.7);
  const sanFrancisco = coastNear(37.8, -122.4);

  it("crosses the Atlantic from Lisbon to New York the short way", () => {
    const route = seaRoute(duel(lisbon), 1, newYork);
    expect(route?.from).toBe(lisbon);
    const path = route?.path ?? new Int32Array();
    expect(crossesSeam(path)).toBe(false);
    expect(path.length).toBeLessThan(500);
  });

  it("crosses the Pacific from Tokyo to San Francisco over the seam", () => {
    const route = seaRoute(duel(tokyo), 1, sanFrancisco);
    expect(route?.from).toBe(tokyo);
    const path = route?.path ?? new Int32Array();
    expect(crossesSeam(path)).toBe(true);
    expect(path.length).toBeLessThan(DEFAULT_BALANCE.boatRange);
  });

  it("lands troops on another continent, where they spread inland", () => {
    const game = duel(lisbon);
    const west = game.player(1);
    if (!west) throw new Error("player missing");
    west.troops = 20_000;
    const clock = new TurnClock(game);
    clock.submit(1, { type: "embark", target: newYork, troops: 10_000 });
    clock.advance();
    expect(game.boats).toHaveLength(1);
    while (game.boats.length > 0) clock.advance();
    expect(game.territory.ownerOf(newYork)).toBe(1);
    for (let i = 0; i < 20; i++) clock.advance();
    expect(game.territory.tileCount(1)).toBeGreaterThan(10);
  });
});
