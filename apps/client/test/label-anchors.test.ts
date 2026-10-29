import { describe, expect, it } from "vitest";
import { labelAnchors, labelSpace } from "../src/game/label-anchors.ts";

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

describe("labelSpace", () => {
  it("lists the runs of tiles that can be owned, row by row", () => {
    const land = "0110" + "1001" + "0000";
    const space = labelSpace(4, 3, (tile) => land[tile] === "1");
    expect(Array.from(space.runs)).toEqual([1, 3, 4, 5, 7, 8]);
    expect(Array.from(space.rowRuns)).toEqual([0, 1, 3, 3]);
  });

  it("finds the same anchors as a search over every tile", () => {
    const rows = ["0111000222", "1111102222", "0111002220", "0000033300", "3333333330"];
    const { owners, width } = map(rows);
    // Water where nobody owns: the space leaves it out, borders and all.
    const space = labelSpace(width, rows.length, (tile) => owners[tile] !== 0);
    expect(labelAnchors(owners, width, 3, space)).toEqual(labelAnchors(owners, width, 3));
  });

  it("keeps runs apart: land across water is another run, not a neighbour", () => {
    const { owners, width } = map(["11011"]);
    const space = labelSpace(width, 1, (tile) => owners[tile] !== 0);
    expect(labelAnchors(owners, width, 1, space)).toEqual([{ player: 1, tile: 0, depth: 1 }]);
  });
});
