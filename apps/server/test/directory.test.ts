import { describe, expect, it } from "vitest";
import { Directory } from "../src/directory.ts";
import type { Peer } from "../src/room.ts";
import { DEFAULT_GAME } from "../src/server.ts";

const peer: Peer = { send: () => undefined, probe: () => undefined };

function directory(maxRooms = 10) {
  return new Directory({
    maxRooms,
    publicGame: { ...DEFAULT_GAME, capacity: 2, minPlayers: 2 },
    privateGame: DEFAULT_GAME,
  });
}

describe("Directory", () => {
  it("fills the fullest public game first, then opens another", () => {
    const games = directory();
    const first = games.quickMatch();
    first?.join("A", peer, 0);
    const empty = games.create("public");
    expect(games.quickMatch()).toBe(first);
    first?.join("B", peer, 0);
    expect(first?.state).toBe("running");
    expect(games.quickMatch()).toBe(empty);
  });

  it("lists open public games only", () => {
    const games = directory();
    const open = games.create("public");
    open?.join("A", peer, 0);
    games.create("private")?.join("B", peer, 0);
    expect(games.publicGames(0)).toEqual([
      { id: open?.id, map: "default", players: 1, capacity: 2, startsIn: null },
    ]);
  });

  it("gives every game a different id of at least 64 random bits", () => {
    const games = directory(1000);
    const ids = new Set(Array.from({ length: 1000 }, () => games.create("private")?.id));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("caps the number of games", () => {
    const games = directory(1);
    expect(games.create("private")).toBeDefined();
    expect(games.create("public")).toBeUndefined();
    expect(games.quickMatch()).toBeUndefined();
  });

  it("finds the seat of a running game by token", () => {
    const games = directory();
    const room = games.quickMatch();
    const seat = room?.join("A", peer, 0);
    room?.join("B", peer, 0);
    if (!room || !seat || typeof seat === "string") throw new Error("not seated");
    expect(games.findSeat(seat.token)).toEqual({ room, seat });
    expect(games.findSeat("unknown-token-000")).toBeUndefined();
  });

  it("forgets finished games within one tick", () => {
    const games = directory();
    const room = games.create("private");
    const seat = room?.join("A", peer, 0);
    if (!room || !seat || typeof seat === "string") throw new Error("not seated");
    room.requestStart(seat, 0);
    room.leave(seat, 0);
    games.update(DEFAULT_GAME.reconnectGraceMs);
    expect(games.size).toBe(0);

    games.create("public");
    games.stopAll();
    expect(games.size).toBe(0);
  });
});
