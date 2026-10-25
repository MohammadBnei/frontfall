import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameReport } from "@frontfall/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  botsRange,
  humansRange,
  loadUsage,
  minutesRange,
  saveUsage,
  usageFile,
  UsageStats,
  usageTable,
} from "../src/usage.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25, 12);

const GAME: GameReport = {
  kind: "game",
  release: "0.5.0",
  game: "0123456789abcdef",
  mode: "solo",
  map: "world",
  teams: 0,
  nations: true,
  bots: 20,
  humans: 1,
  difficulty: "normal",
  disabled: 0b100100,
  minutes: 12.5,
  outcome: "victory",
  device: "phone",
  touch: true,
  lang: "fr",
  view: "flat",
};

const stats = () => new UsageStats({ release: "0.5.0", maps: new Set(["world", "europe"]) });

let directory: string | undefined;
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("ranges", () => {
  it("puts numbers into the ranges of the export", () => {
    expect([0, 1, 5, 6, 20, 21, 51, 400].map(botsRange)).toEqual([
      "0",
      "1-5",
      "1-5",
      "6-20",
      "6-20",
      "21-50",
      "51+",
      "51+",
    ]);
    expect([1, 2, 3, 4, 5, 8, 9, 64].map(humansRange)).toEqual([
      "1",
      "2",
      "3-4",
      "3-4",
      "5-8",
      "5-8",
      "9+",
      "9+",
    ]);
    expect([0, 1.9, 2, 7, 19, 39, 40, 300].map(minutesRange)).toEqual([
      "0-2",
      "0-2",
      "2-5",
      "5-10",
      "10-20",
      "20-40",
      "40+",
      "40+",
    ]);
  });
});

describe("UsageStats", () => {
  it("adds one to each dimension of a game, today and in total", () => {
    const usage = stats();
    expect(usage.record(GAME, NOW)).toBe(true);
    const { total, days, since } = usage.export(NOW);
    expect(since).toBe("2026-10-25");
    expect(days).toEqual([{ day: "2026-10-25", counts: total }]);
    expect(total).toMatchObject({
      games: { solo: 1 },
      outcome: { "solo.victory": 1 },
      map: { world: 1 },
      teams: { "0": 1 },
      nations: { on: 1 },
      bots: { "6-20": 1 },
      humans: { "1": 1 },
      difficulty: { normal: 1 },
      minutes: { "10-20": 1 },
      device: { phone: 1 },
      touch: { yes: 1 },
      lang: { fr: 1 },
      view: { flat: 1 },
      release: { "0.5.0": 1 },
      disabled: { port: 1, warships: 1 },
    });
  });

  it("counts a game once however often it is reported, and one vote per game", () => {
    const usage = stats();
    expect(usage.record(GAME, NOW)).toBe(true);
    expect(usage.record({ ...GAME, outcome: "closed" }, NOW + 1000)).toBe(false);
    const vote = {
      kind: "feedback",
      release: "0.5.0",
      game: GAME.game,
      mode: "solo",
      outcome: "victory",
      vote: "up",
    } as const;
    expect(usage.record(vote, NOW)).toBe(true);
    expect(usage.record({ ...vote, vote: "down" }, NOW)).toBe(false);
    const { total } = usage.export(NOW);
    expect(total.games).toEqual({ solo: 1 });
    expect(total.votes).toEqual({ up: 1 });
    expect(total.votes_by).toEqual({ "solo.victory.up": 1 });
  });

  it("names unknown maps and other releases without repeating them", () => {
    const usage = stats();
    usage.record({ ...GAME, game: "1111111111111111", map: "my-secret-map" }, NOW);
    usage.record({ ...GAME, game: "2222222222222222", map: "generated", release: "0.4.0" }, NOW);
    const { total } = usage.export(NOW);
    expect(total.map).toEqual({ other: 1, generated: 1 });
    expect(total.release).toEqual({ "0.5.0": 1, other: 1 });
  });

  it("counts errors and the reasons given with a thumbs down", () => {
    const usage = stats();
    usage.record({ kind: "error", release: "0.5.0", type: "webgl" }, NOW);
    usage.record({ kind: "error", release: "0.5.0", type: "webgl" }, NOW);
    usage.record(
      {
        kind: "feedback",
        release: "0.5.0",
        game: GAME.game,
        mode: "solo",
        outcome: "defeat",
        vote: "down",
        reason: "unclear",
      },
      NOW,
    );
    const { total } = usage.export(NOW);
    expect(total.errors).toEqual({ webgl: 2 });
    expect(total.reasons).toEqual({ unclear: 1 });
  });

  it("keeps 90 days, newest first, and the total of every day", () => {
    const usage = stats();
    usage.record({ ...GAME, game: "1111111111111111" }, NOW - 100 * DAY);
    usage.record({ ...GAME, game: "2222222222222222" }, NOW - DAY);
    usage.record({ ...GAME, game: "3333333333333333" }, NOW);
    const exported = usage.export(NOW);
    expect(exported.days.map((day) => day.day)).toEqual(["2026-10-25", "2026-10-24"]);
    expect(exported.total.games).toEqual({ solo: 3 });
  });

  it("renders its totals for Prometheus", () => {
    const usage = stats();
    usage.record(GAME, NOW);
    const lines = usage.renderMetrics();
    expect(lines).toContain("# TYPE frontfall_usage_total counter");
    expect(lines).toContain('frontfall_usage_total{dimension="games",value="solo"} 1');
  });
});

describe("saving the counts", () => {
  it("writes them for the server's user only, and reads them back", () => {
    directory = mkdtempSync(join(tmpdir(), "frontfall-data-"));
    const file = usageFile(directory);
    const usage = stats();
    usage.record(GAME, NOW);
    saveUsage(usage, file, NOW);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = stats();
    expect(loadUsage(again, file)).toBeUndefined();
    expect(again.export(NOW)).toEqual(usage.export(NOW));
    expect(readFileSync(file, "utf8")).not.toContain(GAME.game);
  });

  it("starts empty without a file, and says when the file cannot be read", () => {
    directory = mkdtempSync(join(tmpdir(), "frontfall-data-"));
    const usage = stats();
    expect(loadUsage(usage, usageFile(directory))).toBeUndefined();
    const broken = join(directory, "broken.json");
    writeFileSync(broken, "{ not json");
    expect(loadUsage(usage, broken)).toBeInstanceOf(Error);
    // Set aside, so that the next save does not write over what could be mended.
    expect(readFileSync(`${broken}.broken`, "utf8")).toBe("{ not json");
    expect(usage.export(NOW).days).toEqual([]);
  });
});

describe("usageTable", () => {
  it("summarises the last days for the status page", () => {
    const usage = stats();
    usage.record(GAME, NOW);
    usage.record({ ...GAME, game: "1111111111111111", mode: "public", device: "desktop" }, NOW);
    const html = usageTable(usage.export(NOW));
    expect(html).toContain("<td>2026-10-25</td><td>1</td><td>1</td><td>0</td><td>50 %</td>");
    expect(usageTable(stats().export(NOW))).toContain(
      "No games counted yet / Aucune partie comptée",
    );
  });
});
