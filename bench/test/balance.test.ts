import { describe, expect, it } from "vitest";
import { playBalanceGame, type BalanceSetup } from "../balance/game.ts";
import { groupsOf, median, summarize } from "../balance/summary.ts";

const setup: BalanceSetup = {
  map: "island",
  seed: 3,
  bots: [
    { difficulty: "normal", count: 2 },
    { difficulty: "hard", count: 2 },
  ],
  casual: true,
  minutes: 3,
};

describe("playBalanceGame", () => {
  it("plays the same game twice from the same setup", () => {
    const a = playBalanceGame(setup);
    const b = playBalanceGame(setup);
    expect(a.hash).toBe(b.hash);
    expect(a.players).toEqual(b.players);
  });

  it("reports every player, minute by minute", () => {
    const report = playBalanceGame(setup);
    expect(report.players.map((p) => p.kind)).toEqual(["casual", "bot", "bot", "bot", "bot"]);
    expect(report.players.map((p) => p.difficulty)).toEqual([
      undefined,
      "normal",
      "normal",
      "hard",
      "hard",
    ]);
    const last = report.decidedAt ?? setup.minutes;
    expect(report.minutes.length).toBe(Math.floor(last));
    for (const minute of report.minutes) {
      expect(minute.leaderSharePercent).toBeGreaterThan(0);
      expect(minute.medianTroopGold).toBeGreaterThan(0);
    }
    expect(report.players.some((p) => p.troopGold > 0)).toBe(true);
  });

  it("plays a map's nations when asked", () => {
    const report = playBalanceGame({
      ...setup,
      bots: [],
      casual: false,
      nations: "normal",
      minutes: 1,
    });
    expect(report.players.length).toBeGreaterThan(0);
    expect(report.players.every((p) => p.kind === "nation")).toBe(true);
  });
});

describe("summarize", () => {
  it("weighs wins against each group's share of the players", () => {
    const report = playBalanceGame(setup);
    const summary = summarize([report, report]);
    expect(summary.games).toBe(2);
    const kinds = summary.groups.filter((g) => !g.group.startsWith("start"));
    expect(kinds.reduce((sum, g) => sum + g.players, 0)).toBe(10);
    if (report.winner !== undefined) {
      const winner = report.players.find((p) => p.id === report.winner);
      const group = summary.groups.find((g) => g.group === groupsOf(winner as never)[0]);
      expect(group?.wins).toBe(2);
    }
  });

  it("takes the median", () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
