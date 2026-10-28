import { readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { replays } from "./snapshots-check.ts";

/** Every golden replay has its own snapshots-*.test.ts, so a new one cannot go unchecked. */
it("checks the snapshots of every golden replay", () => {
  const files = readdirSync(replays).filter((file) => file.endsWith(".json"));
  const checked = readdirSync(new URL(".", import.meta.url))
    .filter((file) => /^snapshots-.+\.test\.ts$/.test(file))
    .map((file) => `${file.slice("snapshots-".length, -".test.ts".length)}.json`);
  expect(checked.sort()).toEqual(files.sort());
});
