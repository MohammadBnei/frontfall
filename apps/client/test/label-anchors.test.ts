import { describe, expect, it } from "vitest";
import { labelAnchors } from "../src/game/label-anchors.ts";

/** A map from rows of digits, 0 for nobody. */
function map(rows: string[]): { owners: Uint16Array; width: number } {
  const width = (rows[0] as string).length;
  return { owners: Uint16Array.from(rows.join(""), Number), width };
}

describe("labelAnchors", () => {
  it("puts a name on the deepest tile of a square", () => {
    const { owners, width } = map(["00000", "01110", "01110", "01110", "00000"]);
    expect(labelAnchors(owners, width, 1)).toEqual([{ player: 1, tile: 12, depth: 2 }]);
  });

  it("keeps the name inside a crescent, whose centre is not its land", () => {
    const { owners, width } = map(["1111111", "1100000", "1100000", "1100000", "1111111"]);
    const [anchor] = labelAnchors(owners, width, 1);
    expect(owners[anchor?.tile ?? -1]).toBe(1);
  });

  it("finds every player and skips those without land", () => {
    const { owners, width } = map(["1100", "1100", "0033"]);
    expect(labelAnchors(owners, width, 3).map((anchor) => anchor.player)).toEqual([1, 3]);
  });

  it("treats the map edges as borders", () => {
    const { owners, width } = map(["111", "111", "111"]);
    expect(labelAnchors(owners, width, 1)).toEqual([{ player: 1, tile: 4, depth: 2 }]);
  });
});
