import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ORDER_KINDS, PROTOCOL_VERSION } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";

const doc = readFileSync(resolve(import.meta.dirname, "../../docs/protocol.md"), "utf8");

describe("docs/protocol.md", () => {
  it("states the version the code speaks", () => {
    expect(doc).toMatch(new RegExp(`^Version ${String(PROTOCOL_VERSION)}\\.`, "m"));
    const examples = [...doc.matchAll(/"?version"?: (\d+)/g)].map((match) => Number(match[1]));
    expect(examples.length).toBeGreaterThan(0);
    expect(new Set(examples)).toEqual(new Set([PROTOCOL_VERSION]));
  });

  it("says what each version added, up to this one", () => {
    expect(doc).toContain(`version ${String(PROTOCOL_VERSION)} \``);
  });

  it("lists every order kind", () => {
    for (const kind of ORDER_KINDS) expect(doc).toContain(`| \`${kind.type}\``);
  });
});
