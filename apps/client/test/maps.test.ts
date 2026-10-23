/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { TileKind } from "@frontfall/engine";
import { describe, expect, it } from "vitest";
import { GENERATED_MAPS, fetchMapData, fetchMaps } from "../src/game/maps.ts";

const PAGE = "https://example.test/frontfall/";
const PUBLIC = new URL("../public/", import.meta.url);

/** Serves apps/client/public as if it were deployed under PAGE. */
const fromDisk = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(PAGE)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(new URL(url.slice(PAGE.length), PUBLIC));
    return new Response(bytes);
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;

describe("published maps", () => {
  it("lists the World first, then the other published maps, then the generated ones", async () => {
    const maps = await fetchMaps(PAGE, fromDisk);
    expect(maps[0]).toMatchObject({
      id: "world",
      wrapsX: true,
      manifest: `${PAGE}maps/world.json`,
      thumbnail: `${PAGE}maps/world.png`,
    });
    expect(maps.map((map) => map.id)).toContain("europe");
    expect(maps.slice(-GENERATED_MAPS.length)).toEqual(GENERATED_MAPS);
    expect(maps.every((map) => map.suggestedBots >= 1 && map.suggestedBots <= 24)).toBe(true);
  });

  it("falls back to the generated maps when the catalogue is missing", async () => {
    const missing = (() => Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch;
    expect(await fetchMaps(PAGE, missing)).toEqual(GENERATED_MAPS);
  });

  it("downloads and checks the terrain of a published map", async () => {
    const maps = await fetchMaps(PAGE, fromDisk);
    const europe = maps.find((map) => map.id === "europe");
    if (!europe) throw new Error("no Europe map");
    const data = await fetchMapData(europe, fromDisk);
    expect(data.kinds).toHaveLength(europe.width * europe.height);
    expect(data.kinds.some((kind) => kind === TileKind.Water)).toBe(true);
    expect(data.kinds.some((kind) => kind === TileKind.Plains)).toBe(true);
  });
});
