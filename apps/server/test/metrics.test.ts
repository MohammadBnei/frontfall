import { describe, expect, it } from "vitest";
import { Metrics } from "../src/metrics.ts";

const SNAPSHOT = { games: { open: 2, starting: 1, running: 3 }, players: 17, connections: 20 };

describe("Metrics", () => {
  it("renders every documented metric in the Prometheus text format", () => {
    const metrics = new Metrics();
    metrics.gamesFinished.inc({ reason: "timeout" });
    metrics.gamesFinished.inc({ reason: "timeout" });
    metrics.rejected.inc({ reason: "rate_limited" });
    metrics.turnDuration.observe(0.002);
    metrics.turnDuration.observe(0.2);
    const text = metrics.render(SNAPSHOT);

    expect(text).toContain('frontfall_games{state="running"} 3');
    expect(text).toContain("frontfall_players 17");
    expect(text).toContain("frontfall_connections 20");
    expect(text).toContain("frontfall_games_started_total 0");
    expect(text).toContain('frontfall_games_finished_total{reason="timeout"} 2');
    expect(text).toContain('frontfall_rejected_messages_total{reason="rate_limited"} 1');
    expect(text).toContain('frontfall_turn_duration_seconds_bucket{le="0.001"} 0');
    expect(text).toContain('frontfall_turn_duration_seconds_bucket{le="0.0025"} 1');
    expect(text).toContain('frontfall_turn_duration_seconds_bucket{le="+Inf"} 2');
    expect(text).toContain("frontfall_turn_duration_seconds_count 2");
    expect(text).toMatch(/^process_resident_memory_bytes \d+$/m);
    expect(text).toMatch(/^process_cpu_seconds_total [\d.]+$/m);
    for (const name of [
      "frontfall_desyncs_total",
      "frontfall_rejoins_total",
      "frontfall_messages_received_total",
    ]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }
    expect(text.endsWith("\n")).toBe(true);
  });

  it("escapes label values", () => {
    const metrics = new Metrics();
    metrics.rejected.inc({ reason: 'a"b\\c' });
    expect(metrics.render(SNAPSHOT)).toContain('{reason="a\\"b\\\\c"} 1');
    expect(metrics.rejected.get({ reason: 'a"b\\c' })).toBe(1);
  });
});
