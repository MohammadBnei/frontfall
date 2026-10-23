import { describe, expect, it } from "vitest";
import {
  MAP_HEADER_BYTES,
  MapFileError,
  decodeMapFile,
  encodeMapFile,
  mapFileBytes,
} from "../src/map/map-file.ts";

/** The worked example of docs/map-format.md: a 4 x 2 cylinder. */
const EXAMPLE_HEX =
  "46464d50 0100 0100 04000000 02000000" + // header
  "03 c0 cc 9f" + // row 0: deep water, shore plains, shore hills, ice
  "00 c5 d6 df"; // row 1: shallow water, shore plains, shore mountains, ice on the shore

function hex(text: string): Uint8Array {
  const digits = text.replace(/\s/g, "");
  return Uint8Array.from({ length: digits.length / 2 }, (_, i) =>
    Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16),
  );
}

const example = {
  width: 4,
  height: 2,
  wrapsX: true,
  tiles: Uint8Array.from([0x03, 0xc0, 0xcc, 0x9f, 0x00, 0xc5, 0xd6, 0xdf]),
};

describe("map file", () => {
  it("encodes the worked example of the format document byte for byte", () => {
    expect(encodeMapFile(example)).toEqual(hex(EXAMPLE_HEX));
  });

  it("reads back what it wrote", () => {
    const flat = { ...example, wrapsX: false };
    expect(decodeMapFile(encodeMapFile(flat))).toEqual(flat);
    expect(decodeMapFile(hex(EXAMPLE_HEX))).toEqual(example);
  });

  it("reads a file that sits inside a larger buffer", () => {
    const bytes = hex(EXAMPLE_HEX);
    const outer = new Uint8Array(bytes.length + 3);
    outer.set(bytes, 3);
    expect(decodeMapFile(outer.subarray(3))).toEqual(example);
  });

  it("sizes the file from the header and the tile count", () => {
    expect(mapFileBytes(4, 2)).toBe(MAP_HEADER_BYTES + 8);
  });

  const corrupt = (offset: number, value: number): Uint8Array => {
    const bytes = hex(EXAMPLE_HEX);
    bytes[offset] = value;
    return bytes;
  };

  it.each([
    ["a file shorter than its header", hex("46464d50 0100"), "shorter than its header"],
    ["a wrong magic number", corrupt(0, 0x47), "not a Frontfall map file"],
    ["a newer format version", corrupt(4, 2), "unsupported map format version 2"],
    ["unknown header flags", corrupt(6, 3), "unknown header flags"],
    ["a zero width", corrupt(8, 0), "invalid map size 0x2"],
    ["a truncated tile grid", hex(EXAMPLE_HEX).subarray(0, 23), "a 4x2 map needs 24"],
    ["extra bytes after the grid", Uint8Array.from([...hex(EXAMPLE_HEX), 0]), "is 25 bytes"],
    ["the reserved tile bit", corrupt(16, 0x20), "tile 0 has invalid bits 0x20"],
    ["a shore bit on water", corrupt(17, 0x40), "tile 1 has invalid bits 0x40"],
  ])("refuses %s", (_, bytes, message) => {
    expect(() => decodeMapFile(bytes)).toThrow(MapFileError);
    expect(() => decodeMapFile(bytes)).toThrow(message);
  });

  it("refuses to write a grid that does not match its size", () => {
    expect(() => encodeMapFile({ ...example, tiles: new Uint8Array(7) })).toThrow(
      "7 tiles given for a 4x2 map",
    );
    expect(() => encodeMapFile({ ...example, width: 1.5 })).toThrow("invalid map size");
    expect(() => encodeMapFile({ ...example, width: 1 << 14, height: 1 << 13 })).toThrow(
      "invalid map size",
    );
  });
});
