import { describe, expect, it } from "vitest";
import { counters, format, report, type Stats } from "../src/playtest-report.ts";

const stats: Stats = {
  release: "0.9.9",
  since: "2026-10-25",
  total: {
    outcome: { "solo.victory": 2, "solo.defeat": 3, "solo.closed": 3, "private.left": 2 },
    early: { "solo.closed": 1, "private.left": 2, "solo.defeat": 1 },
    votes_by: { "solo.victory.up": 1, "solo.defeat.down": 2 },
    errors: { exception: 4, webgl: 1 },
  },
  days: [
    { day: "2026-11-01", counts: { outcome: { "solo.closed": 3 } } },
    { day: "2026-11-02", counts: { outcome: { "solo.victory": 1, "private.left": 1 } } },
    { day: "2026-11-03", counts: { outcome: { "solo.defeat": 1 }, errors: { webgl: 1 } } },
  ],
};

describe("playtest report", () => {
  it("counts a game finished when it ended on the end screen", () => {
    const { all, modes } = report(stats);
    expect(all).toMatchObject({ played: 10, finished: 5, abandoned: 5, rate: 0.5 });
    expect(modes.solo).toMatchObject({ played: 8, finished: 5, abandoned: 3 });
    expect(modes.private).toMatchObject({ played: 2, finished: 0, abandoned: 2, rate: 0 });
  });

  it("does not count a lost game as one the player left early", () => {
    expect(report(stats).all.early).toBe(3);
  });

  it("reads thumbs and errors", () => {
    expect(report(stats).all).toMatchObject({ up: 1, down: 2, errors: 5 });
  });

  it("adds up only the days from the given one on", () => {
    expect(counters(stats, "2026-11-02").outcome).toEqual({
      "solo.victory": 1,
      "private.left": 1,
      "solo.defeat": 1,
    });
    expect(report(stats, "2026-11-02").all).toMatchObject({ played: 3, finished: 2, rate: 2 / 3 });
  });

  it("has no share without a game", () => {
    expect(report(stats, "2030-01-01").all.rate).toBeUndefined();
    expect(format(stats, "2030-01-01")).toContain("| all | 0 | 0 | 0 | – |");
  });

  it("writes a Markdown table", () => {
    const text = format(stats);
    expect(text).toContain("| all | 10 | 5 | 5 | 50 % | 3 | 1 | 2 |");
    expect(text).toContain("Errors reported: 5.");
  });
});
