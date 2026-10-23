import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseServerMessage, type ServerMessage } from "@frontfall/protocol";
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
  socket.on("message", (data: Buffer) => {
    const parsed = parseServerMessage(data.toString("utf8"));
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
  return { socket, next };
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

describe("HTTP", () => {
  it("answers the health check with the build version, never cached", async () => {
    const response = await fetch(`http://${await start()}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("x-frontfall-version")).toBe("abc123");
    expect(response.headers.get("cache-control")).toBe("no-store");
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

  it("rejects other methods", async () => {
    const response = await fetch(`http://${await start()}/`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("WebSocket", () => {
  it("lets players join a lobby and relays their intents in turns", async () => {
    const host = await start();
    const alice = open(host);
    const bob = open(host);
    await Promise.all([opened(alice.socket), opened(bob.socket)]);

    alice.socket.send(JSON.stringify({ type: "join", lobby: "test", name: "Alice" }));
    const joined = await alice.next("joined");
    bob.socket.send(JSON.stringify({ type: "join", lobby: "test", name: "Bob" }));
    expect((await bob.next("joined")).seed).toBe(joined.seed);

    alice.socket.send(JSON.stringify({ type: "intent", intent: { type: "spawn", tile: 7 } }));
    let turn = await bob.next("turn");
    while (turn.turn.intents.length === 0) turn = await bob.next("turn");
    expect(turn.turn.intents).toEqual([
      { player: joined.player, intent: { type: "spawn", tile: 7 } },
    ]);
  });

  it("answers an invalid message with an error", async () => {
    const client = open(await start());
    await opened(client.socket);
    client.socket.send("{");
    expect((await client.next("error")).message).toBe("malformed JSON");
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

  it("caps the number of games open at once", async () => {
    const host = await start({ maxRooms: 1 });
    const first = open(host);
    const second = open(host);
    await Promise.all([opened(first.socket), opened(second.socket)]);
    first.socket.send(JSON.stringify({ type: "join", lobby: "a", name: "A" }));
    await first.next("joined");
    second.socket.send(JSON.stringify({ type: "join", lobby: "b", name: "B" }));
    expect((await second.next("error")).message).toBe("too many games in progress");
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
    const client = open(host);
    await opened(client.socket);
    client.socket.send(JSON.stringify({ type: "join", lobby: "x", name: "X" }));
    await client.next("joined");
    const code = closed(client.socket);
    const closing = server?.close();
    server = undefined;
    expect((await client.next("error")).message).toBe("server restarting");
    expect(await code).toBe(1012);
    await closing;
  });
});
