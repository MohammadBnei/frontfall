import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type * as Engine from "@frontfall/engine";
import { summarize } from "../engine/stats.ts";
import { robustMean } from "./decide.ts";
import { playReference, REFERENCE } from "./reference.ts";

/**
 * One run of the reference game in a process of its own, on the engine found
 * in --engine (a checkout of the repository). Prints one line of JSON.
 */
const { values } = parseArgs({
  options: {
    engine: { type: "string" },
    ticks: { type: "string", default: String(REFERENCE.ticks) },
    players: { type: "string", default: String(REFERENCE.players) },
    slowdown: { type: "string", default: "0" },
  },
});

const repository = new URL("../../", import.meta.url);
const engineUrl =
  values.engine === undefined
    ? new URL("packages/engine/src/index.ts", repository)
    : pathToFileURL(resolve(values.engine, "packages/engine/src/index.ts"));
const engine = (await import(engineUrl.href)) as typeof Engine;

// Always this checkout's map: the gate compares engines, not maps.
const maps = new URL("apps/client/public/maps/", repository);
const manifest = JSON.parse(
  readFileSync(new URL("world.json", maps), "utf8"),
) as Engine.MapDescription;
const { terrain } = engine.loadMap(readFileSync(new URL("world.bin", maps)), manifest);

// Run with --expose-gc: start the game on a clean heap, the same on both sides.
(globalThis as { gc?: () => void }).gc?.();
const result = playReference(engine, terrain, {
  ...REFERENCE,
  ticks: Number(values.ticks),
  players: Number(values.players),
  slowdownPercent: Number(values.slowdown),
});
const tick = summarize(result.durations);
console.log(
  JSON.stringify({
    robust: robustMean(result.durations),
    mean: tick.mean,
    p50: tick.p50,
    p95: tick.p95,
    max: tick.max,
    ticks: result.ticks,
    alive: result.alive,
    cities: result.cities,
    forts: result.forts,
    hash: result.hash,
  }),
);
