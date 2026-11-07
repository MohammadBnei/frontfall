import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloseCode, encodeClientMessage, PROTOCOL_VERSION } from "@frontfall/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGameServer, type GameServer, type ServerOptions } from "../src/server.ts";
import { FakeClock } from "./support/fake-clock.ts";
import { FakeSocket, FakeTransport } from "./support/fake-transport.ts";

let staticRoot: string;
let servers: GameServer[] = [];
let sockets: FakeSocket[] = [];

beforeEach(() => {
  staticRoot = mkdtempSync(join(tmpdir(), "frontfall-static-"));
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html>");
  writeFileSync(join(staticRoot, "app.js"), "export {};");
});

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  sockets = [];
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
  rmSync(staticRoot, { recursive: true, force: true });
});

function serve(options: Partial<ServerOptions> = {}): GameServer {
  const server = createGameServer({
    staticRoot,
    version: "abc123",
    drainMs: 0,
    gameListMs: 0,
    ...options,
  });
  servers.push(server);
  return server;
}

/** The same server on both transports: `fetch` and `connect` reach one or the other. */
async function both(options: Partial<ServerOptions> = {}) {
  const fake = new FakeTransport();
  serve({ ...options, transport: fake });
  const { port } = await serve(options).listen(0, "127.0.0.1");
  const host = `127.0.0.1:${String(port)}`;
  return {
    fake: {
      fetch: (path: string, init?: RequestInit) => fake.fetch(`http://${host}${path}`, init),
      connect: (path: string, headers: Record<string, string> = {}) =>
        keep(fake.connect(path, { headers })),
    },
    node: {
      fetch: (path: string, init?: RequestInit) => fetch(`http://${host}${path}`, init),
      connect: (path: string, headers: Record<string, string> = {}) =>
        keep(new WebSocket(`ws://${host}${path}`, { headers }) as unknown as FakeSocket),
    },
  };
}

function keep(socket: FakeSocket): FakeSocket {
  sockets.push(socket);
  return socket;
}

/** How a WebSocket ended: refused with the status of the handshake, or closed with a code. */
function outcome(socket: FakeSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("error", (error: Error) => {
      resolve(error.message);
    });
    socket.once("open", () => {
      socket.once("close", (code: number) => {
        resolve(`closed ${String(code)}`);
      });
      socket.send(encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, name: "Ana" }));
      socket.once("message", () => {
        resolve("welcome");
      });
    });
  });
}

/** What the server decided of an answer; the transport adds headers of its own (date, connection). */
const HEADERS = [
  "allow",
  "cache-control",
  "content-security-policy",
  "content-type",
  "etag",
  "location",
  "x-content-type-options",
  "x-frontfall-version",
];

async function seen(response: Response) {
  return {
    status: response.status,
    headers: Object.fromEntries(HEADERS.map((name) => [name, response.headers.get(name)])),
    body: await response.text(),
  };
}

describe("the fake transport and the node transport", () => {
  it.each([
    ["GET", "/healthz", {}],
    ["GET", "/", {}],
    ["HEAD", "/app.js", {}],
    ["GET", "/missing.js", {}],
    ["POST", "/", {}],
    ["GET", "/api/games", {}],
    ["GET", "/api/me", {}],
    ["GET", "/metrics", { "x-forwarded-for": "1.2.3.4" }],
    ["GET", "/admin/reports", { origin: "https://evil.example" }],
    ["GET", "/admin/bans", {}],
    ["POST", "/admin/maintenance?minutes=500", {}],
    ["POST", "/api/usage", { "content-type": "text/csv" }],
  ])("give the same answer to %s %s", async (method, path, headers) => {
    const { fake, node } = await both();
    const [onFake, onNode] = await Promise.all([
      fake.fetch(path, { method, headers }).then(seen),
      node.fetch(path, { method, headers }).then(seen),
    ]);
    expect(onFake).toEqual(onNode);
  });

  it.each([
    ["a report", JSON.stringify({ kind: "error", release: "dev", type: "webgl" })],
    ["a body that is not one", "{"],
    ["a body past the limit", "x".repeat(4000)],
  ])("give the same answer to %s sent to /api/usage", async (_, body) => {
    const { fake, node } = await both();
    const init = { method: "POST", headers: { "content-type": "application/json" }, body };
    const [onFake, onNode] = await Promise.all([
      fake.fetch("/api/usage", init).then(seen),
      node.fetch("/api/usage", init).then(seen),
    ]);
    expect(onFake).toEqual(onNode);
  });

  it("give the same answer to a WebSocket refused, turned away or welcome", async () => {
    const { fake, node } = await both({
      allowedOrigin: "https://play.example",
      maxConnectionsPerAddress: 1,
    });
    for (const transport of [fake, node]) {
      const own = { origin: "https://play.example" };
      const answers = [
        await outcome(transport.connect("/other", own)),
        await outcome(transport.connect("/ws", { origin: "https://evil.example" })),
        await outcome(transport.connect("/ws", own)),
        await outcome(transport.connect("/ws", own)),
      ];
      expect(answers).toEqual([
        "Unexpected server response: 403",
        "Unexpected server response: 403",
        "welcome",
        "Unexpected server response: 429",
      ]);
    }
    const full = await both({ maxConnections: 0 });
    expect(await outcome(full.fake.connect("/ws"))).toBe(`closed ${String(CloseCode.full)}`);
    expect(await outcome(full.node.connect("/ws"))).toBe(`closed ${String(CloseCode.full)}`);
  });
});

describe("a server on a fake clock", () => {
  function start(options: Partial<ServerOptions> = {}) {
    const clock = new FakeClock();
    const transport = new FakeTransport();
    const server = serve({ clock, transport, ...options });
    /** Lets the messages in flight cross, as the fake transport delivers them a turn later. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
    const connect = (autoPong = true) => {
      const socket = keep(transport.connect("/ws", { autoPong }));
      const ended = new Promise<number>((resolve) => socket.once("close", resolve));
      return { socket, ended };
    };
    const hello = (socket: FakeSocket) => {
      socket.send(encodeClientMessage({ type: "hello", version: PROTOCOL_VERSION, name: "Ana" }));
    };
    return { clock, server, settle, connect, hello };
  }

  it("closes a connection that says no hello once its delay is over, and not before", async () => {
    const { clock, settle, connect } = start({ helloTimeoutMs: 10_000 });
    const { socket, ended } = connect();
    await settle();
    clock.advance(9_999);
    await settle();
    expect(socket.readyState).toBe(FakeSocket.OPEN);
    clock.advance(1);
    expect(await ended).toBe(CloseCode.idle);
  });

  it("drops a connection that leaves a ping unanswered for half an interval", async () => {
    const { clock, settle, connect, hello } = start({
      pingIntervalMs: 1_000,
      idleTimeoutMs: 60_000,
    });
    const silent = connect(false);
    const healthy = connect();
    await settle();
    hello(silent.socket);
    hello(healthy.socket);
    await settle();
    clock.advance(1_000);
    await settle();
    expect(silent.socket.readyState).toBe(FakeSocket.OPEN);
    clock.advance(1_000);
    expect(await silent.ended).toBe(1006);
    expect(healthy.socket.readyState).toBe(FakeSocket.OPEN);
  });

  it("closes a connection that stays out of any game for the idle delay", async () => {
    const { clock, settle, connect, hello } = start({
      pingIntervalMs: 1_000,
      idleTimeoutMs: 5_000,
    });
    const { socket, ended } = connect();
    await settle();
    hello(socket);
    await settle();
    // Idle from its hello at 0; the heartbeat looks every second.
    for (let second = 1; second < 5; second++) {
      clock.advance(1_000);
      await settle();
    }
    expect(socket.readyState).toBe(FakeSocket.OPEN);
    clock.advance(1_000);
    expect(await ended).toBe(CloseCode.idle);
  });

  it("drops a client that leaves more than 4 MiB unread", async () => {
    const { settle, connect, hello, server } = start();
    const { socket, ended } = connect();
    await settle();
    hello(socket);
    socket.send(encodeClientMessage({ type: "create" }));
    await settle();
    const [room] = [...server.games.all()];
    const peer = room?.seatOf(1)?.peer;
    if (!peer) throw new Error("not seated");
    // The client reads nothing: what the server sends piles up on its side.
    socket.pause();
    const frame = "x".repeat(2 ** 20);
    for (let i = 0; i < 4; i++) peer.send(frame);
    await settle();
    expect(socket.readyState).toBe(FakeSocket.OPEN);
    peer.send(frame);
    peer.send(frame);
    expect(await ended).toBe(1006);
    expect(server.metrics.slowClients.get()).toBe(1);
  });
});
