import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { createGameServer } from "@frontfall/server";
import { describe, expect, it } from "vitest";
import { Histogram } from "../server/histogram.ts";
import { runLoad } from "../server/load.ts";

describe("Histogram", () => {
  it("reports percentiles to a tenth of a millisecond and the exact maximum", () => {
    const histogram = new Histogram();
    for (let i = 1; i <= 100; i++) histogram.record(i);
    histogram.record(123.456);
    const summary = histogram.summary();
    expect(summary.samples).toBe(101);
    expect(summary.p50).toBeCloseTo(51, 5);
    expect(summary.p95).toBeCloseTo(96, 5);
    expect(summary.max).toBe(123.456);
  });

  it("adds up histograms and keeps outliers in the last bucket", () => {
    const a = new Histogram();
    const b = new Histogram();
    a.record(100);
    b.record(60_000);
    a.add(b);
    expect(a.summary()).toMatchObject({ samples: 2, p50: 100, max: 60_000 });
    expect(() => new Histogram().summary()).toThrow(RangeError);
  });
});

describe("server load", () => {
  it("delivers every turn in order and on time to 2 games of 8 players", async () => {
    const server = createGameServer({ staticRoot: tmpdir(), version: "load" });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    const { port } = server.http.address() as AddressInfo;
    try {
      const report = await runLoad({
        url: `ws://127.0.0.1:${String(port)}/ws`,
        games: 2,
        players: 8,
        durationMs: 10_000,
        mode: "private",
        orderIntervalMs: 2000,
        mapTiles: 4096 * 2048,
      });

      expect(report.games).toHaveLength(2);
      for (const game of report.games) {
        expect(game.players).toBe(8);
        expect(game.outOfOrder).toBe(0);
        expect(game.desyncs).toBe(0);
        // Counts are taken at one instant; a turn may still be in flight to some clients.
        expect(game.maxTurns - game.minTurns).toBeLessThanOrEqual(1);
        expect(game.minTurns).toBeGreaterThanOrEqual(80);
        expect(game.ordersSeen).toBeGreaterThan(0);
        expect(game.ordersSeen).toBeGreaterThanOrEqual(game.ordersSent - game.players);
      }
      expect(report.interval.p95).toBeLessThan(300);
    } finally {
      await server.close();
    }
  }, 20_000);
});
