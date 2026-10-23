import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/rate-limit.ts";

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
