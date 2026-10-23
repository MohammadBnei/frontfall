import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadMap, type MapDescription } from "@frontfall/engine";
import { summarize } from "../engine/stats.ts";
import { Simulation } from "./simulation.ts";

const { values } = parseArgs({
  // `pnpm sim -- --players 8` forwards the separator too.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    // A published map by id (apps/client/public/maps), instead of a generated one.
    map: { type: "string" },
    width: { type: "string", default: "512" },
    height: { type: "string", default: "256" },
    players: { type: "string", default: "16" },
    seed: { type: "string", default: "2026" },
    ticks: { type: "string", default: "6000" },
    interval: { type: "string", default: "20" },
    // Tick p95 in milliseconds above which the run fails, for CI.
    budget: { type: "string" },
  },
});

const integer = (name: keyof typeof values): number => {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--${name} must be a positive integer`);
    process.exit(2);
  }
  return value;
};

function publishedMap(id: string) {
  const maps = new URL("../../apps/client/public/maps/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL(`${id}.json`, maps), "utf8")) as MapDescription;
  return loadMap(readFileSync(new URL(`${id}.bin`, maps)), manifest).terrain;
}

const budget = values.budget === undefined ? undefined : Number(values.budget);
if (budget !== undefined && !(budget > 0)) {
  console.error("--budget must be a positive number of milliseconds");
  process.exit(2);
}
const ticks = integer("ticks");
const setupStart = performance.now();
const terrain = values.map === undefined ? undefined : publishedMap(values.map);
const sim = new Simulation({
  ...(terrain ? { terrain } : {}),
  width: integer("width"),
  height: integer("height"),
  players: integer("players"),
  seed: integer("seed"),
  orderInterval: integer("interval"),
});
const { game } = sim;
console.log(
  `${String(game.terrain.topology.width)}x${String(game.terrain.topology.height)}, ` +
    `${String(game.players().length)} players, set up in ${(performance.now() - setupStart).toFixed(1)} ms`,
);

const durations: number[] = [];
let orders = 0;
while (game.tick < ticks && game.winner === undefined) {
  const start = performance.now();
  orders += sim.step();
  durations.push(performance.now() - start);
  if (game.tick % 100 === 0) {
    const alive = game.players().filter((p) => p.alive).length;
    console.log(
      `tick ${String(game.tick)}: ${String(alive)} alive, ${String(game.attacks.length)} attacks, ` +
        `p95 ${summarize(durations.slice(-200)).p95.toFixed(2)} ms`,
    );
  }
}

const tick = summarize(durations);
const standings = game
  .players()
  .map((p) => ({ name: p.name, tiles: game.territory.tileCount(p.id), troops: p.troops }))
  .sort((a, b) => b.tiles - a.tiles)
  .slice(0, 5);
const winner = game.winner === undefined ? "none" : (game.player(game.winner)?.name ?? "?");

console.log(`\n${String(game.tick)} ticks, ${String(orders)} orders, winner: ${winner}`);
console.log(
  `tick ms: p50 ${tick.p50.toFixed(2)}, p95 ${tick.p95.toFixed(2)}, max ${tick.max.toFixed(2)}`,
);
console.table(standings);
console.log(`state hash: ${game.hash().toString(16).padStart(8, "0")}`);

if (budget !== undefined && tick.p95 > budget) {
  console.error(`tick p95 ${tick.p95.toFixed(2)} ms is over the ${String(budget)} ms budget`);
  process.exit(1);
}
