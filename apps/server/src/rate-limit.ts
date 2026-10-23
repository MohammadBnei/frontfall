/**
 * Token bucket: `burst` messages at once, refilled at `perSecond`. A client
 * that keeps within the rate never notices it; one that floods runs dry.
 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.updatedAt = now;
  }

  /** Takes one token, or returns false when none is left. */
  take(now: number): boolean {
    this.tokens = Math.min(
      this.burst,
      this.tokens + ((now - this.updatedAt) / 1000) * this.perSecond,
    );
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
