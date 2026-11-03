import { describe, expect, it } from "vitest";
import { onBeatGrid } from "../server/client.ts";

describe("onBeatGrid", () => {
  it("leaves a gap of one beat as it is", () => {
    expect(onBeatGrid(100)).toBe(100);
    expect(onBeatGrid(104)).toBe(104);
  });

  it("measures a gap of two beats, which a normal game leaves every fourth beat, from the second beat", () => {
    expect(onBeatGrid(200)).toBe(100);
    expect(onBeatGrid(230)).toBe(130);
  });

  it("does not excuse a stall longer than two beats", () => {
    expect(onBeatGrid(400)).toBe(300);
  });
});
