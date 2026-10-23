import { TileKind } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import { generateTerrain, Simulation } from "../sim/simulation.ts";

const options = { width: 192, height: 96, players: 6, seed: 7, orderInterval: 10 };

describe("generateTerrain", () => {
  it("makes land and sea, closed off at the poles", () => {
    const terrain = generateTerrain(96, 48, 7);
    const kinds = Array.from(terrain.kinds);
    expect(kinds).toContain(TileKind.Water);
    expect(kinds).toContain(TileKind.Plains);
    for (let x = 0; x < 96; x++) expect(terrain.kind(x)).toBe(TileKind.Impassable);
  });
});

describe("Simulation", () => {
  it("plays the same game twice from the same seed", () => {
    const run = (): number => {
      const sim = new Simulation(options);
      for (let i = 0; i < 600; i++) sim.step();
      return sim.game.hash();
    };
    expect(run()).toBe(run());
  });

  it("sends orders that take land", () => {
    const sim = new Simulation(options);
    const owned = (): number =>
      sim.game.players().reduce((sum, p) => sum + sim.game.territory.tileCount(p.id), 0);
    while (sim.game.phase === "spawn") sim.step();
    const atStart = owned();
    let orders = 0;
    for (let i = 0; i < 400; i++) orders += sim.step();
    expect(orders).toBeGreaterThan(0);
    expect(owned()).toBeGreaterThan(atStart * 2);
  });
});
