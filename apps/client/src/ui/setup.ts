import { DEFAULT_MAP, MAPS, findMap } from "../game/maps.ts";
import { MAX_BOTS, type Difficulty, type SoloOptions } from "../game/solo-game.ts";

/** What the player chooses in the menu; the seed is drawn when the game starts. */
export type GameSetup = Omit<SoloOptions, "seed">;

const STORAGE_KEY = "frontfall.setup";
const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
export const MAX_NAME_LENGTH = 20;

export function defaultSetup(): GameSetup {
  const map = findMap(DEFAULT_MAP) ?? MAPS[0];
  if (!map) throw new Error("no map available");
  return { map: map.id, bots: map.suggestedBots, difficulty: "normal", playerName: "" };
}

/** Keeps only values that make sense; anything else falls back to `base`. */
export function sanitizeSetup(input: Record<string, unknown>, base: GameSetup): GameSetup {
  const setup = { ...base };
  if (typeof input.map === "string" && findMap(input.map)) setup.map = input.map;
  const bots = Number(input.bots);
  if (input.bots !== undefined && input.bots !== "" && Number.isInteger(bots)) {
    setup.bots = Math.max(1, Math.min(MAX_BOTS, bots));
  }
  if (DIFFICULTIES.includes(input.difficulty as Difficulty)) {
    setup.difficulty = input.difficulty as Difficulty;
  }
  if (typeof input.name === "string") setup.playerName = cleanName(input.name);
  if (typeof input.playerName === "string") setup.playerName = cleanName(input.playerName);
  return setup;
}

export function cleanName(name: string): string {
  return name
    .replace(/[\p{C}]/gu, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/** Last setup from storage, then the query string on top, so shared links win. */
export function initialSetup(search: string, storage: Storage | undefined): GameSetup {
  let setup = defaultSetup();
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved) setup = sanitizeSetup(JSON.parse(saved) as Record<string, unknown>, setup);
  } catch {
    // Storage disabled or corrupted: the defaults will do.
  }
  const params = Object.fromEntries(new URLSearchParams(search));
  return sanitizeSetup(params, setup);
}

export function saveSetup(setup: GameSetup, storage: Storage | undefined): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // Not remembering the setup is fine.
  }
}

/** Query string that reproduces a setup, relative to the page so it works under any prefix. */
export function setupQuery(setup: GameSetup): string {
  const params = new URLSearchParams({
    map: setup.map,
    bots: String(setup.bots),
    difficulty: setup.difficulty,
  });
  return `?${params.toString()}`;
}

/** localStorage, or undefined where merely touching it throws. */
export function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
