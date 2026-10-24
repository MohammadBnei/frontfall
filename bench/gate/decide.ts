/** How the head engine compares with the base engine over paired rounds. */
export interface Verdict {
  /** "more" when the rounds so far cannot decide and more should be run. */
  readonly outcome: "pass" | "fail" | "more";
  /** Median of head time over base time, round by round. */
  readonly ratio: number;
  readonly reason: string;
}

export interface GateRule {
  /** Below this median ratio after the first rounds, the head passes at once. */
  readonly passBelow: number;
  /** Above this median ratio after the first rounds, the head fails at once. */
  readonly failAbove: number;
  /** After the extra rounds, the head fails above this median ratio... */
  readonly threshold: number;
  /** ...provided at least this share of the rounds found it slower. */
  readonly slowerShare: number;
  readonly firstRounds: number;
  readonly extraRounds: number;
}

/**
 * Tuned so that a head 10 % slower fails and one as fast does not, given a
 * round-to-round spread of a few percent on shared CI machines: a clear
 * result after the first rounds decides at once, anything in between gets
 * twice the rounds and a lower bar.
 */
export const GATE_RULE: GateRule = {
  passBelow: 1.04,
  failAbove: 1.1,
  threshold: 1.06,
  slowerShare: 0.7,
  firstRounds: 5,
  extraRounds: 5,
};

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("no values");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** The verdict on the per-round ratios of head time over base time. */
export function decide(ratios: readonly number[], rule: GateRule = GATE_RULE): Verdict {
  if (ratios.length < rule.firstRounds) {
    throw new RangeError(`at least ${String(rule.firstRounds)} rounds are needed`);
  }
  const ratio = median(ratios);
  const percent = `${((ratio - 1) * 100).toFixed(1)} %`;
  if (ratios.length < rule.firstRounds + rule.extraRounds) {
    if (ratio < rule.passBelow)
      return { outcome: "pass", ratio, reason: `median change ${percent}` };
    if (ratio > rule.failAbove) {
      return { outcome: "fail", ratio, reason: `median change ${percent}, clearly slower` };
    }
    return { outcome: "more", ratio, reason: `median change ${percent}, not clear yet` };
  }
  const slower = ratios.filter((r) => r > 1).length / ratios.length;
  if (ratio > rule.threshold && slower >= rule.slowerShare) {
    return {
      outcome: "fail",
      ratio,
      reason: `median change ${percent} over ${String(ratios.length)} rounds, slower in ${String(Math.round(slower * 100))} % of them`,
    };
  }
  return {
    outcome: "pass",
    ratio,
    reason: `median change ${percent} over ${String(ratios.length)} rounds`,
  };
}

/** Mean of the samples at or below their 99th percentile: a GC pause or a stolen time slice does not move it. */
export function robustMean(samples: readonly number[]): number {
  if (samples.length === 0) throw new RangeError("no samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const kept = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.99)));
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}
