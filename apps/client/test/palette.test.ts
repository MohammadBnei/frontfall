import { describe, expect, it } from "vitest";
import tokens from "../../../assets/brand/tokens.json" with { type: "json" };
import {
  MAP_COLORS,
  PLAYER_COLORS,
  STRUCTURE_COLORS,
  hexToRgb,
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
});
