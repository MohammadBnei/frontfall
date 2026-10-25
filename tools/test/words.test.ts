import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

/**
 * Words the game keeps out of its code, tests and catalogues: its weapons
 * have names of their own, and other games are named only in the docs that
 * credit them.
 */
const WORDS = /\b(nukes?|nuclear|hydrogen|mirvs?|openfront\w*)\b/i;
/** In capitals only: Sam stays a name a bot may take. */
const ACRONYMS = /\bSAMs?\b/;

describe("words left out", () => {
  it("are absent from every source file", () => {
    const files = execFileSync("git", ["ls-files", "*.ts", "*.js", "*.json", "*.html", "*.css"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter(
        (file) => file !== "" && file !== "pnpm-lock.yaml" && file !== "tools/test/words.test.ts",
      );
    expect(files.length).toBeGreaterThan(100);
    const found = files.flatMap((file) =>
      readFileSync(resolve(root, file), "utf8")
        .split("\n")
        .flatMap((line, index) =>
          WORDS.test(line) || ACRONYMS.test(line) ? [`${file}:${String(index + 1)}`] : [],
        ),
    );
    expect(found).toEqual([]);
  });
});
