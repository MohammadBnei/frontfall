import { describe, expect, it } from "vitest";
import { previewText } from "../src/ui/build-preview.ts";

describe("what a build preview says", () => {
  it("tells a click from a tap to confirm, and keeps the reach of what would go through", () => {
    expect(previewText({ tile: 4 }, false)).toEqual({ ok: true, status: "preview.ok" });
    expect(previewText({ tile: 4, radius: 25 }, true)).toEqual({
      ok: true,
      status: "preview.okTouch",
      radius: 25,
    });
  });

  it("gives the reason a refused click would give, and the word about a lake port", () => {
    expect(previewText({ tile: 4, refused: "gold" }, false)).toEqual({
      ok: false,
      status: "click.gold",
    });
    // A click that would be refused has no reach to show.
    expect(previewText({ tile: 4, refused: "crowded", radius: 25 }, true)).toEqual({
      ok: false,
      status: "click.crowded",
    });
    expect(previewText({ tile: 4, note: "lake" }, false)).toEqual({
      ok: true,
      status: "preview.ok",
      note: "click.lake",
    });
  });

  it("says nothing of a click that has no reason to show", () => {
    expect(previewText({ tile: 4, refused: "over" }, false)).toBeUndefined();
  });
});
