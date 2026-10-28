import { afterEach, describe, expect, it } from "vitest";
import tokens from "../../../assets/brand/tokens.json" with { type: "json" };
import {
  MAP_COLORS,
  NATION_COLORS,
  NATION_COLOR_COUNT,
  PLAYER_COLORS,
  STRUCTURE_COLORS,
  colorDistance,
  colorOf,
  teamColor,
  hexToRgb,
  nationColor,
  playerColor,
  preferColor,
} from "../src/palette.ts";

describe("palette", () => {
  it("matches the brand tokens", () => {
    expect(PLAYER_COLORS).toEqual(tokens.players);
    expect(MAP_COLORS).toEqual({
      ocean: tokens.map.ocean,
      oceanDeep: tokens.map["ocean-deep"],
      land: tokens.map.land,
      landHigh: tokens.map["land-high"],
    });
    expect(STRUCTURE_COLORS).toEqual({
      fill: tokens.ui.paper,
      building: tokens.ui["slate-300"],
      outline: tokens.ui.ink,
    });
  });

  it("offers at least 16 distinct player colours with unique names", () => {
    expect(PLAYER_COLORS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(PLAYER_COLORS.map((c) => c.hex)).size).toBe(PLAYER_COLORS.length);
    expect(new Set(PLAYER_COLORS.map((c) => c.name)).size).toBe(PLAYER_COLORS.length);
  });

  it("wraps player indices in both directions", () => {
    const count = PLAYER_COLORS.length;
    expect(playerColor(0)).toBe(PLAYER_COLORS[0]);
    expect(playerColor(count)).toBe(PLAYER_COLORS[0]);
    expect(playerColor(-1)).toBe(PLAYER_COLORS[count - 1]);
  });

  it("converts hex to bytes", () => {
    expect(hexToRgb("#0E2233")).toEqual([14, 34, 51]);
    expect(hexToRgb("#FFFFFF")).toEqual([255, 255, 255]);
  });

  it("gives every nation of World a tone of its own, far from the players and the map", () => {
    expect(NATION_COLORS).toHaveLength(NATION_COLOR_COUNT);
    const nations = NATION_COLORS.map(hexToRgb);
    const others = [...PLAYER_COLORS.map((c) => c.hex), ...Object.values(MAP_COLORS)].map(hexToRgb);
    for (const [i, nation] of nations.entries()) {
      for (const other of nations.slice(i + 1)) {
        expect(colorDistance(nation, other)).toBeGreaterThanOrEqual(25);
      }
      for (const other of others) expect(colorDistance(nation, other)).toBeGreaterThanOrEqual(25);
    }
  });

  it("colours nations from the first nation's id on", () => {
    expect(colorOf(1, 4)).toBe(PLAYER_COLORS[0]?.hex);
    expect(colorOf(4, 4)).toBe(NATION_COLORS[0]);
    expect(nationColor(NATION_COLOR_COUNT)).toBe(NATION_COLORS[0]);
  });

  it("gives teammates shades of one colour, and other teams other colours (R-MODE-02)", () => {
    const teams = [0, 1, 2, 1, 2];
    const shades = [1, 2, 3, 4].map((id) => colorOf(id, 99, teams));
    expect(new Set(shades).size).toBe(4);
    expect(shades[0]).toBe(teamColor(1, 0));
    expect(shades[2]).toBe(teamColor(1, 1));
    expect(shades[1]).toBe(teamColor(2, 0));
    expect(colorOf(1, 99, [])).toBe(PLAYER_COLORS[0]?.hex);
  });
});

describe("the colour a player asks for", () => {
  afterEach(() => {
    preferColor(1, undefined);
  });

  it("changes nothing until a colour is asked for", () => {
    expect(colorOf(1, 100)).toBe(PLAYER_COLORS[0]?.hex);
  });

  it("swaps with whoever would have had it, so no two players share a colour", () => {
    preferColor(1, 2);
    expect(colorOf(1, 100)).toBe(PLAYER_COLORS[2]?.hex);
    expect(colorOf(3, 100)).toBe(PLAYER_COLORS[0]?.hex);
    expect(colorOf(2, 100)).toBe(PLAYER_COLORS[1]?.hex);
    const colors = Array.from({ length: 20 }, (_, i) => colorOf(i + 1, 100));
    expect(new Set(colors).size).toBe(20);
  });

  it("leaves nations and teams alone", () => {
    const plain = colorOf(100, 100);
    const team = colorOf(1, 100, [0, 1, 1]);
    preferColor(1, 2);
    expect(colorOf(100, 100)).toBe(plain);
    expect(colorOf(1, 100, [0, 1, 1])).toBe(team);
  });

  it("is cleared by undefined", () => {
    preferColor(1, 2);
    preferColor(1, undefined);
    expect(colorOf(1, 100)).toBe(PLAYER_COLORS[0]?.hex);
  });
});

describe("palette under colour blindness", () => {
  // Machado et al. (2009), full severity, on linear RGB.
  const SIMULATIONS = {
    protanopia: [
      [0.152286, 1.052583, -0.204868],
      [0.114503, 0.786281, 0.099216],
      [-0.003882, -0.048116, 1.051998],
    ],
    deuteranopia: [
      [0.367322, 0.860646, -0.227968],
      [0.280085, 0.672501, 0.047413],
      [-0.01182, 0.04294, 0.968881],
    ],
    tritanopia: [
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.3039],
    ],
  } as const;

  const linear = (byte: number) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  /** CIELAB of a colour as the map shows it: 84 % of the owner's colour over the land. */
  function seen(hex: string, matrix?: readonly (readonly number[])[]): number[] {
    const ground = hexToRgb(MAP_COLORS.land).map(linear);
    let rgb = hexToRgb(hex).map((byte, i) => 0.84 * linear(byte) + 0.16 * (ground[i] ?? 0));
    if (matrix) {
      rgb = matrix.map((row) =>
        Math.min(
          1,
          Math.max(
            0,
            row.reduce((sum, w, i) => sum + w * (rgb[i] ?? 0), 0),
          ),
        ),
      );
    }
    const [r = 0, g = 0, b = 0] = rgb;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  it("keeps the first eight players apart under every common form", () => {
    const first = PLAYER_COLORS.slice(0, 8);
    for (const [form, matrix] of Object.entries(SIMULATIONS)) {
      for (const [i, a] of first.entries()) {
        for (const b of first.slice(i + 1)) {
          const gap = colorDistance(seen(a.hex, matrix), seen(b.hex, matrix));
          expect(gap, `${a.name} and ${b.name} under ${form}`).toBeGreaterThanOrEqual(9);
        }
      }
    }
  });
});
