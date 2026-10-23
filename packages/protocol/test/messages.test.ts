import { describe, expect, it } from "vitest";
import {
  encodeClientMessage,
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/messages.ts";

const CLIENT_MESSAGES: ClientMessage[] = [
  { type: "hello", version: 1, name: "Nico" },
  { type: "hello", version: 1, name: "Nico", build: "0d25e267bbae" },
  { type: "play" },
  { type: "create" },
  { type: "join", game: "Xk3_9aB-q2Lm" },
  { type: "rejoin", token: "0123456789abcdefABCDEF", from: 1200 },
  { type: "start" },
  { type: "leave" },
  { type: "hash", tick: 50, hash: 0xdeadbeef },
  { type: "order", order: { type: "spawn", tile: 4096 } },
  { type: "order", order: { type: "attack", target: 2 ** 31 - 1, troops: 2 ** 40 } },
];

const SERVER_MESSAGES: ServerMessage[] = [
  { type: "welcome", version: 1 },
  {
    type: "lobby",
    game: "Xk3_9aB-q2Lm",
    visibility: "public",
    map: "world",
    capacity: 16,
    players: [
      { id: 1, name: "Nico" },
      { id: 2, name: "Léa" },
    ],
    you: 2,
    host: null,
    startsIn: 12_000,
  },
  {
    type: "started",
    game: "Xk3_9aB-q2Lm",
    map: "world",
    seed: 123456,
    bots: 0,
    tickRate: 10,
    players: [{ id: 1, name: "Nico" }],
    you: 1,
    token: "0123456789abcdefABCDEF",
  },
  {
    type: "turns",
    turns: [
      { tick: 7, orders: [] },
      {
        tick: 8,
        orders: [
          { player: 2, order: { type: "spawn", tile: 9 } },
          { player: 1, order: { type: "attack", target: 10, troops: 300 } },
        ],
      },
    ],
  },
  { type: "desync", tick: 150 },
  { type: "ended", reason: "abandoned" },
  { type: "error", code: "game_full", message: "the game is full" },
];

describe("client messages", () => {
  it.each(CLIENT_MESSAGES)("round-trips $type", (message) => {
    expect(parseClientMessage(encodeClientMessage(message))).toEqual({ ok: true, value: message });
  });

  it("sends orders as binary frames and everything else as text", () => {
    expect(
      encodeClientMessage({ type: "order", order: { type: "spawn", tile: 1 } }),
    ).toBeInstanceOf(Uint8Array);
    expect(typeof encodeClientMessage({ type: "play" })).toBe("string");
  });

  it("refuses an order sent as text", () => {
    const raw = JSON.stringify({ type: "order", order: { type: "spawn", tile: 1 } });
    expect(parseClientMessage(raw)).toEqual({
      ok: false,
      error: "order must be sent as a binary frame",
    });
  });

  it("refuses a turns frame from a client", () => {
    const frame = encodeServerMessage({ type: "turns", turns: [{ tick: 0, orders: [] }] });
    expect(parseClientMessage(frame)).toEqual({ ok: false, error: "unexpected turns frame" });
  });

  it("rejects malformed JSON without throwing", () => {
    expect(parseClientMessage("{")).toEqual({ ok: false, error: "malformed JSON" });
  });

  it("rejects unknown types and unknown fields", () => {
    expect(parseClientMessage(JSON.stringify({ type: "cheat" })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "play", extra: 1 })).ok).toBe(false);
  });

  it("rejects game ids that could not come from the server", () => {
    expect(parseClientMessage(JSON.stringify({ type: "join", game: "../x" })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "join", game: "a".repeat(33) })).ok).toBe(
      false,
    );
  });

  it("accepts a hello from any version, so the server can report the mismatch", () => {
    const raw = JSON.stringify({ type: "hello", version: 99, name: "x", future: true });
    expect(parseClientMessage(raw).ok).toBe(true);
  });
});

describe("server messages", () => {
  it.each(SERVER_MESSAGES)("round-trips $type", (message) => {
    expect(parseServerMessage(encodeServerMessage(message))).toEqual({ ok: true, value: message });
  });

  it("refuses turns that are not consecutive", () => {
    expect(() =>
      encodeServerMessage({
        type: "turns",
        turns: [
          { tick: 1, orders: [] },
          { tick: 3, orders: [] },
        ],
      }),
    ).toThrow(RangeError);
  });

  it("refuses an order frame from the server", () => {
    const frame = encodeClientMessage({ type: "order", order: { type: "spawn", tile: 1 } });
    expect(parseServerMessage(frame)).toEqual({ ok: false, error: "unexpected order frame" });
  });

  it("encodes a turn of 32 orders at least 3 times smaller than JSON", () => {
    const orders = Array.from({ length: 32 }, (_, index) => ({
      player: index + 1,
      order:
        index % 2 === 0
          ? { type: "spawn" as const, tile: 1_000_000 + index * 977 }
          : { type: "attack" as const, target: 2_000_000 + index * 131, troops: 25_000 + index },
    }));
    const message: ServerMessage = { type: "turns", turns: [{ tick: 36_000, orders }] };
    const binary = encodeServerMessage(message);
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(binary.length * 3).toBeLessThanOrEqual(JSON.stringify(message).length);
  });
});
