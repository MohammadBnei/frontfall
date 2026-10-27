import {
  CATALOGUE,
  COUNTERS,
  isAchievementId,
  tierOf,
  type AchievementId,
  type Counts,
} from "./catalog.ts";

/** Where the browser keeps what the player has earned. */
export const ACHIEVEMENTS_KEY = "frontfall.achievements";

const VERSION = 1;

/** Level reached by an achievement and when it was first earned; 1 for one without tiers, 1 to 3 otherwise. */
export interface Earned {
  at: number;
  level: number;
}

export interface Progress {
  earned: Map<AchievementId, Earned>;
  counts: Counts;
}

/** An achievement just earned, or a new tier of one. */
export interface Gain {
  id: AchievementId;
  level: number;
}

/** What a game adds: achievements earned in it, and how much it adds to each count. */
export interface Delta {
  fresh: readonly AchievementId[];
  counts: Partial<Counts>;
}

const emptyCounts = (): Counts => ({ wins: 0, cities: 0, games: 0 });

/**
 * Achievements earned on this device, kept in the browser's storage and
 * nowhere else. Storage can be missing or throw (private mode, blocked
 * cookies), then nothing is kept; anything unreadable counts as nothing earned.
 */
export class AchievementStore {
  constructor(private readonly storage: Storage | undefined) {}

  load(): Progress {
    const progress: Progress = { earned: new Map(), counts: emptyCounts() };
    try {
      const raw = this.storage?.getItem(ACHIEVEMENTS_KEY);
      if (!raw) return progress;
      const data = JSON.parse(raw) as { v?: unknown; earned?: unknown; counts?: unknown };
      if (data.v !== VERSION) return progress;
      if (typeof data.counts === "object" && data.counts !== null) {
        const counts = data.counts as Record<string, unknown>;
        for (const counter of COUNTERS) {
          const value = counts[counter];
          if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            progress.counts[counter] = Math.floor(value);
          }
        }
      }
      if (typeof data.earned === "object" && data.earned !== null) {
        for (const [id, entry] of Object.entries(data.earned)) {
          const { at, level } = entry as Partial<Earned>;
          // Ids this version does not know are dropped: they may come from a later one.
          if (isAchievementId(id) && typeof at === "number" && Number.isFinite(at)) {
            progress.earned.set(id, { at, level: typeof level === "number" ? level : 1 });
          }
        }
      }
    } catch {
      return { earned: new Map(), counts: emptyCounts() };
    }
    return progress;
  }

  /** Erases everything earned from the device. */
  clear(): void {
    try {
      this.storage?.removeItem(ACHIEVEMENTS_KEY);
    } catch {
      // Nothing to forget where nothing could be kept.
    }
  }

  /** Adds what a game earned; returns the achievements and tiers that are new. */
  record(delta: Delta, now: number): Gain[] {
    const progress = this.load();
    const gains: Gain[] = [];
    for (const id of new Set(delta.fresh)) {
      if (progress.earned.has(id)) continue;
      progress.earned.set(id, { at: now, level: 1 });
      gains.push({ id, level: 1 });
    }
    for (const counter of COUNTERS) {
      const added = delta.counts[counter] ?? 0;
      if (added <= 0) continue;
      const before = progress.counts[counter];
      progress.counts[counter] = before + added;
      for (const { id, counter: of, tiers } of CATALOGUE) {
        if (of !== counter || !tiers) continue;
        const level = tierOf(tiers, progress.counts[counter]);
        if (level > tierOf(tiers, before)) {
          progress.earned.set(id, { at: progress.earned.get(id)?.at ?? now, level });
          gains.push({ id, level });
        }
      }
    }
    if (gains.length === 0 && COUNTERS.every((counter) => !delta.counts[counter])) return gains;
    try {
      this.storage?.setItem(
        ACHIEVEMENTS_KEY,
        JSON.stringify({
          v: VERSION,
          earned: Object.fromEntries(progress.earned),
          counts: progress.counts,
        }),
      );
    } catch {
      // Without storage they are shown this game and forgotten after.
    }
    return gains;
  }
}
