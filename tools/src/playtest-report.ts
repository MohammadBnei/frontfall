import { z } from "zod";

// Reads the counters a Frontfall server publishes at /api/stats (docs/privacy.md,
// "What is published") and says how many of the games played were played to
// their end. A game is finished when it ended on the end screen, won or lost;
// it is abandoned when the player went back to the menu, closed the tab, or
// lost the connection. Nothing here needs more than the public counters.

const Counts = z.record(z.string(), z.record(z.string(), z.number()));
export const Stats = z.object({
  release: z.string(),
  since: z.string(),
  total: Counts,
  days: z.array(z.object({ day: z.string(), counts: Counts })),
});
export type Stats = z.infer<typeof Stats>;

/** The outcomes that end a game on the end screen; the others are the player leaving it. */
const FINISHED = new Set(["victory", "defeat"]);

export interface Tally {
  played: number;
  finished: number;
  abandoned: number;
  /** Share of the games played that were finished, 0 to 1; undefined without a game. */
  rate: number | undefined;
  /** Abandoned games that were also in the server's "early" count (under two minutes). */
  early: number;
  up: number;
  down: number;
  errors: number;
}

export interface Report {
  /** Games per mode (`solo`, `private`, `public`) and for all. */
  modes: Record<string, Tally>;
  all: Tally;
}

/** Splits `solo.defeat` into the mode and the outcome. */
function split(key: string): [string, string] | undefined {
  const dot = key.lastIndexOf(".");
  return dot > 0 ? [key.slice(0, dot), key.slice(dot + 1)] : undefined;
}

function empty(): Tally {
  return {
    played: 0,
    finished: 0,
    abandoned: 0,
    rate: undefined,
    early: 0,
    up: 0,
    down: 0,
    errors: 0,
  };
}

/** The sum of one dimension's counters. */
function sum(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
}

/**
 * The counters of the days from `since` (YYYY-MM-DD, UTC) on, or of the whole
 * time the server has counted when `since` is undefined.
 */
export function counters(stats: Stats, since?: string): Record<string, Record<string, number>> {
  if (since === undefined) return stats.total;
  const out: Record<string, Record<string, number>> = {};
  for (const { day, counts } of stats.days) {
    if (day < since) continue;
    for (const [dimension, values] of Object.entries(counts)) {
      const into = (out[dimension] ??= {});
      for (const [key, count] of Object.entries(values)) into[key] = (into[key] ?? 0) + count;
    }
  }
  return out;
}

export function report(stats: Stats, since?: string): Report {
  const counts = counters(stats, since);
  const modes: Record<string, Tally> = {};
  const all = empty();
  for (const [key, count] of Object.entries(counts.outcome ?? {})) {
    const parts = split(key);
    if (!parts) continue;
    const [mode, outcome] = parts;
    const tally = (modes[mode] ??= empty());
    for (const t of [tally, all]) {
      t.played += count;
      if (FINISHED.has(outcome)) t.finished += count;
      else t.abandoned += count;
    }
  }
  for (const [key, count] of Object.entries(counts.early ?? {})) {
    const parts = split(key);
    if (!parts) continue;
    if (FINISHED.has(parts[1])) continue;
    (modes[parts[0]] ??= empty()).early += count;
    all.early += count;
  }
  for (const [key, count] of Object.entries(counts.votes_by ?? {})) {
    const parts = split(key);
    if (!parts) continue;
    const vote = parts[1] === "up" ? "up" : parts[1] === "down" ? "down" : undefined;
    const mode = split(parts[0])?.[0];
    if (!vote) continue;
    all[vote] += count;
    if (mode) (modes[mode] ??= empty())[vote] += count;
  }
  all.errors = sum(counts.errors);
  for (const t of [...Object.values(modes), all]) {
    t.rate = t.played > 0 ? t.finished / t.played : undefined;
  }
  return { modes, all };
}

const percent = (rate: number | undefined): string =>
  rate === undefined ? "–" : `${String(Math.round(rate * 100))} %`;

/** The report as a Markdown table, for the playtest thread. */
export function format(stats: Stats, since?: string): string {
  const { modes, all } = report(stats, since);
  const rows = [
    ...Object.entries(modes).sort(([a], [b]) => a.localeCompare(b)),
    ["all", all] as const,
  ];
  const lines = [
    `Release ${stats.release}, ${since === undefined ? `since ${stats.since}` : `from ${since}`} (UTC).`,
    "",
    "| Mode | Played | Finished | Abandoned | Finished share | Left under 2 min | Thumbs up | Thumbs down |",
    "| ---- | -----: | -------: | --------: | -------------: | ---------------: | --------: | ----------: |",
  ];
  for (const [mode, t] of rows) {
    lines.push(
      `| ${mode} | ${String(t.played)} | ${String(t.finished)} | ${String(t.abandoned)} | ${percent(t.rate)} | ${String(t.early)} | ${String(t.up)} | ${String(t.down)} |`,
    );
  }
  lines.push("", `Errors reported: ${String(all.errors)}.`);
  return lines.join("\n");
}
