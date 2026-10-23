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

/** "#RRGGBB" to [r, g, b] bytes, for textures. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
