import { describe, expect, it } from "vitest";
import type { BoatView, GameUpdate } from "../src/game/game-view.ts";
import { threatLines } from "../src/ui/threats.ts";

const YOU = 1;

function update(boats: BoatView[], incoming: GameUpdate["incoming"] = []): GameUpdate {
  return {
    you: YOU,
    players: [
      { id: 1, name: "Commander" },
      { id: 2, name: "Aldmere" },
      { id: 3, name: "Brask" },
    ],
    boats,
    incoming,
  } as unknown as GameUpdate;
}

const boat = (id: number, player: number, target: number, ticksLeft: number): BoatView => ({
  id,
  player,
  tile: 100 + id,
  troops: 1500,
  target,
  ticksLeft,
});

describe("threatLines", () => {
  it("lists the player's own ships with cargo, target and time left", () => {
    const lines = threatLines(update([boat(7, YOU, 2, 95)]), 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ key: "boat:7", kind: "boatOut", target: { tile: 107 } });
    expect(lines[0]?.text).toContain("Aldmere");
    expect(lines[0]?.text).toContain("1,500");
  });

  it("shows an enemy ship bound for the player's land, and none bound elsewhere", () => {
    const lines = threatLines(
      update([boat(8, 2, YOU, 40), boat(9, 2, 3, 40), boat(10, 3, 2, 40)]),
      10,
    );
    expect(lines.map((line) => [line.key, line.kind])).toEqual([["boat:8", "boatIn"]]);
    expect(lines[0]?.text).toContain("Aldmere");
  });

  it("follows a ship as it sails: the time left and the click target change with it", () => {
    const early = threatLines(update([boat(7, YOU, 2, 95)]), 10)[0];
    const late = threatLines(update([{ ...boat(7, YOU, 2, 20), tile: 555 }]), 10)[0];
    expect(late?.key).toBe(early?.key);
    expect(late?.text).not.toBe(early?.text);
    expect(late?.target).toEqual({ tile: 555 });
  });

  it("puts attacks on the player first, with a Counter", () => {
    const lines = threatLines(
      update([boat(7, YOU, 2, 95)], [
        { id: 3, attacker: 3, troops: 800 },
      ] as GameUpdate["incoming"]),
      10,
    );
    expect(lines.map((line) => line.kind)).toEqual(["incoming", "boatOut"]);
    expect(lines[0]?.counter).toMatchObject({ attacker: 3, troops: 800 });
    expect(lines[0]?.target).toEqual({ player: 3 });
  });

  it("is empty with nothing at sea and nobody attacking", () => {
    expect(threatLines(update([]), 10)).toEqual([]);
  });
});
