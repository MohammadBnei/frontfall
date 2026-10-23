import { describe, expect, it } from "vitest";
import { clamp, divFloor, isqrt, mulDiv, percentOf } from "../src/integer-math.ts";
import { Random } from "../src/random.ts";

const random = new Random(42);
const MAX = Number.MAX_SAFE_INTEGER;

function bigFloorDiv(a: bigint, b: bigint): bigint {
  return a / b - (a % b < 0n ? 1n : 0n);
}

describe("clamp", () => {
  it("keeps values inside the bounds", () => {
    expect([clamp(-3, 0, 10), clamp(4, 0, 10), clamp(12, 0, 10)]).toEqual([0, 4, 10]);
  });
});

describe("divFloor", () => {
  it("rounds towards minus infinity", () => {
    expect([divFloor(7, 2), divFloor(-7, 2), divFloor(6, 3), divFloor(-6, 3)]).toEqual([
      3, -4, 2, -2,
    ]);
  });

  it("is exact for any safe integers", () => {
    // 2^53 - 1 divided by 2^53 - 2 is just above one; 2^53 - 2 by 2^53 - 1 just below.
    expect(divFloor(MAX, MAX - 1)).toBe(1);
    expect(divFloor(MAX - 1, MAX)).toBe(0);
    for (let i = 0; i < 2000; i++) {
      const a = random.nextInt(0, 2 ** 32) * 2 ** 20 + random.nextInt(0, 2 ** 20);
      const b = random.nextInt(1, 2 ** 26);
      expect(divFloor(a, b)).toBe(Number(bigFloorDiv(BigInt(a), BigInt(b))));
    }
  });

  it("rejects a divisor that is not positive", () => {
    expect(() => divFloor(1, 0)).toThrow(RangeError);
    expect(() => divFloor(1, -2)).toThrow(RangeError);
  });
});

describe("mulDiv", () => {
  it("matches exact arithmetic, including products past 2^53", () => {
    for (let i = 0; i < 2000; i++) {
      const a = random.nextInt(0, 2 ** 32) * (i % 2 === 0 ? 1 : -1);
      const b = random.nextInt(0, 2 ** 32);
      const c = random.nextInt(1, 2 ** 32);
      const expected = bigFloorDiv(BigInt(a) * BigInt(b), BigInt(c));
      expect(mulDiv(a, b, c)).toBe(Number(expected));
    }
  });

  it("rejects a divisor that is not positive, on both paths", () => {
    expect(() => mulDiv(3, 4, 0)).toThrow(RangeError);
    expect(() => mulDiv(2 ** 40, 2 ** 40, 0)).toThrow(RangeError);
  });
});

describe("percentOf", () => {
  it("takes a share of whole troops, rounding down (R-ECO-04)", () => {
    expect([percentOf(999, 30), percentOf(1000, 5), percentOf(7, 50)]).toEqual([299, 50, 3]);
  });
});

describe("isqrt", () => {
  it("returns the floor of the square root", () => {
    expect([0, 1, 2, 3, 4, 15, 16, 17].map(isqrt)).toEqual([0, 1, 1, 1, 2, 3, 4, 4]);
  });

  it("is exact next to perfect squares up to 2^53", () => {
    for (const root of [94_906_265, 2 ** 26 - 1, 12_345_678]) {
      expect(isqrt(root * root)).toBe(root);
      expect(isqrt(root * root - 1)).toBe(root - 1);
    }
    expect(isqrt(MAX)).toBe(94_906_265);
  });

  it("rejects negative numbers", () => {
    expect(() => isqrt(-1)).toThrow(RangeError);
  });
});
