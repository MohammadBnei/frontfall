import { parseServerMessage, type Frame, type ServerMessage } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import { Room, type Peer, type RoomObserver, type RoomSettings, type Seat } from "../src/room.ts";

const PUBLIC: RoomSettings = {
  visibility: "public",
  map: "world",
  capacity: 4,
  bots: 0,
  difficulty: "normal",
  nations: true,
  teams: 0,
  minPlayers: 2,
  countdownMs: 10_000,
  reconnectGraceMs: 60_000,
  maxDurationMs: 3_600_000,
  lobbyTimeoutMs: 600_000,
  maxOrdersPerTurn: 3,
  maxLogBytes: 1_000_000,
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
    desync: (_room, tick, hash, expected) =>
      log.push(`desync:${String(tick)}:${String(hash)}:${String(expected)}`),
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

describe("lobby timeout", () => {
  it("closes a game that never starts", () => {
    const observer = events();
    const room = new Room("game0000", PRIVATE, 1, observer);
    const host = seated(room, "Host", 1_000);
    room.update(PRIVATE.lobbyTimeoutMs);
    expect(room.state).toBe("open");
    room.update(PRIVATE.lobbyTimeoutMs + 1_000);
    expect(room.state).toBe("finished");
    expect(host.peer.last("ended").reason).toBe("expired");
    expect(observer.log).toEqual(["finished:expired"]);
  });
});

describe("private lobby", () => {
  it("starts only when the host asks", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    room.update(60_000);
    expect(room.state).toBe("open");
    expect(guest.peer.last("lobby")).toMatchObject({ host: 1, startsIn: null });
    expect(room.requestStart(guest.seat, 0)).toBe("not_host");
    expect(room.requestStart(host.seat, 0)).toBeUndefined();
    expect(room.state).toBe("running");
    expect(room.requestStart(host.seat, 0)).toBe("game_started");
  });

  it("lets the host alone change the game before it starts", () => {
    const room = new Room("game0000", PRIVATE, 1);
    const host = seated(room, "Host");
    const guest = seated(room, "Guest");
    const options = {
      map: "europe",
      bots: 5,
      difficulty: "easy",
      nations: false,
      teams: 0,
      capacity: 6,
    } as const;
    expect(room.configure(guest.seat, options, 0)).toBe("not_host");
    expect(room.configure(host.seat, options, 0)).toBeUndefined();
    expect(guest.peer.last("lobby")).toMatchObject(options);
    expect(PRIVATE.map).toBe("world");
    room.requestStart(host.seat, 0);
    expect(guest.peer.last("started")).toMatchObject({
      map: "europe",
      bots: 5,
      difficulty: "easy",
      nations: false,
      teams: 0,
    });
    expect(room.configure(host.seat, options, 0)).toBe("game_started");
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

  it("drops orders beyond the cap of one player in one turn", () => {
    const { room, alice, bob } = running();
    for (let tile = 0; tile < 5; tile++) room.submit(alice.seat, { type: "spawn", tile });
    expect(room.submit(bob.seat, { type: "spawn", tile: 9 })).toBe(true);
    room.update(100);
    expect(alice.peer.turns()[0]?.orders).toHaveLength(4);
    expect(room.submit(alice.seat, { type: "spawn", tile: 1 })).toBe(true);
  });

  it("stops a game whose turn log grows too large", () => {
    const { room, alice } = running({ ...PRIVATE, maxLogBytes: 10_000 });
    for (let now = 100; now <= 300_000 && room.state === "running"; now += 100) {
      room.submit(alice.seat, { type: "attack", target: 2 ** 30, troops: 2 ** 40 });
      room.update(now);
    }
    expect(room.state).toBe("finished");
    expect(alice.peer.last("ended").reason).toBe("timeout");
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
  function threePlayers() {
    const observer = events();
    const room = new Room("game0000", PRIVATE, 7, observer);
    const players = ["A", "B", "C"].map((name) => seated(room, name));
    const [a] = players;
    if (!a) throw new Error("no host");
    room.requestStart(a.seat, 0);
    for (let now = 100; now <= 20_000; now += 100) room.update(now);
    return { room, players, observer };
  }

  it("flags only the player whose hash differs from the majority", () => {
    const { room, players, observer } = threePlayers();
    const [a, b, c] = players;
    if (!a || !b || !c) throw new Error("missing player");
    room.reportHash(a.seat, 50, 1234);
    room.reportHash(b.seat, 50, 1234);
    room.reportHash(c.seat, 50, 1234);
    expect(room.desynced).toBe(false);

    room.reportHash(a.seat, 100, 7);
    room.reportHash(b.seat, 100, 7);
    expect(room.desynced).toBe(false);
    room.reportHash(c.seat, 100, 8);
    expect(room.desynced).toBe(true);
    expect(c.peer.last("desync")).toEqual({ type: "desync", tick: 100, hash: 8, expected: 7 });
    expect(a.peer.inbox.some((message) => message.type === "desync")).toBe(false);
    expect(observer.log.filter((entry) => entry.startsWith("desync"))).toEqual(["desync:100:8:7"]);

    room.disconnect(c.seat, 20_000);
    const back = new FakePeer();
    room.rejoin(c.seat, back, 150);
    expect(back.last("desync")).toMatchObject({ tick: 100, hash: 8, expected: 7 });
  });

  it("cannot be used by one client to flag the others", () => {
    const { room, players } = threePlayers();
    const [a, b, c] = players;
    if (!a || !b || !c) throw new Error("missing player");
    room.reportHash(c.seat, 50, 666);
    room.reportHash(c.seat, 50, 1);
    room.reportHash(a.seat, 50, 1);
    room.reportHash(b.seat, 50, 1);
    expect(c.peer.last("desync").tick).toBe(50);
    expect(a.peer.inbox.some((message) => message.type === "desync")).toBe(false);
  });

  it("flags both players of a split without a majority", () => {
    const { room, alice, bob } = running();
    for (let now = 100; now <= 6_000; now += 100) room.update(now);
    room.reportHash(alice.seat, 50, 1);
    room.reportHash(bob.seat, 50, 2);
    expect(alice.peer.last("desync")).toMatchObject({ tick: 50, hash: 1, expected: null });
    expect(bob.peer.last("desync").tick).toBe(50);
  });

  it("only checks the ticks clients are asked to hash, once they have run", () => {
    const { room, alice, bob } = running();
    room.reportHash(alice.seat, 0, 1);
    room.reportHash(bob.seat, 0, 2);
    expect(room.desynced).toBe(false);
    room.update(100);
    room.reportHash(alice.seat, 0, 1);
    room.reportHash(bob.seat, 0, 2);
    expect(room.desynced).toBe(true);

    const other = running();
    for (let now = 100; now <= 6_000; now += 100) other.room.update(now);
    other.room.reportHash(other.alice.seat, 49, 1);
    other.room.reportHash(other.bob.seat, 49, 2);
    other.room.reportHash(other.alice.seat, 100, 1);
    other.room.reportHash(other.bob.seat, 100, 2);
    expect(other.room.desynced).toBe(false);
  });

  it("compares late hashes without waiting for players who never report", () => {
    const { room, players } = threePlayers();
    const [a, b] = players;
    if (!a || !b) throw new Error("missing player");
    room.reportHash(a.seat, 150, 1);
    room.reportHash(b.seat, 150, 2);
    expect(room.desynced).toBe(false);
    for (let now = 20_100; now <= 80_000; now += 100) room.update(now);
    expect(room.desynced).toBe(true);
    // Too old to be compared any more.
    room.reportHash(a.seat, 200, 1);
    expect(a.peer.inbox.filter((message) => message.type === "desync")).toHaveLength(1);
  });
});
