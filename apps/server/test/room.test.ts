import { parseServerMessage, type Frame, type ServerMessage } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import { Room, type Peer, type RoomObserver, type RoomSettings, type Seat } from "../src/room.ts";

const PUBLIC: RoomSettings = {
  visibility: "public",
  map: "world",
  capacity: 4,
  bots: 0,
  minPlayers: 2,
  countdownMs: 10_000,
  reconnectGraceMs: 60_000,
  maxDurationMs: 3_600_000,
};
const PRIVATE: RoomSettings = { ...PUBLIC, visibility: "private" };

class FakePeer implements Peer {
  readonly inbox: ServerMessage[] = [];
  probes = 0;

  send(frame: Frame): void {
    const parsed = parseServerMessage(frame);
    if (!parsed.ok) throw new Error(parsed.error);
    this.inbox.push(parsed.value);
  }

  probe(): void {
    this.probes++;
  }

  last<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> {
    const found = this.inbox.filter((message) => message.type === type).at(-1);
    if (!found) throw new Error(`no ${type} message`);
    return found as Extract<ServerMessage, { type: T }>;
  }

  turns(): { tick: number; orders: unknown[] }[] {
    return this.inbox.flatMap((message) => (message.type === "turns" ? message.turns : []));
  }
}

function seated(room: Room, name: string, now = 0): { seat: Seat; peer: FakePeer } {
  const peer = new FakePeer();
  const seat = room.join(name, peer, now);
  if (typeof seat === "string") throw new Error(seat);
  return { seat, peer };
}

function events(): RoomObserver & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    started: () => log.push("started"),
    finished: (_room, reason) => log.push(`finished:${reason}`),
    desync: (_room, tick) => log.push(`desync:${String(tick)}`),
  };
}

describe("public lobby", () => {
  it("waits for the minimum, counts down, then starts with the same seed for all", () => {
    const observer = events();
    const room = new Room("game0000", PUBLIC, 42, observer);
    const alice = seated(room, "Alice", 0);
    expect(room.state).toBe("open");
    expect(alice.peer.last("lobby").startsIn).toBeNull();

    const bob = seated(room, "Bob", 1_000);
    expect(room.state).toBe("starting");
    expect(alice.peer.last("lobby")).toMatchObject({
      players: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
      you: 1,
      host: null,
      startsIn: 10_000,
    });
    expect(room.startsIn(6_000)).toBe(5_000);

    room.update(10_999);
    expect(room.state).toBe("starting");
    room.update(11_000);
    expect(room.state).toBe("running");
    expect(observer.log).toEqual(["started"]);
    for (const { peer } of [alice, bob]) {
      expect(peer.last("started")).toMatchObject({ seed: 42, tickRate: 10, bots: 0 });
    }
    expect(bob.peer.last("started").you).toBe(2);
  });

  it("starts at once when the game fills up", () => {
    const room = new Room("game0000", PUBLIC, 1);
    for (const name of ["A", "B", "C", "D"]) seated(room, name);
    expect(room.state).toBe("running");
    expect(room.join("E", new FakePeer(), 0)).toBe("game_started");
  });

  it("refuses players beyond the capacity", () => {
    const room = new Room("game0000", PRIVATE, 1);
    for (const name of ["A", "B", "C", "D"]) seated(room, name);
    expect(room.join("E", new FakePeer(), 0)).toBe("game_full");
  });

  it("stops the countdown when a player leaves below the minimum", () => {
    const room = new Room("game0000", PUBLIC, 1);
    const alice = seated(room, "Alice");
    const bob = seated(room, "Bob");
    expect(room.state).toBe("starting");
    room.leave(bob.seat, 5_000);
    expect(room.state).toBe("open");
    expect(alice.peer.last("lobby")).toMatchObject({ startsIn: null, players: [{ id: 1 }] });
    room.update(20_000);
    expect(room.state).toBe("open");
  });

  it("keeps counting when a player leaves above the minimum", () => {
    const room = new Room("game0000", PUBLIC, 1);
    seated(room, "A", 0);
    seated(room, "B", 0);
    const carol = seated(room, "C", 2_000);
    room.leave(carol.seat, 3_000);
    expect(room.startsIn(3_000)).toBe(7_000);
  });

  it("gives final player numbers in join order at the start", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const a = seated(room, "A");
    const b = seated(room, "B");
    const c = seated(room, "C");
    room.leave(b.seat, 0);
    expect(room.requestStart(a.seat, 0)).toBeUndefined();
    expect(c.peer.last("started")).toMatchObject({
      you: 2,
      players: [
        { id: 1, name: "A" },
        { id: 2, name: "C" },
      ],
    });
  });

  it("finishes when the last player leaves before the start", () => {
    const observer = events();
    const room = new Room("game0000", PUBLIC, 1, observer);
    const alice = seated(room, "Alice");
    room.leave(alice.seat, 0);
    expect(room.state).toBe("finished");
    expect(observer.log).toEqual(["finished:empty"]);
    expect(room.join("Bob", new FakePeer(), 0)).toBe("game_started");
  });
});

describe("private lobby", () => {
  it("starts only when the host asks", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    room.update(1_000_000);
    expect(room.state).toBe("open");
    expect(guest.peer.last("lobby")).toMatchObject({ host: 1, startsIn: null });
    expect(room.requestStart(guest.seat, 0)).toBe("not_host");
    expect(room.requestStart(host.seat, 0)).toBeUndefined();
    expect(room.state).toBe("running");
    expect(room.requestStart(host.seat, 0)).toBe("game_started");
  });

  it("hands the host role to the next player", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    room.leave(host.seat, 0);
    expect(guest.peer.last("lobby").host).toBe(2);
    expect(room.requestStart(host.seat, 0)).toBe("not_in_game");
    expect(room.requestStart(guest.seat, 0)).toBeUndefined();
  });
});

function running(settings = PRIVATE) {
  const observer = events();
  const room = new Room("game0000", settings, 7, observer);
  const alice = seated(room, "Alice");
  const bob = seated(room, "Bob");
  room.requestStart(alice.seat, 0);
  return { room, alice, bob, observer };
}

describe("running game", () => {
  it("relays orders in turns numbered from zero, in arrival order", () => {
    const { room, alice, bob } = running();
    room.update(100);
    expect(room.submit(bob.seat, { type: "spawn", tile: 2 })).toBe(true);
    expect(room.submit(alice.seat, { type: "spawn", tile: 1 })).toBe(true);
    room.update(200);
    const expected = [
      { tick: 0, orders: [] },
      {
        tick: 1,
        orders: [
          { player: 2, order: { type: "spawn", tile: 2 } },
          { player: 1, order: { type: "spawn", tile: 1 } },
        ],
      },
    ];
    expect(alice.peer.turns()).toEqual(expected);
    expect(bob.peer.turns()).toEqual(expected);
    expect(room.log.length).toBe(2);
  });

  it("ignores orders before the start and from players who left", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const alice = seated(room, "Alice");
    expect(room.submit(alice.seat, { type: "spawn", tile: 1 })).toBe(false);
    const bob = seated(room, "Bob");
    room.requestStart(alice.seat, 0);
    room.leave(bob.seat, 0);
    expect(room.submit(bob.seat, { type: "spawn", tile: 1 })).toBe(false);
    expect(room.playerCount).toBe(1);
  });

  it("keeps a dropped player's seat and replays the missed turns on rejoin", () => {
    const { room, alice, bob } = running();
    room.update(100);
    room.disconnect(bob.seat, 100);
    expect(room.connectedCount).toBe(1);
    room.submit(alice.seat, { type: "spawn", tile: 5 });
    room.update(200);
    room.update(300);

    const back = new FakePeer();
    expect(room.rejoin(bob.seat, back, 1)).toBeUndefined();
    expect(back.last("started")).toMatchObject({ you: 2, token: bob.seat.token });
    expect(back.turns()).toEqual([
      { tick: 1, orders: [{ player: 1, order: { type: "spawn", tile: 5 } }] },
      { tick: 2, orders: [] },
    ]);
    room.update(400);
    expect(back.turns().at(-1)?.tick).toBe(3);
  });

  it("refuses a token whose seat is still connected, and checks that connection", () => {
    const { room, bob } = running();
    expect(room.rejoin(bob.seat, new FakePeer(), 0)).toBe("token_in_use");
    expect(bob.peer.probes).toBe(1);
  });

  it("frees a seat whose player stays away too long", () => {
    const { room, alice, bob } = running();
    room.disconnect(bob.seat, 0);
    room.update(PRIVATE.reconnectGraceMs);
    expect(room.rejoin(bob.seat, new FakePeer(), 0)).toBe("token_invalid");
    expect(room.seatFor(bob.seat.token)).toBeUndefined();
    expect(room.seatFor(alice.seat.token)).toBe(alice.seat);
  });

  it("ends when every player is gone", () => {
    const { room, alice, bob, observer } = running();
    room.leave(alice.seat, 0);
    room.disconnect(bob.seat, 0);
    room.update(1_000);
    expect(room.state).toBe("running");
    room.update(PRIVATE.reconnectGraceMs);
    expect(room.state).toBe("finished");
    expect(observer.log).toContain("finished:abandoned");
  });

  it("ends a game that runs too long", () => {
    const { room, alice, observer } = running();
    room.update(PRIVATE.maxDurationMs);
    expect(room.state).toBe("finished");
    expect(alice.peer.last("ended").reason).toBe("timeout");
    expect(observer.log).toContain("finished:timeout");
    expect(room.holds(alice.seat)).toBe(false);
  });

  it("stops at once on request", () => {
    const { room, bob } = running();
    room.stop();
    expect(bob.peer.last("ended").reason).toBe("abandoned");
    room.stop();
    expect(room.state).toBe("finished");
  });
});

describe("desync detection", () => {
  it("flags the first tick where two clients disagree, once", () => {
    const { room, alice, bob, observer } = running();
    for (let now = 100; now <= 6_000; now += 100) room.update(now);
    room.reportHash(alice.seat, 50, 1234);
    room.reportHash(bob.seat, 50, 1234);
    expect(room.desynced).toBe(false);
    room.reportHash(alice.seat, 55, 1);
    room.reportHash(bob.seat, 55, 2);
    room.reportHash(bob.seat, 55, 3);
    expect(room.desynced).toBe(true);
    expect(alice.peer.last("desync").tick).toBe(55);
    expect(observer.log.filter((entry) => entry.startsWith("desync"))).toEqual(["desync:55"]);

    room.disconnect(bob.seat, 6_000);
    const back = new FakePeer();
    room.rejoin(bob.seat, back, 60);
    expect(back.last("desync").tick).toBe(55);
  });

  it("ignores hashes of ticks that have not been sent yet", () => {
    const { room, alice, bob } = running();
    room.reportHash(alice.seat, 0, 1);
    room.update(100);
    room.reportHash(bob.seat, 0, 2);
    room.reportHash(alice.seat, 0, 3);
    expect(room.desynced).toBe(true);
  });

  it("keeps a bounded number of hashes", () => {
    const { room, alice, bob } = running();
    for (let now = 100; now <= 30_000; now += 100) room.update(now);
    for (let tick = 0; tick < 300; tick++) room.reportHash(alice.seat, tick, tick);
    // Tick 0 was forgotten, so a different hash for it cannot be compared.
    room.reportHash(bob.seat, 0, 999);
    expect(room.desynced).toBe(false);
    room.reportHash(bob.seat, 299, 999);
    expect(room.desynced).toBe(true);
  });
});
