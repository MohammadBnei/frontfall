import { fork, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatReport, runLoad } from "./load.ts";
import type { ServerRequest, ServerStats } from "./serve.ts";

const { values } = parseArgs({
  // `pnpm load -- --games 2` forwards the separator too.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    games: { type: "string", default: "20" },
    players: { type: "string", default: "16" },
    minutes: { type: "string", default: "30" },
    url: { type: "string", default: "ws://localhost:8080/ws" },
    "spawn-server": { type: "boolean", default: false },
    public: { type: "boolean", default: false },
    "order-interval": { type: "string", default: "2000" },
    "map-tiles": { type: "string", default: String(4096 * 2048) },
    json: { type: "string" },
  },
});

function positive(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`--${name} must be a positive number, got ${raw}`);
    process.exit(2);
  }
  return value;
}

const games = Math.round(positive("games", values.games));
const players = Math.round(positive("players", values.players));
const minutes = positive("minutes", values.minutes);

/** Starts serve.ts in a child process and resolves with its WebSocket URL. */
async function spawnServer(): Promise<{ url: string; child: ChildProcess }> {
  const child = fork(fileURLToPath(new URL("serve.ts", import.meta.url)), {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, LOAD_PLAYERS: String(players) },
  });
  const port = await new Promise<number>((resolve, reject) => {
    child.once("message", (message: { port: number }) => {
      resolve(message.port);
    });
    child.once("exit", (code) => {
      reject(new Error(`server exited with ${String(code)}`));
    });
  });
  return { url: `ws://127.0.0.1:${String(port)}/ws`, child };
}

function request(child: ChildProcess, what: ServerRequest): Promise<ServerStats> {
  return new Promise((resolve) => {
    child.once("message", resolve);
    child.send(what);
  });
}

const mib = (bytes: number): string => (bytes / 2 ** 20).toFixed(0);

const server = values["spawn-server"] ? await spawnServer() : undefined;
const url = server?.url ?? values.url;
console.log(
  `Node ${process.version}, ${String(cpus().length)} × ${cpus()[0]?.model ?? "unknown CPU"}, ${mib(totalmem())} MiB`,
);
console.log(
  `${String(games)} ${values.public ? "public" : "private"} games × ${String(players)} players for ${String(minutes)} min against ${url}`,
);

const before = server && (await request(server.child, "stats"));
const wallStart = performance.now();
const report = await runLoad({
  url,
  games,
  players,
  durationMs: minutes * 60_000,
  mode: values.public ? "public" : "private",
  orderIntervalMs: positive("order-interval", values["order-interval"]),
  mapTiles: Math.round(positive("map-tiles", values["map-tiles"])),
  log: (line) => {
    console.log(line);
  },
});
const wallMs = performance.now() - wallStart;
console.log(`\n${formatReport(report)}`);

let serverSummary: { cpuPercent: number; after: ServerStats } | undefined;
if (server && before) {
  const after = await request(server.child, "stats");
  const cpuMs = (after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system) / 1000;
  const cpuPercent = (cpuMs / wallMs) * 100;
  serverSummary = { cpuPercent, after };
  console.log(
    `Server: ${cpuPercent.toFixed(1)} % of one core over the run, RSS ${mib(after.rssBytes)} MiB (peak ${mib(after.peakRssBytes)} MiB), event loop delay p99 ${after.loopDelay.p99.toFixed(1)} ms, max ${after.loopDelay.max.toFixed(1)} ms.`,
  );
  server.child.send("stop" satisfies ServerRequest);
}

if (values.json) {
  writeFileSync(
    values.json,
    `${JSON.stringify({ node: process.version, games, players, minutes, report, server: serverSummary }, null, 2)}\n`,
  );
}

const broken = report.games.filter(
  (game) => game.outOfOrder > 0 || game.desyncs > 0 || game.maxTurns - game.minTurns > 1,
);
if (broken.length > 0) {
  console.error(`\n${String(broken.length)} games lost, reordered or desynced turns.`);
  process.exitCode = 1;
}
