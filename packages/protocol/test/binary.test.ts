import { describe, expect, it } from "vitest";
import {
  ByteReader,
  ByteWriter,
  DecodeError,
  FrameKind,
  decodeFrame,
  encodeOrderFrame,
  encodeTurnBody,
  encodeTurnsFrame,
} from "../src/binary.ts";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("varint", () => {
  it.each([0, 1, 127, 128, 300, 2 ** 31, 2 ** 32 + 5, Number.MAX_SAFE_INTEGER])(
    "round-trips %d",
    (value) => {
      const reader = new ByteReader(new ByteWriter().varint(value).finish());
      expect(reader.varint()).toBe(value);
      reader.end();
    },
  );

  it("uses one byte below 128 and two up to 16383", () => {
    expect(new ByteWriter().varint(127).finish()).toEqual(bytes(127));
    expect(new ByteWriter().varint(16_383).finish()).toEqual(bytes(0xff, 0x7f));
  });

  it("refuses values it cannot represent", () => {
    expect(() => new ByteWriter().varint(-1)).toThrow(RangeError);
    expect(() => new ByteWriter().varint(1.5)).toThrow(RangeError);
    expect(() => new ByteWriter().varint(2 ** 53)).toThrow(RangeError);
  });

  it("rejects truncated, padded and oversized values", () => {
    expect(() => new ByteReader(bytes(0x80)).varint()).toThrow(DecodeError);
    expect(() => new ByteReader(bytes(0x81, 0x00)).varint()).toThrow("minimally");
    expect(() => new ByteReader(bytes(...Array<number>(8).fill(0xff), 1)).varint()).toThrow(
      "too large",
    );
    expect(() =>
      new ByteReader(bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f)).varint(),
    ).toThrow("too large");
  });

  it("grows its buffer for long frames", () => {
    const writer = new ByteWriter();
    for (let index = 0; index < 1000; index++) writer.varint(2 ** 40);
    expect(writer.finish().length).toBe(6000);
  });
});

describe("frames", () => {
  it("decodes an order frame", () => {
    expect(decodeFrame(encodeOrderFrame({ type: "attack", target: 5, troops: 6 }))).toEqual({
      kind: "order",
      order: { type: "attack", target: 5, troops: 6 },
    });
  });

  it("carries a retreat with its attack id", () => {
    expect(decodeFrame(encodeOrderFrame({ type: "retreat", attack: 3 }))).toEqual({
      kind: "order",
      order: { type: "retreat", attack: 3 },
    });
  });

  it("numbers decoded turns from the first tick", () => {
    const frame = encodeTurnsFrame(41, [
      encodeTurnBody([]),
      encodeTurnBody([{ player: 3, order: { type: "spawn", tile: 2 } }]),
    ]);
    expect(decodeFrame(frame)).toEqual({
      kind: "turns",
      turns: [
        { tick: 41, orders: [] },
        { tick: 42, orders: [{ player: 3, order: { type: "spawn", tile: 2 } }] },
      ],
    });
  });

  it("rejects unknown frames and orders", () => {
    expect(() => decodeFrame(bytes())).toThrow("ends early");
    expect(() => decodeFrame(bytes(9))).toThrow("unknown frame kind");
    expect(() => decodeFrame(bytes(FrameKind.order, 99))).toThrow("unknown order type");
  });

  it("validates decoded values", () => {
    // Attack with zero troops.
    expect(() => decodeFrame(bytes(FrameKind.order, 1, 5, 0))).toThrow(DecodeError);
    // Player number zero.
    expect(() => decodeFrame(bytes(FrameKind.turns, 0, 1, 1, 0, 0, 5))).toThrow(DecodeError);
    // Tile beyond 2^31 - 1.
    expect(() =>
      decodeFrame(
        new ByteWriter()
          .byte(FrameKind.order)
          .varint(0)
          .varint(2 ** 31)
          .finish(),
      ),
    ).toThrow(DecodeError);
  });

  it("rejects trailing bytes", () => {
    const frame = encodeOrderFrame({ type: "spawn", tile: 1 });
    expect(() => decodeFrame(bytes(...frame, 0))).toThrow("unexpected bytes");
  });

  it("rejects counts larger than the frame could hold before allocating", () => {
    const frame = new ByteWriter().byte(FrameKind.turns).varint(0).varint(1_000_000_000).finish();
    expect(() => decodeFrame(frame)).toThrow("count exceeds the frame");
  });

  it("refuses to encode unknown orders", () => {
    expect(() => encodeOrderFrame({ type: "nuke" } as never)).toThrow(RangeError);
  });
});
