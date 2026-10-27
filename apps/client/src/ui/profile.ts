import type { Outcome, UsageMode } from "@frontfall/protocol";

/** Where the browser keeps the profile, as versioned JSON. */
export const PROFILE_KEY = "frontfall.profile";
const VERSION = 1;
/** Colours a player can pick: the palette's first eight, which stay apart under colour blindness. */
export const COLOR_CHOICES = 8;
/** Games the profile remembers. */
export const MAX_RECENT = 10;

const MODES: readonly UsageMode[] = ["solo", "public", "private"];
const OUTCOMES: readonly Outcome[] = ["victory", "defeat", "left", "closed", "disconnected"];

/** One finished game, as the profile remembers it. */
export interface RecentGame {
  /** When it ended, in milliseconds since the epoch. */
  at: number;
  /** The map's id, or `generated`. */
  map: string;
  mode: UsageMode;
  outcome: Outcome;
  minutes: number;
}

/** What the browser keeps about the player; it never leaves the device. */
export interface Profile {
  /** Index in the palette of the colour wanted in solo games; 0 is the usual one. */
  color: number;
  /** Newest first. */
  games: RecentGame[];
}

export function emptyProfile(): Profile {
  return { color: 0, games: [] };
}

function recentGame(value: unknown): RecentGame | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { at, map, mode, outcome, minutes } = value as Record<string, unknown>;
  if (typeof at !== "number" || !Number.isFinite(at)) return undefined;
  if (typeof map !== "string" || map.length === 0 || map.length > 40) return undefined;
  if (!MODES.includes(mode as UsageMode) || !OUTCOMES.includes(outcome as Outcome)) {
    return undefined;
  }
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return undefined;
  return {
    at,
    map,
    mode: mode as UsageMode,
    outcome: outcome as Outcome,
    minutes: Math.max(0, minutes),
  };
}

/** Keeps only what makes sense; anything else is dropped. */
export function sanitizeProfile(input: unknown): Profile {
  const profile = emptyProfile();
  if (typeof input !== "object" || input === null) return profile;
  const { color, games } = input as Record<string, unknown>;
  if (Number.isInteger(color) && (color as number) >= 0 && (color as number) < COLOR_CHOICES) {
    profile.color = color as number;
  }
  if (Array.isArray(games)) {
    profile.games = (games as unknown[])
      .flatMap((game) => recentGame(game) ?? [])
      .slice(0, MAX_RECENT);
  }
  return profile;
}

export function loadProfile(storage: Storage | undefined): Profile {
  try {
    const saved = storage?.getItem(PROFILE_KEY);
    if (saved) {
      const data: unknown = JSON.parse(saved);
      // A profile of another version counts as none.
      if ((data as { v?: unknown } | null)?.v === VERSION) return sanitizeProfile(data);
    }
  } catch {
    // Storage disabled or corrupted: an empty profile will do.
  }
  return emptyProfile();
}

export function saveProfile(profile: Profile, storage: Storage | undefined): void {
  try {
    storage?.setItem(PROFILE_KEY, JSON.stringify({ v: VERSION, ...profile }));
  } catch {
    // Not remembering the profile is fine.
  }
}

/** Removes the profile from the device. */
export function forgetProfile(storage: Storage | undefined): void {
  try {
    storage?.removeItem(PROFILE_KEY);
  } catch {
    // Nothing to forget where nothing could be kept.
  }
}

/** The profile with a finished game at the top of its list. */
export function withGame(profile: Profile, game: RecentGame): Profile {
  return {
    ...profile,
    games: [{ ...game, minutes: Math.round(game.minutes) }, ...profile.games].slice(0, MAX_RECENT),
  };
}

/** The profile of this device: what is kept, and what a game or the player changes in it. */
export class LocalProfile {
  private profile: Profile;

  constructor(private readonly storage: Storage | undefined) {
    this.profile = loadProfile(storage);
  }

  read(): Profile {
    return this.profile;
  }

  setColor(color: number): void {
    this.profile = { ...this.profile, color };
    saveProfile(this.profile, this.storage);
  }

  /** A game that ended for the player goes to the top of the list. */
  record(game: RecentGame): void {
    this.profile = withGame(this.profile, game);
    saveProfile(this.profile, this.storage);
  }

  forget(): void {
    this.profile = emptyProfile();
    forgetProfile(this.storage);
  }
}
