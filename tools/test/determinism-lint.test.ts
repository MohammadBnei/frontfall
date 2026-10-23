import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { determinism } from "../../eslint.config.js";

const root = new URL("../..", import.meta.url).pathname;

// Only the determinism block, with a parser: type-aware rules need files on disk.
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
    determinism,
  ],
});

async function errors(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.message);
}

describe("determinism rules for the engine", () => {
  it.each([
    ["Math.random()", "seeded Random"],
    ["Math.sin(1)", "differ between browsers"],
    ["Math.atan2(1, 2)", "differ between browsers"],
    ["Math.pow(2, 0.5)", "differ between browsers"],
    ["x ** 2", "differ between browsers"],
    ["Date.now()", "clock"],
    ["new Date()", "clock"],
    ["performance.now()", "clock"],
    ["crypto.getRandomValues(new Uint8Array(4))", "seeded Random"],
  ])("rejects %s", async (expression, reason) => {
    const found = await errors(`export const value = ${expression};\n`, "packages/engine/src/x.ts");
    expect(found.join("\n")).toContain(reason);
  });

  it("applies to engine tests as well as sources", async () => {
    expect(await errors("Math.random();\n", "packages/engine/test/x.test.ts")).toHaveLength(1);
  });

  it("allows exact integer maths", async () => {
    const code = "export const v = Math.imul(3, Math.floor(Math.abs(-2.5)) + Math.sqrt(16));\n";
    expect(await errors(code, "packages/engine/src/x.ts")).toEqual([]);
  });

  it("leaves the client and the server alone", async () => {
    expect(await errors("Math.random();\n", "apps/client/src/x.ts")).toEqual([]);
  });
});
