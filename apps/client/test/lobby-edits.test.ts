import { describe, expect, it } from "vitest";
import type { GameOptions } from "@frontfall/protocol";
import { PendingEdits } from "../src/ui/lobby-edits.ts";

const options: GameOptions = {
  map: "world",
  bots: 4,
  difficulty: "normal",
  nations: true,
  teams: 0,
  disabled: 0,
};

describe("the host's lobby settings", () => {
  it("are not undone by a lobby the server sent before the last change", () => {
    const edits = new PendingEdits(3_000);
    edits.send({ ...options, bots: 0 }, 0);
    edits.send({ ...options, bots: 0, difficulty: "hard" }, 10);
    // The answer to the first change arrives after the second one.
    expect(edits.accepts({ ...options, bots: 0 }, 60)).toBe(false);
    expect(edits.accepts({ ...options, bots: 0, difficulty: "hard" }, 110)).toBe(true);
    // Answered: the server's next lobby goes into the controls again.
    expect(edits.accepts(options, 120)).toBe(true);
  });

  it("give way to the server after a while, when it changed them", () => {
    const edits = new PendingEdits(3_000);
    edits.send({ ...options, bots: 40 }, 0);
    expect(edits.expired(2_999)).toBe(false);
    expect(edits.accepts({ ...options, bots: 30 }, 2_999)).toBe(false);
    expect(edits.expired(3_000)).toBe(true);
    expect(edits.accepts({ ...options, bots: 30 }, 3_000)).toBe(true);
    expect(edits.expired(4_000)).toBe(false);
  });

  it("let every lobby through while the host has changed nothing", () => {
    expect(new PendingEdits().accepts(options, 0)).toBe(true);
  });
});
