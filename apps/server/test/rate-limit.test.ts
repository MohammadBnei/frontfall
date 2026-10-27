import { describe, expect, it } from "vitest";
import { AddressRate, TokenBucket } from "../src/rate-limit.ts";

describe("TokenBucket", () => {
  it("allows a burst, then the sustained rate", () => {
    const bucket = new TokenBucket(10, 3, 0);
    expect([1, 2, 3, 4].map(() => bucket.take(0))).toEqual([true, true, true, false]);
    expect(bucket.take(50)).toBe(false);
    expect(bucket.take(100)).toBe(true);
    expect(bucket.take(100)).toBe(false);
  });

  it("never saves up more than the burst", () => {
    const bucket = new TokenBucket(10, 2, 0);
    const taken = [1, 2, 3].map(() => bucket.take(60_000));
    expect(taken).toEqual([true, true, false]);
  });
});

describe("AddressRate", () => {
  it("keeps one bucket per address", () => {
    const rate = new AddressRate(1, 2, 0);
    expect([1, 2, 3].map(() => rate.take("a", 0))).toEqual([true, true, false]);
    expect(rate.take("b", 0)).toBe(true);
    expect(rate.take("a", 1000)).toBe(true);
  });

  it("forgets addresses whose bucket has filled up again", () => {
    const rate = new AddressRate(1, 2, 0);
    rate.take("a", 0);
    rate.take("b", 0);
    expect(rate.size).toBe(2);
    rate.take("c", 5000);
    expect(rate.size).toBe(1);
  });
});
