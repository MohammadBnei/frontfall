/**
 * Colours from the brand guide (docs/brand.md). The source of truth is
 * assets/brand/tokens.json; a test keeps the two in sync.
 */

export const MAP_COLORS = {
  ocean: "#0E2233",
  oceanDeep: "#0A1A28",
  land: "#3D4A3B",
  landHigh: "#4C5A47",
} as const;

/** Structures stand out from land of any colour: light glyphs on a dark outline (brand `paper`, `slate-300`, `ink`). */
export const STRUCTURE_COLORS = {
  fill: "#F5F2EC",
  building: "#8DA2B6",
  outline: "#0A131C",
} as const;

export interface PlayerColor {
  name: string;
  hex: string;
}

/**
 * Territory colours in assignment order. The first eight stay apart under
 * the common forms of colour blindness, so small games need nothing else;
 * past eight, names and borders carry identity as well.
 */
export const PLAYER_COLORS: readonly PlayerColor[] = [
  { name: "Sky", hex: "#56B4E9" },
  { name: "Amber", hex: "#E69F00" },
  { name: "Jade", hex: "#1FB58F" },
  { name: "Lemon", hex: "#F0E442" },
  { name: "Azure", hex: "#4F8CFF" },
  { name: "Vermilion", hex: "#F2683A" },
  { name: "Orchid", hex: "#E58FC4" },
  { name: "Snow", hex: "#E6EBF0" },
  { name: "Crimson", hex: "#F05468" },
  { name: "Violet", hex: "#A57CFF" },
  { name: "Lime", hex: "#A4E33B" },
  { name: "Aqua", hex: "#3FD3D3" },
  { name: "Sand", hex: "#D9B98C" },
  { name: "Magenta", hex: "#DA5CE2" },
  { name: "Blush", hex: "#FFB3C1" },
  { name: "Copper", hex: "#C58456" },
  { name: "Mint", hex: "#9EF0C0" },
  { name: "Lilac", hex: "#C3B5FF" },
  { name: "Lagoon", hex: "#4FA3A0" },
  { name: "Coral", hex: "#FF8A75" },
];

/** Colour for the n-th player; wraps around when a lobby has more players than colours. */
export function playerColor(index: number): PlayerColor {
  const count = PLAYER_COLORS.length;
  return PLAYER_COLORS[((index % count) + count) % count] as PlayerColor;
}

/** Nations a map may have, at most: World's 64 each get a colour of their own. */
export const NATION_COLOR_COUNT = 64;

/**
 * Colours of a map's nations. Nations are many, so they take muted tones of
 * their own rather than repeat the players' colours. Each is picked, in
 * turn, as the muted tone farthest from the player colours, the bare map and
 * the nations before it, so the first nations of a map differ the most and
 * none comes close to a human or a bot.
 */
export const NATION_COLORS: readonly string[] = farthestTones(NATION_COLOR_COUNT);

/** Colour of the n-th nation of a map; wraps around past NATION_COLOR_COUNT. */
export function nationColor(index: number): string {
  const count = NATION_COLORS.length;
  return NATION_COLORS[((index % count) + count) % count] as string;
}

/** Colour of player `id`: the palette for humans and bots, a muted tone from `firstNation` on. */
export function colorOf(id: number, firstNation: number): string {
  return id >= firstNation ? nationColor(id - firstNation) : playerColor(id - 1).hex;
}

function farthestTones(count: number): string[] {
  const candidates: string[] = [];
  for (let hue = 0; hue < 360; hue += 6) {
    for (const saturation of [0.15, 0.25, 0.35]) {
      for (let step = 0; step <= 9; step++) {
        candidates.push(hslToHex(hue, saturation, 0.3 + step * 0.05));
      }
    }
  }
  const taken = [...PLAYER_COLORS.map((c) => c.hex), ...Object.values(MAP_COLORS)].map(hexToRgb);
  const rgbs = candidates.map(hexToRgb);
  const nearest = rgbs.map((rgb) => Math.min(...taken.map((other) => colorDistance(rgb, other))));
  const picked: string[] = [];
  while (picked.length < count) {
    // The first of equally far candidates wins, so the list never changes.
    let best = 0;
    for (let i = 1; i < candidates.length; i++) {
      if ((nearest[i] as number) > (nearest[best] as number)) best = i;
    }
    picked.push(candidates[best] as string);
    const rgb = rgbs[best] as [number, number, number];
    for (let i = 0; i < candidates.length; i++) {
      const distance = colorDistance(rgbs[i] as [number, number, number], rgb);
      if (distance < (nearest[i] as number)) nearest[i] = distance;
    }
  }
  return picked;
}

/** Euclidean distance between two colours in RGB bytes. */
export function colorDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  );
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const sector = Math.floor(hue / 60);
  const [r, g, b] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sector] as [number, number, number];
  const byte = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase();
}

/** "#RRGGBB" to [r, g, b] bytes, for textures. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
