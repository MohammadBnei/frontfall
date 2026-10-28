import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadedByPage, measureSizes, type SizeBudget } from "../client/size.ts";

const dist = mkdtempSync(join(tmpdir(), "frontfall-size-"));
mkdirSync(join(dist, "assets"));
mkdirSync(join(dist, "maps"));
writeFileSync(
  join(dist, "index.html"),
  "<!doctype html>".repeat(200) +
    '<link rel="modulepreload" crossorigin href="./assets/shared-AbCd1234.js">',
);
writeFileSync(join(dist, "assets", "index-AbCd1234.js"), "let a = 1;\n".repeat(500));
writeFileSync(join(dist, "assets", "tiny-AbCd1234.js"), "x");
writeFileSync(join(dist, "assets", "shared-AbCd1234.js"), "y");
writeFileSync(join(dist, "assets", "font-AbCd1234.woff2"), Buffer.alloc(2000, 7));
writeFileSync(join(dist, "maps", "world.bin"), Buffer.alloc(50_000));

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

const budget = (files: string, except?: string): SizeBudget => ({
  name: files,
  files,
  ...(except === undefined ? {} : { except }),
  kB: 10,
});

describe("measureSizes", () => {
  it("counts text and map files gzipped, as the server sends them", () => {
    const [code] = measureSizes(dist, [budget("^assets/index-[^/]+\\.js$")]);
    expect(code?.files).toBe(1);
    expect(code?.raw).toBe(5500);
    expect(code?.sent).toBeLessThan(200);
    expect(code?.budget).toBe(10_000);
  });

  it("counts fonts and files under 1 kB as they are", () => {
    const [assets] = measureSizes(dist, [budget("^assets/(font|tiny)")]);
    expect(assets?.sent).toBe(2001);
    expect(assets?.brotli).toBe(2001);
  });

  it("leaves out the files of `except`", () => {
    const [all] = measureSizes(dist, [budget(".", "^maps/")]);
    expect(all?.files).toBe(5);
  });

  it("adds what the page loads up front, such as a chunk split off the entry", () => {
    const [first] = measureSizes(dist, [
      { ...budget("^assets/index-[^/]+\\.js$"), loadedByPage: true },
    ]);
    expect(first?.files).toBe(2);
    expect(
      loadedByPage(
        '<script type="module" src="./assets/index-1.js"></script><link rel="stylesheet" href="assets/index-2.css"><link rel="icon" href="./favicon.svg?v=2"><script src="./unsupported.js"></script>',
      ),
    ).toEqual(new Set(["assets/index-1.js", "assets/index-2.css", "unsupported.js"]));
  });

  it("refuses a budget that matches nothing, so a renamed file cannot slip out of it", () => {
    expect(() => measureSizes(dist, [budget("^nothing$")])).toThrow(/no file/);
  });

  it("covers the real build's budgets with patterns that still parse", () => {
    const budgets = JSON.parse(
      readFileSync(new URL("../client/budget.json", import.meta.url), "utf8"),
    ) as SizeBudget[];
    for (const b of budgets) {
      expect(() => new RegExp(b.files)).not.toThrow();
      expect(b.kB).toBeGreaterThan(0);
    }
  });
});
