import type { WorkloadOptions } from "./workload.ts";

export interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly workload: WorkloadOptions;
  /** Untimed ticks first, so territories and border lists reach a realistic size. */
  readonly warmupTicks: number;
  readonly measuredTicks: number;
}

const largest = { width: 4096, height: 2048, enclosureChecks: 64, enclosureLimit: 512, seed: 2026 };

export const scenarios: readonly Scenario[] = [
  {
    name: "reference",
    description: "Largest map, 64 players, steady expansion",
    workload: { ...largest, players: 64, capturesPerTick: 4000 },
    warmupTicks: 300,
    measuredTicks: 300,
  },
  {
    name: "crowded",
    description: "Largest map, 512 players (bots included)",
    workload: { ...largest, players: 512, capturesPerTick: 4000 },
    warmupTicks: 300,
    measuredTicks: 300,
  },
  {
    name: "assault",
    description: "Largest map, 64 players, five times the captures",
    workload: { ...largest, players: 64, capturesPerTick: 20_000 },
    warmupTicks: 100,
    measuredTicks: 300,
  },
  {
    name: "medium",
    description: "2048x1024 map, 32 players",
    workload: { ...largest, width: 2048, height: 1024, players: 32, capturesPerTick: 2000 },
    warmupTicks: 300,
    measuredTicks: 300,
  },
];
