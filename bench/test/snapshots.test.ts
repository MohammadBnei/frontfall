import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BALANCE,
  loadMap,
  loadSnapshot,
  readDesyncReport,
  recreateGame,
  saveSnapshot,
  type DesyncReport,
  type Game,
  type MapDescription,
  type Terrain,
} from "@frontfall/engine";

const replays = new URL("../../packages/engine/test/replays/", import.meta.url);
const maps = new URL("../../apps/client/public/maps/", import.meta.url);

/** Ticks a loaded game plays on, checked against the golden hashes. */
const AFTER = 500;

function golden(file: string): { report: DesyncReport; terrain: Terrain } {
  const report = readDesyncReport(JSON.parse(readFileSync(new URL(file, replays), "utf8")));
  const manifest = JSON.parse(
    readFileSync(new URL(`${report.map.id}.json`, maps), "utf8"),
  ) as MapDescription;
  const { terrain } = loadMap(readFileSync(new URL(`${report.map.id}.bin`, maps)), manifest);
  return { report: { ...report, balance: DEFAULT_BALANCE }, terrain };
}

function playTo(game: Game, report: DesyncReport, tick: number): void {
  const turns = new Map(report.turns.map((turn) => [turn.tick, turn.orders]));
  while (game.tick < tick) game.step({ tick: game.tick, orders: turns.get(game.tick) ?? [] });
}

/**
 * Snapshots (#39): a game saved at any tick and loaded into a new one plays
 * on to the same hashes as the game that never stopped. The golden replays
 * pin those hashes, on published maps, with bots, nations and teams.
 */
describe("snapshots of the golden replays", () => {
  const files = readdirSync(replays).filter((file) => file.endsWith(".json"));

  for (const file of files) {
    it(`load ${file} anywhere and play on to its pinned hashes`, () => {
      const { report, terrain } = golden(file);
      const pinned = new Map(report.hashes.map((entry) => [entry.tick, entry.local]));
      const game = recreateGame(report, terrain);
      for (let at = 0; at + AFTER <= report.ticks; at += 700) {
        playTo(game, report, at);
        const bytes = saveSnapshot(game, "test");
        const loaded = loadSnapshot(bytes, "test", () => recreateGame(report, terrain));
        if (!loaded.ok) throw new Error(`${file} at tick ${String(at)}: ${loaded.reason}`);
        const copy = loaded.game;
        // Saved again, the loaded game gives the same bytes.
        expect(saveSnapshot(copy, "test")).toEqual(bytes);
        const turns = new Map(report.turns.map((turn) => [turn.tick, turn.orders]));
        while (copy.tick < at + AFTER) {
          copy.step({ tick: copy.tick, orders: turns.get(copy.tick) ?? [] });
          const expected = pinned.get(copy.tick - 1);
          if (expected !== undefined) {
            expect(
              copy.hash(),
              `${file} loaded at ${String(at)}, tick ${String(copy.tick - 1)}`,
            ).toBe(expected);
          }
        }
      }
    }, 300_000);
  }
});
