import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { get } from "node:http";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  PROTOCOL_VERSION,
  CloseCode,
  encodeClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "@frontfall/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGameServer, type GameServer, type ServerOptions } from "../src/server.ts";

let staticRoot: string;
let server: GameServer | undefined;
let clients: WebSocket[] = [];

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-static-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
});

afterEach(async () => {
  for (const client of clients) client.terminate();
  clients = [];
  await server?.close();
  server = undefined;
  rmSync(staticRoot, { recursive: true, force: true });
});

async function start(options: Partial<ServerOptions> = {}): Promise<string> {
  server = createGameServer({ staticRoot, version: "abc123", ...options });
  const http = server.http;
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  return `127.0.0.1:${String((http.address() as AddressInfo).port)}`;
}

/** A client that buffers every message, so none is lost between two awaits. */
function open(host: string, headers: Record<string, string> = {}, autoPong = true) {
  const socket = new WebSocket(`ws://${host}/ws`, { headers, autoPong });
  clients.push(socket);
  const inbox: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  socket.on("message", (data: Buffer, isBinary: boolean) => {
    const parsed = parseServerMessage(isBinary ? new Uint8Array(data) : data.toString("utf8"));
    if (parsed.ok) inbox.push(parsed.value);
    waiters.splice(0).forEach((wake) => {
      wake();
    });
  });
  const next = async <T extends ServerMessage["type"]>(type: T) => {
    for (;;) {
      const index = inbox.findIndex((message) => message.type === type);
      if (index >= 0) return inbox.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  const send = (message: ClientMessage) => {
    socket.send(encodeClientMessage(message));
  };
  return { socket, next, send };
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => {
      resolve();
    });
    socket.once("error", reject);
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once("close", resolve));
}

/** A connected client that has said hello. */
async function player(host: string, name: string, autoPong = true) {
  const client = open(host, {}, autoPong);
  await opened(client.socket);
  client.send({ type: "hello", version: PROTOCOL_VERSION, name });
  await client.next("welcome");
  return client;
}

describe("HTTP", () => {
  it("answers the health check with the build version, never cached", async () => {
    const response = await fetch(`http://${await start()}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("x-frontfall-version")).toBe("abc123");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails the health check once turns stop being closed", async () => {
    // With no delay allowed, the last turn is always too old.
    const response = await fetch(`http://${await start({ stallAfterMs: 0 })}/healthz`);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("stalled");
    expect(response.headers.get("x-frontfall-version")).toBe("abc123");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("stays healthy while the turn timer keeps up, with no game running", async () => {
    const host = await start({ stallAfterMs: 500 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect((await fetch(`http://${host}/healthz`)).status).toBe(200);
  });

  it("fails the health check of a request still in flight at shutdown", async () => {
    const host = await start();
    const [address, port] = host.split(":");
    const socket = connect(Number(port), address);
    await new Promise((resolve) => socket.once("connect", resolve));
    // Half a request keeps the connection busy, so close() leaves it open.
    socket.write("GET /healthz HTTP/1.1\r\nHost: x\r\n");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const closed = server?.close();
    server = undefined;
    const reply = new Promise<string>((resolve) => {
      let text = "";
      socket.on("data", (chunk: Buffer) => (text += chunk.toString()));
      socket.on("end", () => {
        resolve(text);
      });
    });
    socket.end("Connection: close\r\n\r\n");
    const text = await reply;
    await closed;
    expect(text).toMatch(/^HTTP\/1\.1 503/);
    expect(text.slice(text.indexOf("\r\n\r\n"))).toContain("stopping");
  });

  it("serves the client, caching hashed assets only", async () => {
    writeFileSync(join(staticRoot, "app.js"), "export {};");
    const host = await start();
    const page = await fetch(`http://${host}/`);
    expect(await page.text()).toBe("<!doctype html>");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");

    const head = await fetch(`http://${host}/app.js`, { method: "HEAD" });
    expect(head.headers.get("content-type")).toContain("text/javascript");
    expect(await head.text()).toBe("");
    expect((await fetch(`http://${host}/missing.js`)).status).toBe(404);
  });

  it("marks files under /assets/ as immutable", async () => {
    mkdirSync(join(staticRoot, "assets"));
    writeFileSync(join(staticRoot, "assets/index-1a2b.js"), "export {};");
    const response = await fetch(`http://${await start()}/assets/index-1a2b.js`);
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("serves metrics to the host only, never through the proxy", async () => {
    const host = await start();
    const direct = await fetch(`http://${host}/metrics`);
    expect(direct.status).toBe(200);
    expect(direct.headers.get("content-type")).toContain("text/plain");
    const text = await direct.text();
    expect(text).toContain('frontfall_games{state="open"} 0');
    expect(text).toContain("frontfall_turn_duration_seconds_count");
    for (const header of ["x-client-ip", "x-forwarded-for", "forwarded"]) {
      const proxied = await fetch(`http://${host}/metrics`, { headers: { [header]: "1.2.3.4" } });
      expect(proxied.status).toBe(404);
    }
  });

  it("sends large files gzipped to clients that accept it", async () => {
    const map = new Uint8Array(64 * 1024).fill(3);
    writeFileSync(join(staticRoot, "world.bin"), map);
    const host = await start();
    const raw = (encoding?: string) =>
      new Promise<{ headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
        get(
          `http://${host}/world.bin`,
          { headers: encoding ? { "accept-encoding": encoding } : {} },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => {
              resolve({ headers: response.headers, body: Buffer.concat(chunks) });
            });
          },
        ).on("error", reject);
      });

    const zipped = await raw("gzip, deflate, br");
    expect(zipped.headers["content-encoding"]).toBe("gzip");
    expect(zipped.headers.vary).toBe("Accept-Encoding");
    expect(zipped.headers["content-type"]).toBe("application/octet-stream");
    expect(Number(zipped.headers["content-length"])).toBe(zipped.body.length);
    expect(gunzipSync(zipped.body).equals(Buffer.from(map))).toBe(true);

    for (const encoding of [undefined, "br", "gzip;q=0"]) {
      const plain = await raw(encoding);
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(plain.body.length).toBe(map.length);
    }
  });

  it("lets browsers revalidate files with their ETag", async () => {
    writeFileSync(join(staticRoot, "world.json"), JSON.stringify({ id: "world" }));
    const host = await start();
    const first = await fetch(`http://${host}/world.json`);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^W\/"[\w-]{22}"$/);
    const again = await fetch(`http://${host}/world.json`, {
      headers: { "if-none-match": `"other", ${etag?.slice(2) ?? ""}` },
    });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    expect(await again.text()).toBe("");
    const changed = await fetch(`http://${host}/world.json`, {
      headers: { "if-none-match": 'W/"stale"' },
    });
    expect(changed.status).toBe(200);
  });

  it("rejects other methods", async () => {
    const response = await fetch(`http://${await start()}/`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("WebSocket", () => {
  const fast = { publicGame: { countdownMs: 50 } };

  it("plays a public game: lobby, countdown, start, then the same turns for everyone", async () => {
    const host = await start(fast);
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");

    alice.send({ type: "play" });
    expect(await alice.next("lobby")).toMatchObject({
      visibility: "public",
      players: [{ id: 1, name: "Alice" }],
      startsIn: null,
    });
    bob.send({ type: "play" });
    const lobby = await bob.next("lobby");
    expect(lobby.players).toHaveLength(2);
    expect(lobby.startsIn).toBeGreaterThan(0);

    const [a, b] = await Promise.all([alice.next("started"), bob.next("started")]);
    expect(a.seed).toBe(b.seed);
    expect(a.game).toBe(lobby.game);
    expect([a.you, b.you]).toEqual([1, 2]);

    alice.send({ type: "order", order: { type: "spawn", tile: 7 } });
    for (;;) {
      const { turns } = await bob.next("turns");
      const orders = turns.flatMap((turn) => turn.orders);
      if (orders.length === 0) continue;
      expect(orders).toEqual([{ player: 1, order: { type: "spawn", tile: 7 } }]);
      break;
    }
  });

  it("lists public games over HTTP", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    alice.send({ type: "play" });
    const { game } = await alice.next("lobby");
    const response = await fetch(`http://${host}/api/games`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      games: [{ id: game, map: "world", players: 1, capacity: 16, startsIn: null }],
    });
  });

  it("plays a private game by invitation, started by its host", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "create" });
    const { game, host: hostId } = await alice.next("lobby");
    expect(hostId).toBe(1);
    expect(await (await fetch(`http://${host}/api/games`)).json()).toEqual({
      games: [],
    });

    bob.send({ type: "join", game });
    await bob.next("lobby");
    bob.send({ type: "start" });
    expect((await bob.next("error")).code).toBe("not_host");
    alice.send({ type: "start" });
    expect((await bob.next("started")).players).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("lets the host pick a published map, bots and difficulty", async () => {
    mkdirSync(join(staticRoot, "maps"));
    const entry = (id: string, max: number) => ({
      id,
      name: { en: id, fr: id },
      width: 64,
      height: 32,
      topology: "flat",
      players: { min: 2, recommended: 8, max },
      manifest: `${id}.json`,
      thumbnail: `${id}.png`,
    });
    writeFileSync(
      join(staticRoot, "maps", "index.json"),
      JSON.stringify({ format: 1, maps: [entry("world", 64), entry("europe", 20)] }),
    );
    const host = await start({ privateGame: { capacity: 4 } });
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "create" });
    const lobby = await alice.next("lobby");
    expect(lobby).toMatchObject({ map: "world", bots: 0, difficulty: "normal" });
    bob.send({ type: "join", game: lobby.game });
    await bob.next("lobby");

    bob.send({ type: "configure", options: { map: "europe", bots: 2, difficulty: "hard" } });
    expect((await bob.next("error")).code).toBe("not_host");
    alice.send({ type: "configure", options: { map: "mars", bots: 2, difficulty: "hard" } });
    expect((await alice.next("error")).code).toBe("invalid_settings");
    alice.send({ type: "configure", options: { map: "world", bots: 26, difficulty: "hard" } });
    expect((await alice.next("error")).code).toBe("invalid_settings");
    // Europe holds 20: 19 bots would leave one seat for two players.
    alice.send({ type: "configure", options: { map: "europe", bots: 19, difficulty: "hard" } });
    expect((await alice.next("error")).code).toBe("invalid_settings");
    alice.send({ type: "configure", options: { map: "europe", bots: 18, difficulty: "hard" } });
    expect(await bob.next("lobby")).toMatchObject({
      map: "europe",
      bots: 18,
      difficulty: "hard",
      capacity: 2,
    });
    alice.send({ type: "configure", options: { map: "europe", bots: 16, difficulty: "hard" } });
    expect(await bob.next("lobby")).toMatchObject({ bots: 16, capacity: 4 });

    alice.send({ type: "start" });
    expect(await bob.next("started")).toMatchObject({
      map: "europe",
      bots: 16,
      difficulty: "hard",
    });
    alice.send({ type: "configure", options: { map: "world", bots: 0, difficulty: "easy" } });
    expect((await alice.next("error")).code).toBe("game_started");
  });

  it("explains why a game cannot be joined", async () => {
    const host = await start({ privateGame: { capacity: 1 } });
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    bob.send({ type: "join", game: "nosuchgame00" });
    expect((await bob.next("error")).code).toBe("not_found");

    alice.send({ type: "create" });
    const { game } = await alice.next("lobby");
    bob.send({ type: "join", game });
    expect((await bob.next("error")).code).toBe("game_full");
    alice.send({ type: "play" });
    expect((await alice.next("error")).code).toBe("already_in_game");
    bob.send({ type: "start" });
    expect((await bob.next("error")).code).toBe("not_in_game");
  });

  it("lets a player leave and join another game", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    alice.send({ type: "create" });
    await alice.next("lobby");
    alice.send({ type: "leave" });
    expect((await alice.next("ended")).reason).toBe("left");
    expect(server?.games.size).toBe(0);
    alice.send({ type: "play" });
    expect((await alice.next("lobby")).visibility).toBe("public");
  });

  it("gives a dropped player their seat back with every missed turn", async () => {
    const host = await start();
    const alice = await player(host, "Alice");
    const bob = await player(host, "Bob");
    alice.send({ type: "create" });
    const { game } = await alice.next("lobby");
    bob.send({ type: "join", game });
    await bob.next("lobby");
    alice.send({ type: "start" });
    const { token } = await bob.next("started");
    await bob.next("turns");

    bob.socket.close();
    await closed(bob.socket);
    alice.send({ type: "order", order: { type: "spawn", tile: 3 } });
    let last: number;
    for (;;) {
      const { turns } = await alice.next("turns");
      last = turns.at(-1)?.tick ?? 0;
      if (turns.some((turn) => turn.orders.length > 0)) break;
    }

    const back = await player(host, "Bob");
    back.send({ type: "rejoin", token, from: 0 });
    expect((await back.next("started")).you).toBe(2);
    const replayed = [];
    while (replayed.length <= last) replayed.push(...(await back.next("turns")).turns);
    expect(replayed.map((turn) => turn.tick).slice(0, last + 1)).toEqual(
      Array.from({ length: last + 1 }, (_, tick) => tick),
    );
    expect(replayed.flatMap((turn) => turn.orders)).toEqual([
      { player: 1, order: { type: "spawn", tile: 3 } },
    ]);

    const thief = await player(host, "Mallory");
    thief.send({ type: "rejoin", token, from: 0 });
    expect((await thief.next("error")).code).toBe("token_in_use");
    thief.send({ type: "rejoin", token: "0123456789abcdefghij", from: 0 });
    expect((await thief.next("error")).code).toBe("token_invalid");
  });

  it("drops a stale connection when its seat is claimed, so the owner can rejoin", async () => {
    const host = await start({ probeTimeoutMs: 30 });
    const alice = await player(host, "Alice");
    // Bob's connection is half-open: it stays up but never answers pings.
    const stale = await player(host, "Bob", false);
    alice.send({ type: "create" });
    const { game } = await alice.next("lobby");
    stale.send({ type: "join", game });
    await stale.next("lobby");
    alice.send({ type: "start" });
    const { token } = await stale.next("started");

    const back = await player(host, "Bob");
    back.send({ type: "rejoin", token, from: 0 });
    expect((await back.next("error")).code).toBe("token_in_use");
    expect(await closed(stale.socket)).toBe(1006);
    back.send({ type: "rejoin", token, from: 0 });
    expect((await back.next("started")).you).toBe(2);
  });

  it("closes a connection that speaks another protocol version", async () => {
    const client = open(await start());
    await opened(client.socket);
    client.send({ type: "hello", version: 0, name: "Old" });
    expect(await closed(client.socket)).toBe(CloseCode.versionMismatch);
  });

  it("closes a connection from a page of another build", async () => {
    const host = await start();
    const old = open(host);
    await opened(old.socket);
    old.send({ type: "hello", version: PROTOCOL_VERSION, name: "Old", build: "0123456789ab" });
    expect(await closed(old.socket)).toBe(CloseCode.versionMismatch);

    const same = open(host);
    await opened(same.socket);
    same.send({ type: "hello", version: PROTOCOL_VERSION, name: "Same", build: "abc123" });
    await same.next("welcome");
    const dev = open(host);
    await opened(dev.socket);
    dev.send({ type: "hello", version: PROTOCOL_VERSION, name: "Dev", build: "dev" });
    await dev.next("welcome");
  });

  it("asks for another name when the name is not allowed", async () => {
    const client = open(await start());
    await opened(client.socket);
    client.send({ type: "hello", version: PROTOCOL_VERSION, name: "<b>" });
    expect((await client.next("error")).code).toBe("invalid_name");
    client.send({ type: "hello", version: PROTOCOL_VERSION, name: "Bold" });
    await client.next("welcome");
    client.send({ type: "hello", version: PROTOCOL_VERSION, name: "Again" });
    expect(await closed(client.socket)).toBe(CloseCode.invalidMessage);
  });

  it("closes a connection that skips hello or sends an invalid frame", async () => {
    const host = await start();
    const early = open(host);
    await opened(early.socket);
    early.send({ type: "play" });
    expect(await closed(early.socket)).toBe(CloseCode.invalidMessage);

    const garbage = open(host);
    await opened(garbage.socket);
    garbage.socket.send(new Uint8Array([2, 0x80]));
    expect(await closed(garbage.socket)).toBe(CloseCode.invalidMessage);

    const text = open(host);
    await opened(text.socket);
    text.socket.send("{");
    expect(await closed(text.socket)).toBe(CloseCode.invalidMessage);
  });

  it("closes with a shortened reason when the error quotes non-ASCII input", async () => {
    const client = await player(await start(), "Accent");
    const reason = new Promise<Buffer>((resolve) =>
      client.socket.once("close", (_code: number, text: Buffer) => {
        resolve(text);
      }),
    );
    client.socket.send(`{"type":"play","${"é".repeat(80)}":1}`);
    const text = await reason;
    expect(text.byteLength).toBeLessThanOrEqual(123);
    expect(text.toString("utf8")).toMatch(/^✖ Unrecognized key: "é+$/);
  });

  it("closes oversized frames", async () => {
    const client = await player(await start(), "Big");
    client.socket.send("x".repeat(2048));
    expect(await closed(client.socket)).toBe(1009);
  });

  it("closes a connection that never says hello", async () => {
    const client = open(await start({ helloTimeoutMs: 30 }));
    await opened(client.socket);
    expect(await closed(client.socket)).toBe(CloseCode.idle);
  });

  it("closes a connection that sends too many messages", async () => {
    const host = await start({ messageRate: { perSecond: 1, burst: 3 } });
    const client = await player(host, "Flood");
    for (let index = 0; index < 5; index++) {
      client.send({ type: "order", order: { type: "spawn", tile: index } });
    }
    expect(await closed(client.socket)).toBe(CloseCode.rateLimited);
    expect(server?.metrics.rejected.get({ reason: "rate_limited" })).toBe(1);
  });

  it("keeps other games at their pace while one connection floods", async () => {
    const host = await start({ messageRate: { perSecond: 5, burst: 10 } });
    const alice = await player(host, "Alice");
    alice.send({ type: "create" });
    await alice.next("lobby");
    alice.send({ type: "start" });
    await alice.next("started");
    const flood = await player(host, "Flood");
    const floodClosed = closed(flood.socket);
    for (let index = 0; index < 200; index++) flood.send({ type: "hash", tick: index, hash: 1 });
    const startedAt = Date.now();
    for (let count = 0; count < 5; count++) await alice.next("turns");
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(await floodClosed).toBe(CloseCode.rateLimited);
  });

  it("closes a connection that stays out of any game too long", async () => {
    const host = await start({ idleTimeoutMs: 50, pingIntervalMs: 20 });
    const idle = await player(host, "Idle");
    const waiting = await player(host, "Waiting");
    waiting.send({ type: "create" });
    await waiting.next("lobby");
    expect(await closed(idle.socket)).toBe(CloseCode.idle);
    expect(waiting.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("logs games and rejected connections without client addresses", async () => {
    const lines: string[] = [];
    const host = await start({
      logger: {
        info: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
        warn: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
      },
    });
    const alice = await player(host, "Alice");
    alice.send({ type: "create" });
    await alice.next("lobby");
    alice.send({ type: "start" });
    await alice.next("started");
    const rude = open(host, { "x-client-ip": "203.0.113.77" });
    await opened(rude.socket);
    rude.socket.send("{");
    await closed(rude.socket);
    expect(lines.some((line) => line.includes('"event":"game_started"'))).toBe(true);
    expect(lines.some((line) => line.includes('"event":"connection_rejected"'))).toBe(true);
    expect(lines.join("\n")).not.toContain("203.0.113.77");
  });

  it("refuses pages from another origin", async () => {
    const host = await start({ allowedOrigin: "https://nclsmgr.com" });
    const foreign = open(host, { origin: "https://evil.example" });
    await expect(opened(foreign.socket)).rejects.toThrow("403");
    const own = open(host, { origin: "https://nclsmgr.com" });
    await expect(opened(own.socket)).resolves.toBeUndefined();
  });

  it("refuses upgrades outside /ws", async () => {
    const socket = new WebSocket(`ws://${await start()}/other`);
    clients.push(socket);
    await expect(opened(socket)).rejects.toThrow("403");
  });

  it("limits connections per player address, as reported by the proxy", async () => {
    const host = await start({ maxConnectionsPerAddress: 2 });
    const first = open(host, { "x-client-ip": "203.0.113.9" });
    const second = open(host, { "x-client-ip": "203.0.113.9" });
    await Promise.all([opened(first.socket), opened(second.socket)]);
    await expect(opened(open(host, { "x-client-ip": "203.0.113.9" }).socket)).rejects.toThrow(
      "429",
    );
    await expect(
      opened(open(host, { "x-client-ip": "198.51.100.4" }).socket),
    ).resolves.toBeUndefined();

    first.socket.close();
    await closed(first.socket);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(
      opened(open(host, { "x-client-ip": "203.0.113.9" }).socket),
    ).resolves.toBeUndefined();
  });

  it("refuses connections beyond the server-wide cap", async () => {
    const host = await start({ maxConnections: 1 });
    const first = open(host);
    await opened(first.socket);
    await expect(opened(open(host).socket)).rejects.toThrow("503");
  });

  it("caps the number of games open at once", async () => {
    const host = await start({ maxRooms: 1 });
    const first = await player(host, "A");
    const second = await player(host, "B");
    first.send({ type: "create" });
    await first.next("lobby");
    second.send({ type: "create" });
    expect((await second.next("error")).code).toBe("too_many_games");
    second.send({ type: "play" });
    expect((await second.next("error")).code).toBe("too_many_games");
  });

  it("drops a client that stops answering pings", async () => {
    const host = await start({ pingIntervalMs: 30 });
    const silent = open(host, {}, false);
    const healthy = open(host);
    await Promise.all([opened(silent.socket), opened(healthy.socket)]);
    expect(await closed(silent.socket)).toBe(1006);
    expect(healthy.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("tells players the server is restarting when it closes", async () => {
    const host = await start();
    const client = await player(host, "X");
    client.send({ type: "create" });
    await client.next("lobby");
    const code = closed(client.socket);
    const closing = server?.close();
    server = undefined;
    expect(await code).toBe(1012);
    await closing;
  });
});
