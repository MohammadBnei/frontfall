import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = new URL("../src/", import.meta.url);

describe("renderer boundary (ADR 0003)", () => {
  it("keeps Three.js inside src/render", () => {
    const files = readdirSync(SOURCE, { recursive: true, encoding: "utf8" }).filter((file) =>
      file.endsWith(".ts"),
    );
    const outside = files.filter(
      (file) =>
        !file.startsWith("render/") &&
        /from\s+["']three(\/[^"']*)?["']/.test(readFileSync(new URL(file, SOURCE), "utf8")),
    );
    expect(files.length).toBeGreaterThan(20);
    expect(outside).toEqual([]);
  });
});
