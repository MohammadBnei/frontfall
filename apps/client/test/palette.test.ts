import { describe, expect, it } from "vitest";
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
