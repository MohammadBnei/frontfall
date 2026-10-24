import { describe, expect, it } from "vitest";
import { decide, GATE_RULE, median, robustMean } from "../gate/decide.ts";

const rounds = (...ratios: number[]) => ratios;

describe("median", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow(RangeError);
  });
});

describe("robustMean", () => {
  it("ignores the slowest percent of the samples", () => {
    const samples = [...Array.from({ length: 99 }, () => 2), 500];
    expect(robustMean(samples)).toBe(2);
  });

  it("keeps every sample when there are too few to trim", () => {
    expect(robustMean([1, 3])).toBe(2);
  });
});

describe("decide", () => {
  it("needs the first rounds before it answers", () => {
    expect(() => decide(rounds(1, 1, 1))).toThrow(RangeError);
  });

  it("passes an unchanged engine after the first rounds", () => {
    expect(decide(rounds(1.01, 0.98, 1.02, 0.99, 1.0)).outcome).toBe("pass");
  });

  it("fails an engine clearly slower after the first rounds", () => {
    const verdict = decide(rounds(1.14, 1.12, 1.16, 1.09, 1.13));
    expect(verdict.outcome).toBe("fail");
    expect(verdict.ratio).toBeCloseTo(1.13);
  });

  it("asks for more rounds in between", () => {
    expect(decide(rounds(1.05, 1.08, 1.03, 1.07, 1.06)).outcome).toBe("more");
  });

  it("fails a 10 % slowdown measured with a few percent of noise", () => {
    const noisy = rounds(1.05, 1.13, 1.08, 1.12, 1.06, 1.11, 1.09, 1.14, 1.07, 1.1);
    expect(decide(noisy.slice(0, GATE_RULE.firstRounds)).outcome).toBe("more");
    expect(decide(noisy).outcome).toBe("fail");
  });

  it("passes after the extra rounds when the slowdown does not hold", () => {
    expect(decide(rounds(1.05, 1.07, 1.04, 1.06, 1.05, 0.99, 1.01, 1.0, 1.02, 0.98)).outcome).toBe(
      "pass",
    );
  });

  it("does not fail on a median pulled up by a minority of slow rounds", () => {
    const rule = { ...GATE_RULE, slowerShare: 0.7 };
    // Median above the threshold, but only 60 % of the rounds slower.
    const ratios = rounds(1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 0.9, 0.9, 0.9, 0.9);
    expect(decide(ratios, rule).outcome).toBe("pass");
  });
});
