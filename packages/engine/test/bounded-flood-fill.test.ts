import { describe, expect, it } from "vitest";
import { BoundedFloodFill } from "../src/territory/bounded-flood-fill.ts";
import { WorldGrid } from "../src/world-grid.ts";

/** Builds a grid from rows of "#" (blocked) and "." (open). */
function parse(rows: string[]): { grid: WorldGrid; open: (tile: number) => boolean } {
  const grid = new WorldGrid((rows[0] as string).length, rows.length);
  const cells = rows.join("");
  return { grid, open: (tile) => cells[tile] === "." };
}

describe("BoundedFloodFill", () => {
  it("finds an enclosed pocket", () => {
    const { grid, open } = parse(["######", "#..#..", "#..###", "######"]);
    const fill = new BoundedFloodFill(grid);
    expect(fill.fill(grid.index(1, 1), open, 10)).toBe(4);
    expect(Array.from(fill.tiles()).sort((a, b) => a - b)).toEqual([7, 8, 13, 14]);
  });

  it("crosses the east-west seam", () => {
    const { grid, open } = parse(["######", ".####.", "######"]);
    const fill = new BoundedFloodFill(grid);
    expect(fill.fill(grid.index(0, 1), open, 10)).toBe(2);
  });

  it("gives up past its limit", () => {
    const { grid, open } = parse(["......", "......"]);
    const fill = new BoundedFloodFill(grid);
    expect(fill.fill(0, open, 11)).toBe(-1);
    expect(fill.tiles()).toHaveLength(0);
    expect(fill.fill(0, open, 12)).toBe(12);
  });

  it("keeps the tiles it went through when it gives up", () => {
    const { grid, open } = parse(["......", "......"]);
    const fill = new BoundedFloodFill(grid);
    fill.fill(0, open, 5);
    expect(fill.reached()).toHaveLength(5);
    fill.fill(0, open, 20);
    expect(fill.reached()).toHaveLength(12);
  });

  it("stops at once when asked from the acceptance test", () => {
    const { grid, open } = parse(["......", "......"]);
    const fill = new BoundedFloodFill(grid);
    const seen: number[] = [];
    const result = fill.fill(
      0,
      (tile) => {
        seen.push(tile);
        if (tile === 2) fill.stop();
        return open(tile);
      },
      20,
    );
    expect(result).toBe(-1);
    expect(fill.tiles()).toHaveLength(0);
    expect(seen).not.toContain(3);
    // The next fill starts afresh.
    expect(fill.fill(0, open, 20)).toBe(12);
  });

  it("returns nothing when the start is not accepted", () => {
    const { grid, open } = parse(["#."]);
    expect(new BoundedFloodFill(grid).fill(0, open, 5)).toBe(0);
  });

  it("grows its queue for large regions and keeps it", () => {
    const grid = new WorldGrid(100, 100);
    const fill = new BoundedFloodFill(grid);
    expect(fill.fill(0, () => true, grid.size)).toBe(grid.size);
    expect(fill.tiles()).toHaveLength(grid.size);
    expect(fill.memoryBytes()).toBe(grid.size * 2 + grid.size * 4);
  });

  it("stays correct across many fills", () => {
    const { grid, open } = parse(["..#.#", "..#.#"]);
    const fill = new BoundedFloodFill(grid);
    for (let i = 0; i < 70_000; i++) expect(fill.fill(0, open, 10)).toBe(4);
  });

  it("rejects an invalid limit", () => {
    const { grid, open } = parse([".."]);
    expect(() => new BoundedFloodFill(grid).fill(0, open, 0)).toThrow(RangeError);
  });
});
