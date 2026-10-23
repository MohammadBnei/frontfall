import { describe, expect, it } from "vitest";
import { summarize } from "../engine/stats.ts";

describe("summarize", () => {
  it("reports nearest-rank percentiles", () => {
    const samples = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(summarize(samples)).toEqual({
      samples: 100,
      mean: 50.5,
      p50: 50,
      p95: 95,
      p99: 99,
      max: 100,
    });
  });

  it("handles a single sample", () => {
    expect(summarize([3]).p95).toBe(3);
  });

  it("refuses an empty run", () => {
    expect(() => summarize([])).toThrow(RangeError);
  });
});
