import { monitorEventLoopDelay, type ELDHistogram } from "node:perf_hooks";

const RESOLUTION_MS = 10;

export interface LoopDelaySummary {
  p99: number;
  max: number;
}

/**
 * How late the event loop ran a timer, in ms. Node samples with a timer of
 * `resolution` ms and records the whole period, so an idle loop reads 10 ms;
 * the period is subtracted here.
 */
export class LoopDelay {
  private readonly histogram: ELDHistogram = monitorEventLoopDelay({
    resolution: RESOLUTION_MS,
  });

  constructor() {
    this.histogram.enable();
  }

  /** Delay since the start or the previous reset. */
  summary(): LoopDelaySummary {
    const excess = (ns: number) => Math.max(0, ns / 1e6 - RESOLUTION_MS);
    return { p99: excess(this.histogram.percentile(99)), max: excess(this.histogram.max) };
  }

  reset(): void {
    this.histogram.reset();
  }

  stop(): void {
    this.histogram.disable();
  }
}
