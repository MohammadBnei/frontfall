import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameReport } from "@frontfall/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { silentLogger, type LogFields } from "../src/log.ts";
import { usageInbox } from "../src/usage-http.ts";
import { UsageStats } from "../src/usage.ts";
import { createGameServer, type GameServer, type ServerOptions } from "../src/server.ts";

let staticRoot: string;
let dataDir: string;
let server: GameServer | undefined;
let logged: { event: string; fields: LogFields | undefined }[];

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-static-"));
  dataDir = mkdtempSync(join(tmpdir(), "frontfall-data-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
  logged = [];
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(staticRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

async function start(options: Partial<ServerOptions> = {}): Promise<string> {
  server = createGameServer({
    staticRoot,
    version: "abc123",
    release: "0.5.0",
    logger: {
      info: () => undefined,
      warn: (event, fields) => logged.push({ event, fields }),
    },
    ...options,
  });
  const http = server.http;
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
}

const GAME: GameReport = {
  kind: "game",
  release: "0.5.0",
  game: "0123456789abcdef",
  mode: "solo",
  map: "world",
  teams: 0,
  nations: true,
  bots: 20,
  humans: 1,
  difficulty: "normal",
  disabled: 0,
  minutes: 3,
  outcome: "defeat",
  device: "desktop",
  touch: false,
  lang: "en",
  view: "flat",
};

function post(
  base: string,
  body: unknown,
  headers: Record<string, string> = { "content-type": "text/plain;charset=UTF-8" },
) {
  return fetch(`${base}/api/usage`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("/api/usage", () => {
  it("counts a report sent as a beacon and exports it in /api/stats", async () => {
    const base = await start();
    expect((await post(base, GAME)).status).toBe(204);
    const stats = (await (await fetch(`${base}/api/stats`)).json()) as {
      release: string;
      total: Record<string, Record<string, number>>;
    };
    expect(stats.release).toBe("0.5.0");
    expect(stats.total.games).toEqual({ solo: 1 });
    expect(stats.total.outcome).toEqual({ "solo.defeat": 1 });
  });

  it("shows the counts in /metrics", async () => {
    const base = await start();
    await post(base, GAME);
    const text = await (await fetch(`${base}/metrics`)).text();
    expect(text).toContain('frontfall_usage_total{dimension="games",value="solo"} 1');
    expect(text).toContain("frontfall_game_duration_minutes_count 0");
  });

  it("shows the last days on the status page", async () => {
    const base = await start();
    await post(base, GAME);
    const page = await (await fetch(`${base}/status`)).text();
    expect(page).toContain("Last 7 days / 7 derniers jours");
    expect(page).toMatch(/<td>\d{4}-\d{2}-\d{2}<\/td><td>1<\/td>/);
  });

  it("serves /api/stats for a minute from caches", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/stats`);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("holds the buckets of a bounded number of addresses", async () => {
    let clock = 0;
    const inbox = usageInbox(
      new UsageStats({ release: "0.5.0", maps: new Set() }),
      silentLogger,
      () => true,
      () => clock,
      2,
    );
    const http = createServer((request, response) => {
      inbox.handle(request, response, String(request.headers["x-address"]));
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}/api/usage`;
    const from = async (address: string) =>
      (
        await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-address": address },
          body: JSON.stringify({ kind: "error", release: "0.5.0", type: "webgl" }),
        })
      ).status;
    try {
      expect([await from("a"), await from("b"), await from("c"), await from("a")]).toEqual([
        204, 204, 429, 204,
      ]);
      // Once the old buckets are full again, they are forgotten and make room.
      clock = 10 * 60 * 1000;
      expect(await from("c")).toBe(204);
    } finally {
      await new Promise((resolve) => http.close(resolve));
    }
  });

  it("refuses what is not a report", async () => {
    const base = await start();
    expect((await post(base, { ...GAME, name: "Léa" })).status).toBe(400);
    expect((await post(base, "x".repeat(4000))).status).toBe(413);
    expect(
      (await post(base, GAME, { "content-type": "application/x-www-form-urlencoded" })).status,
    ).toBe(415);
    expect((await fetch(`${base}/api/usage`)).status).toBe(405);
    const stats = (await (await fetch(`${base}/api/stats`)).json()) as { total: object };
    expect(stats.total).toEqual({});
  });

  it("refuses reports from pages of another site", async () => {
    const base = await start({ allowedOrigin: "https://nclsmgr.com" });
    const headers = { "content-type": "application/json", origin: "https://elsewhere.example" };
    expect((await post(base, GAME, headers)).status).toBe(403);
    expect((await post(base, GAME, { ...headers, origin: "https://nclsmgr.com" })).status).toBe(
      204,
    );
  });

  it("limits how often one address reports", async () => {
    const base = await start();
    const statuses: number[] = [];
    for (let index = 0; index < 12; index++) {
      statuses.push((await post(base, { kind: "error", release: "0.5.0", type: "webgl" })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 204)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("logs an error's message scrubbed, never its addresses or quoted names", async () => {
    const base = await start();
    await post(base, {
      kind: "error",
      release: "0.5.0",
      type: "exception",
      message: 'No player "Léa" at https://nclsmgr.com/frontfall/?game=abc',
    });
    const entry = logged.find((line) => line.event === "client_error");
    expect(entry?.fields).toEqual({
      type: "exception",
      release: "0.5.0",
      message: "No player <text> at <url>",
    });
  });

  it("keeps the counts across a restart when it has a data directory", async () => {
    await post(await start({ dataDir }), GAME);
    await server?.close();
    server = undefined;
    expect(readFileSync(join(dataDir, "usage", "usage.json"), "utf8")).toContain('"solo":1');
    const base = await start({ dataDir });
    const stats = (await (await fetch(`${base}/api/stats`)).json()) as {
      total: Record<string, Record<string, number>>;
    };
    expect(stats.total.games).toEqual({ solo: 1 });
  });

  it("starts without a data directory, and says the counts stay in memory", async () => {
    await start();
    expect(logged.map((line) => line.event)).toContain("usage_in_memory");
  });
});
