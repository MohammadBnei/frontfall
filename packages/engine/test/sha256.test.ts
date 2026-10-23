import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/map/sha256.ts";

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

/** A byte pattern that is not periodic over a block. */
const pattern = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 0xff);

describe("sha256Hex", () => {
  it("matches the published test vectors", () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(ascii("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(ascii("a".repeat(1_000_000)))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  // Reference values from `openssl dgst -sha256` on the same bytes.
  it.each([
    [55, "8aa994584139d128848eeebc4e815639ba5ab6e6e39574195a63ac4f14f7c43b"],
    [56, "ad574708f75c044c9b85de64cb568ee7711ff4f36448c6242f053ba8f6cc2b63"],
    [63, "280ed3e8ff1df845b2e7dfe6ac6cee817bef20e783cc65abc41b818b4d2fe076"],
    [64, "c6ab9724ade5b6a7a1edfffb12f3aa9181351355af8fd08c919952ad211339dd"],
    [65, "788367c73c7ddf4c53f65e68cc0d943e6227ab55b0e78ba63ace822b1c6301c0"],
    [1000, "5097e7d587352f5097062ae679f37bda5802d9f875aba14c8cb4d1a188ada179"],
    [100_003, "2a1683cff214df29e77df156a515258190a1bc11526d41cd2b34e72a23b6b7d6"],
  ])("pads a %i-byte message correctly", (length, digest) => {
    expect(sha256Hex(pattern(length))).toBe(digest);
  });
});
