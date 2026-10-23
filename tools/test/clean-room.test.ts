import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexReference, listFiles, scan, tokenize, windowHashes } from "../src/clean-room.ts";

const options = { minTokens: 20, minFileBytes: 64 };

const original = `
export function spread(grid: number[], start: number, budget: number): number[] {
  const visited = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0 && visited.size < budget) {
    const tile = queue.shift() as number;
    for (const next of [tile - 1, tile + 1]) {
      if (grid[next] === 1 && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return [...visited];
}
`;

let workspace: string;
let referenceDir: string;
let ourDir: string;

function write(path: string, content: string | Uint8Array): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  return path;
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "clean-room-"));
  referenceDir = join(workspace, "reference");
  ourDir = join(workspace, "ours");
  write(join(referenceDir, "src/spread.ts"), original);
  write(join(referenceDir, "assets/map.bin"), new Uint8Array(256).fill(7));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("tokenize", () => {
  it("ignores comments and whitespace and keeps line numbers", () => {
    const tokens = tokenize("// note\nconst  a =\n  1; /* x */\n", "a.ts");
    expect(tokens.map((token) => token.text)).toEqual(["const", "a", "=", "1", ";"]);
    expect(tokens.map((token) => token.line)).toEqual([2, 2, 2, 3, 3]);
  });
});

describe("windowHashes", () => {
  it("gives equal runs equal hashes wherever they appear", () => {
    const tokens = tokenize("a b c x a b c", "a.ts");
    const hashes = windowHashes(tokens, 3);
    expect(hashes).toHaveLength(5);
    expect(hashes[0]).toBe(hashes[4]);
    expect(new Set(hashes).size).toBe(4);
  });

  it("returns nothing for a file shorter than one window", () => {
    expect(windowHashes(tokenize("a b", "a.ts"), 3)).toEqual([]);
  });
});

describe("scan", () => {
  it("reports a pasted block even when reformatted and commented", () => {
    const pasted = original.replaceAll("  ", "\t").replace("while", "// walk\n  while");
    const file = write(join(ourDir, "game.ts"), `import x from "y";\n\n${pasted}\nexport {};\n`);
    const findings = scan([file], indexReference(referenceDir, options), options);
    expect(findings).toEqual([
      { kind: "code", file, startLine: 4, endLine: 18, tokens: expect.any(Number) as number },
    ]);
  });

  it("accepts code written independently", () => {
    const file = write(
      join(ourDir, "grow.ts"),
      `export const grow = (tiles: readonly number[]): number[] =>\n  tiles.filter((tile) => tile % 2 === 0).map((tile) => tile * 3 + 1).slice(0, 10);\n`,
    );
    expect(scan([file], indexReference(referenceDir, options), options)).toEqual([]);
  });

  it("reports a copied asset by content", () => {
    const file = write(join(ourDir, "renamed.png"), new Uint8Array(256).fill(7));
    expect(scan([file], indexReference(referenceDir, options), options)).toEqual([
      { kind: "file", file },
    ]);
  });

  it("does not compare tiny files by hash", () => {
    write(join(referenceDir, ".nvmrc"), "24\n");
    const file = write(join(ourDir, ".nvmrc"), "24\n");
    expect(scan([file], indexReference(referenceDir, options), options)).toEqual([]);
  });
});

describe("listFiles", () => {
  it("skips dependencies and version control", () => {
    write(join(referenceDir, "node_modules/lib/index.js"), original);
    write(join(referenceDir, ".git/HEAD"), "ref");
    expect(listFiles(referenceDir).sort()).toEqual([
      join(referenceDir, "assets/map.bin"),
      join(referenceDir, "src/spread.ts"),
    ]);
  });
});
