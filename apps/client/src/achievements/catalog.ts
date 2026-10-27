/**
 * The achievements a player can earn, in the order the list shows them. The
 * names and descriptions are in the catalogues as `achievement.<id>.name`
 * and `achievement.<id>.text`; `glyph` is the badge's picture on a 24-unit grid.
 */
export const ACHIEVEMENTS = [
  {
    id: "conqueror",
    counter: "wins",
    tiers: [1, 5, 25],
    glyph:
      "M7 3h10v6a5 5 0 0 1-10 0zM10.5 14h3v3h-3zM8 18h8v2.5H8zM3.5 4.5H7v2H5.5A1.5 1.5 0 0 0 7 8v2a3.5 3.5 0 0 1-3.5-3.5zM20.5 4.5H17v2h1.5A1.5 1.5 0 0 1 17 8v2a3.5 3.5 0 0 0 3.5-3.5z",
  },
  {
    id: "hardVictory",
    glyph: "M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3-1-4 0-7 1-10z",
  },
  {
    id: "teamVictory",
    glyph:
      "M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2zM15 14h3a4 4 0 0 1 4 4v2h-6v-2a6 6 0 0 0-1-3.4z",
  },
  {
    id: "halfWorld",
    glyph: "M12 2a10 10 0 0 0 0 20zM13.5 2.1v1.6a8.5 8.5 0 0 1 0 16.6v1.6a10 10 0 0 0 0-19.8z",
  },
  { id: "quickVictory", glyph: "M13 2 5 13h5l-1 9 9-12h-5z" },
  { id: "comeback", glyph: "M12 3l7 8h-4.5v7h-5v-7H5zM5 20h14v2H5z" },
  {
    id: "noMissiles",
    glyph:
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM5.6 7l1.4-1.4 11.4 11.4-1.4 1.4z",
  },
  {
    id: "builder",
    counter: "cities",
    tiers: [1, 25, 100],
    glyph: "M3 12h5v9H3zM9 4h6v17H9zM16 9h5v12h-5z",
  },
  { id: "metropolis", glyph: "M2 14h4v8H2zM7 8h4v14H7zM12 3h4v19h-4zM17 10h5v12h-5z" },
  {
    id: "palace",
    glyph:
      "M12 4a6 6 0 0 0-6 6v1h12v-1a6 6 0 0 0-6-6zM4 12h16v2H4zM5 15h2v6H5zM11 15h2v6h-2zM17 15h2v6h-2zM11.2 1h1.6v3h-1.6z",
  },
  { id: "fortress", glyph: "M5 3h3v3h2V3h4v3h2V3h3v7h-2v10H7V10H5z" },
  {
    id: "harbor",
    glyph:
      "M12 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM11 9h2v11h-2zM8 9h8v2H8zM4 14h2a6 6 0 0 0 12 0h2a8 8 0 0 1-16 0z",
  },
  { id: "setSail", glyph: "M12 3v12H5zM13.5 6l6 9h-6zM3 17h18l-3 4H6z" },
  { id: "admiral", glyph: "M3 15h18l-3 5H6zM6 11h9v4H6zM15 12h6v1.5h-6zM9 8h3v3H9z" },
  {
    id: "ally",
    glyph:
      "M9 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM15 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z",
  },
  {
    id: "veteran",
    counter: "games",
    tiers: [1, 10, 50],
    glyph: "M12 2 15 9l7 .6-5.3 4.6 1.6 7L12 17.4 5.7 21.2l1.6-7L2 9.6 9 9z",
  },
  {
    id: "merchant",
    glyph: "M3 14h18l-3 5H6zM5 8h4v5H5zM10 8h4v5h-4zM15 8h4v5h-4zM11 3h2v3h-2z",
  },
  {
    id: "generous",
    glyph:
      "M3 9h18v4H3zM5 14h14v7H5zM11 9h2v12h-2zM12 8C9 8 7 6 8 4.5c1.5-1.5 3 .5 4 3.5 1-3 2.5-5 4-3.5C17 6 15 8 12 8z",
  },
  {
    id: "crowded",
    glyph:
      "M12 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 21v-6a4 4 0 0 1 8 0v6zM1.5 19v-4a3.5 3.5 0 0 1 5-3.200A6 6 0 0 0 5.500 15v4zM22.5 19v-4a3.5 3.5 0 0 0-5-3.200A6 6 0 0 1 18.500 15v4z",
  },
  {
    id: "missile",
    glyph:
      "M12 2c3 2 4.5 5 4.5 9l2.5 4v3l-3-1.5H8L5 18v-3l2.5-4C7.5 7 9 4 12 2zM10.5 19h3L12 22zM12 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]["id"];

/** What a tiered achievement counts across games. */
export type Counter = "wins" | "cities" | "games";
export type Counts = Record<Counter, number>;

export const COUNTERS: readonly Counter[] = ["wins", "cities", "games"];

export interface Achievement {
  id: AchievementId;
  glyph: string;
  /** Tiered: bronze, silver and gold at these counts of `counter`. */
  counter?: Counter;
  tiers?: readonly [number, number, number];
}

/** The catalogue read with its optional fields. */
export const CATALOGUE: readonly Achievement[] = ACHIEVEMENTS;

/** Tiers reached at `count`: 0 to 3. */
export function tierOf(tiers: readonly number[], count: number): number {
  return tiers.filter((goal) => count >= goal).length;
}

const IDS: ReadonlySet<string> = new Set(ACHIEVEMENTS.map(({ id }) => id));

export function isAchievementId(value: string): value is AchievementId {
  return IDS.has(value);
}

/** Badge level of an earned achievement: its tier, or gold where it has none. */
export function badgeLevel(achievement: Achievement, level: number): number {
  return achievement.tiers ? level : 3;
}
