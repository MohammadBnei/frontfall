import { expect, test } from "@playwright/test";

interface CatalogEntry {
  id: string;
  manifest: string;
  thumbnail: string;
}

test("serves every map of the catalog next to the page", async ({ request }) => {
  const catalog = await request.get("./maps/index.json");
  expect(catalog.ok()).toBe(true);
  const { maps } = (await catalog.json()) as { maps: CatalogEntry[] };
  expect(maps.map((map) => map.id)).toContain("world");

  for (const map of maps) {
    const manifest = await request.get(`./maps/${map.manifest}`);
    expect(manifest.ok(), map.manifest).toBe(true);
    const { terrain } = (await manifest.json()) as { terrain: { file: string; bytes: number } };
    const file = await request.get(`./maps/${terrain.file}`);
    expect(file.ok(), terrain.file).toBe(true);
    const bytes = await file.body();
    expect(bytes.length).toBe(terrain.bytes);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("FFMP");
    const thumbnail = await request.get(`./maps/${map.thumbnail}`);
    expect(thumbnail.headers()["content-type"]).toBe("image/png");
  }
});
