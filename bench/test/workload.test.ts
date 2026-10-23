import { describe, expect, it } from "vitest";
import { ExpansionWorkload, type WorkloadOptions } from "../engine/workload.ts";

const options: WorkloadOptions = {
  width: 256,
  height: 128,
  players: 8,
  capturesPerTick: 200,
  enclosureChecks: 16,
  enclosureLimit: 64,
  seed: 1,
};

function run(seed: number): number {
  const workload = new ExpansionWorkload({ ...options, seed });
  for (let i = 0; i < 50; i++) workload.tick();
  return workload.digest();
}

describe("ExpansionWorkload", () => {
  it("is deterministic, so benchmark runs can be compared", () => {
    expect(run(1)).toBe(run(1));
    expect(run(1)).not.toBe(run(2));
  });

  it("only takes land and keeps tile counts consistent", () => {
    const workload = new ExpansionWorkload(options);
    let captured = 0;
    for (let i = 0; i < 30; i++) {
      const result = workload.tick();
      captured += result.captured + result.annexed;
    }
    expect(captured).toBeGreaterThan(0);
    const { territory, land, grid } = workload;
    let owned = 0;
    for (let tile = 0; tile < grid.size; tile++) {
      if (territory.owners[tile] === 0) continue;
      owned++;
      expect(land[tile]).toBe(1);
    }
    let counted = 0;
    for (let player = 1; player <= options.players; player++)
      counted += territory.tileCount(player);
    expect(counted).toBe(owned);
  });
});
