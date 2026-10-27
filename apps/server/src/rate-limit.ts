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

  /** Whether the bucket would hold every token again at `now`. */
  full(now: number): boolean {
    return this.tokens + ((now - this.updatedAt) / 1000) * this.perSecond >= this.burst;
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

/**
 * One token bucket per address, for what a client may do before it has a
 * connection to count against, such as opening one. Buckets that have filled
 * up again are forgotten, so the map only holds addresses active lately.
 */
export class AddressRate {
  private readonly buckets = new Map<string, TokenBucket>();
  private prunedAt: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    now: number,
  ) {
    this.prunedAt = now;
  }

  get size(): number {
    return this.buckets.size;
  }

  /** Takes one token for `address`, or returns false when it has none left. */
  take(address: string, now: number): boolean {
    this.prune(now);
    let bucket = this.buckets.get(address);
    if (!bucket) {
      bucket = new TokenBucket(this.perSecond, this.burst, now);
      this.buckets.set(address, bucket);
    }
    return bucket.take(now);
  }

  /** At most once per refill time: drops the buckets that are full again. */
  private prune(now: number): void {
    const refillMs = (this.burst / this.perSecond) * 1000;
    if (now - this.prunedAt < refillMs) return;
    this.prunedAt = now;
    for (const [address, bucket] of this.buckets) {
      if (bucket.full(now)) this.buckets.delete(address);
    }
  }
}
