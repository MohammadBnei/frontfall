/**
 * Game server for `pnpm load -- --spawn-server`, run in a child process so its
 * CPU time and memory are measured apart from the simulated clients'.
 */
import { tmpdir } from "node:os";
import { createGameServer } from "@frontfall/server";
import { LoopDelay, type LoopDelaySummary } from "./loop-delay.ts";

export interface ServerStats {
  /** process.cpuUsage(), in microseconds. */
  cpu: { user: number; system: number };
  rssBytes: number;
  peakRssBytes: number;
  /** Event loop delay since the previous request, in ms. */
  loopDelay: LoopDelaySummary;
}

export type ServerRequest = "stats" | "stop";

const players = Number(process.env.LOAD_PLAYERS ?? 16);
const server = createGameServer({
  // The run never requests a page.
  staticRoot: tmpdir(),
  version: "load",
  // Stopping the bench ends its games at once.
  drainMs: 0,
  publicGame: { capacity: players, countdownMs: 1000 },
});

const loopDelay = new LoopDelay();
let peakRssBytes = 0;
setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
}, 1000).unref();

process.on("message", (request: ServerRequest) => {
  if (request === "stop") {
    void server.close().then(() => process.exit(0));
    return;
  }
  const rssBytes = process.memoryUsage.rss();
  peakRssBytes = Math.max(peakRssBytes, rssBytes);
  const stats: ServerStats = {
    cpu: process.cpuUsage(),
    rssBytes,
    peakRssBytes,
    loopDelay: loopDelay.summary(),
  };
  loopDelay.reset();
  process.send?.(stats);
});

server.http.listen(0, "127.0.0.1", () => {
  const address = server.http.address();
  process.send?.({ port: typeof address === "object" && address ? address.port : 0 });
});
