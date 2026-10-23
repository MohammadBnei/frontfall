/**
 * Exact integer helpers for game state (R-ECO-04). Products of doubles lose
 * precision past 2^53 and square roots can round up to the next integer;
 * these give the same result on every runtime.
 */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * floor(a / b) for safe integers, with b > 0. The double quotient is exact
 * enough: when a / b is not an integer it is at least 1 / b away from one,
 * a relative gap above 2^-53 for |a| < 2^53, so rounding never reaches it.
 */
export function divFloor(a: number, b: number): number {
  if (b <= 0) throw new RangeError(`divisor must be positive, got ${String(b)}`);
  return Math.floor(a / b);
}

/** floor(a * b / c) for safe integers, with c > 0, even when a * b exceeds 2^53. */
export function mulDiv(a: number, b: number, c: number): number {
  const product = a * b;
  if (Number.isSafeInteger(product)) return divFloor(product, c);
  if (c <= 0) throw new RangeError(`divisor must be positive, got ${String(c)}`);
  const exact = BigInt(a) * BigInt(b);
  const divisor = BigInt(c);
  // BigInt division truncates towards zero; step down for negative remainders.
  const quotient = exact / divisor - (exact % divisor < 0n ? 1n : 0n);
  return Number(quotient);
}

/** floor(value * percent / 100): `percent` of a whole quantity, rounded down. */
export function percentOf(value: number, percent: number): number {
  return mulDiv(value, percent, 100);
}

/** floor(sqrt(n)) for a safe integer n >= 0. */
export function isqrt(n: number): number {
  if (n < 0) throw new RangeError(`square root of negative ${String(n)}`);
  // Math.sqrt is correctly rounded, so the guess is within one of the answer.
  let root = Math.floor(Math.sqrt(n));
  if (root * root > n) root--;
  else if ((root + 1) * (root + 1) <= n) root++;
  return root;
}
