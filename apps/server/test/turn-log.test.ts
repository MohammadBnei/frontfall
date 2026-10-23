import { decodeFrame } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import { TurnLog } from "../src/turn-log.ts";

describe("TurnLog", () => {
  it("replays any suffix of the game, split into frames", () => {
    const log = new TurnLog();
    for (let tick = 0; tick < 10_000; tick++) {
      log.append(tick % 7 === 0 ? [{ player: 1, order: { type: "spawn", tile: tick } }] : []);
    }
    expect(log.length).toBe(10_000);

    const frames = [...log.frames(1_234, 4_000)];
    expect(frames).toHaveLength(3);
    const turns = frames.flatMap((frame) => {
      const decoded = decodeFrame(frame);
      return decoded.kind === "turns" ? decoded.turns : [];
    });
    expect(turns.map((turn) => turn.tick)).toEqual(
      Array.from({ length: 10_000 - 1_234 }, (_, index) => 1_234 + index),
    );
    expect(turns[1_239 - 1_234]?.orders).toEqual([
      { player: 1, order: { type: "spawn", tile: 1_239 } },
    ]);
  });

  it("has nothing to send past its end", () => {
    const log = new TurnLog();
    log.append([]);
    expect([...log.frames(1)]).toEqual([]);
  });

  it("stores an hour of quiet turns in well under a megabyte", () => {
    const log = new TurnLog();
    for (let tick = 0; tick < 36_000; tick++) log.append([]);
    expect(log.byteLength).toBeLessThan(400_000);
  });
});
