import type { Summary } from "../engine/stats.ts";
import { GameStats, LoadClient, TURN_MS } from "./client.ts";
import { Histogram } from "./histogram.ts";
import { LoopDelay, type LoopDelaySummary } from "./loop-delay.ts";

export interface LoadOptions {
  /** WebSocket endpoint, such as ws://localhost:8080/ws. */
  url: string;
  games: number;
  players: number;
  durationMs: number;
  /**
   * Private games are created by one client and joined by id, then started
   * by their creator. Public games are filled by the server's matchmaking,
   * so players end up in games of the server's capacity.
   */
  mode: "private" | "public";
  /** Mean time between two orders of one player. */
  orderIntervalMs: number;
  /** Orders target random tiles below this index. */
  mapTiles: number;
  /** Progress lines, every `progressMs` while the games run. */
  log?: (line: string) => void;
  progressMs?: number;
}

export interface GameReport {
  id: string;
  players: number;
  minTurns: number;
  maxTurns: number;
  outOfOrder: number;
  desyncs: number;
  ordersSent: number;
  ordersSeen: number;
  /** Time between consecutive turns on one client, in ms. */
  interval: Summary;
  /** Order sent to turn received, in ms; undefined when no order came back. */
  orderLatency: Summary | undefined;
}

export interface LoadReport {
  games: GameReport[];
  /** Every game's intervals together. */
  interval: Summary;
  orderLatency: Summary | undefined;
  connectMs: number;
  /** Event loop delay of the process running the clients, in ms: high values skew the rest. */
  clientLoopDelay: LoopDelaySummary;
}

/** Joins every client to a game and starts it; resolves once every client has `started`. */
async function startGames(
  options: LoadOptions,
  statsFor: (game: string) => GameStats,
): Promise<LoadClient[]> {
  let next = 0;
  const connect = () => {
    const index = next++;
    return LoadClient.connect({
      url: options.url,
      name: `Load ${String(index)}`,
      address: `10.${String((index >> 16) & 255)}.${String((index >> 8) & 255)}.${String(index & 255)}`,
      statsFor,
    });
  };

  if (options.mode === "public") {
    const clients = await Promise.all(
      Array.from({ length: options.games * options.players }, async () => {
        const client = await connect();
        client.send({ type: "play" });
        return client;
      }),
    );
    // Public games count down 30 s by default once they have two players.
    await Promise.all(clients.map((client) => client.next("started", 120_000)));
    return clients;
  }

  const games = await Promise.all(
    Array.from({ length: options.games }, async () => {
      const host = await connect();
      host.send({ type: "create" });
      const { game } = await host.next("lobby");
      const guests = await Promise.all(
        Array.from({ length: options.players - 1 }, async () => {
          const guest = await connect();
          guest.send({ type: "join", game });
          await guest.next("lobby");
          return guest;
        }),
      );
      while ((await host.next("lobby")).players.length < options.players);
      host.send({ type: "start" });
      const clients = [host, ...guests];
      await Promise.all(clients.map((client) => client.next("started")));
      return clients;
    }),
  );
  return games.flat();
}

/** Plays the games for the given duration and reports what every client saw. */
export async function runLoad(options: LoadOptions): Promise<LoadReport> {
  const stats = new Map<string, GameStats>();
  const statsFor = (game: string): GameStats => {
    let found = stats.get(game);
    if (!found) {
      found = new GameStats(game);
      stats.set(game, found);
    }
    return found;
  };

  const connectStart = performance.now();
  const clients = await startGames(options, statsFor);
  const connectMs = performance.now() - connectStart;

  const loopDelay = new LoopDelay();
  for (const client of clients) client.play(options.orderIntervalMs, options.mapTiles);
  const runStart = performance.now();
  const progress = setInterval(() => {
    const turns = clients.map((client) => client.turns);
    const seconds = Math.round((performance.now() - runStart) / 1000);
    options.log?.(
      `${String(seconds)} s: ${String(Math.min(...turns))} to ${String(Math.max(...turns))} turns per client`,
    );
  }, options.progressMs ?? 30_000);
  await new Promise((resolve) => setTimeout(resolve, options.durationMs));
  clearInterval(progress);
  loopDelay.stop();
  // One synchronous pass, so every client's turn count is taken at the same instant.
  for (const client of clients) client.stop();

  const games = [...stats.values()].map((game): GameReport => {
    const turns = game.turnsPerClient;
    return {
      id: game.id,
      players: turns.length,
      minTurns: Math.min(...turns),
      maxTurns: Math.max(...turns),
      outOfOrder: game.outOfOrder,
      desyncs: game.desyncs,
      ordersSent: game.ordersSent,
      ordersSeen: game.ordersSeen,
      interval: game.intervals.summary(),
      orderLatency: game.orderLatency.samples > 0 ? game.orderLatency.summary() : undefined,
    };
  });
  const intervals = new Histogram();
  const latency = new Histogram();
  for (const game of stats.values()) {
    intervals.add(game.intervals);
    latency.add(game.orderLatency);
  }
  return {
    games,
    interval: intervals.summary(),
    orderLatency: latency.samples > 0 ? latency.summary() : undefined,
    connectMs,
    clientLoopDelay: loopDelay.summary(),
  };
}

const ms = (value: number): string => value.toFixed(1);
const late = (value: number): string => `${value >= TURN_MS ? "+" : ""}${ms(value - TURN_MS)}`;

/** The report as Markdown tables, lateness counted against the 100 ms turn. */
export function formatReport(report: LoadReport): string {
  const lines = [
    "| Game | Players | Turns | Out of order | Desyncs | Orders sent / seen | Lateness p50 | p95 | max | Order latency p50 / p95 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const game of report.games) {
    const turns =
      game.minTurns === game.maxTurns
        ? String(game.minTurns)
        : `${String(game.minTurns)}–${String(game.maxTurns)}`;
    const latency = game.orderLatency
      ? `${ms(game.orderLatency.p50)} / ${ms(game.orderLatency.p95)} ms`
      : "–";
    lines.push(
      `| ${game.id} | ${String(game.players)} | ${turns} | ${String(game.outOfOrder)} | ${String(game.desyncs)} | ${String(game.ordersSent)} / ${String(game.ordersSeen)} | ${late(game.interval.p50)} ms | ${late(game.interval.p95)} ms | ${late(game.interval.max)} ms | ${latency} |`,
    );
  }
  const { interval, orderLatency } = report;
  lines.push(
    "",
    `All games: ${String(interval.samples)} turn intervals, mean ${ms(interval.mean)} ms, p50 ${ms(interval.p50)} ms, p95 ${ms(interval.p95)} ms, p99 ${ms(interval.p99)} ms, max ${ms(interval.max)} ms.`,
  );
  if (orderLatency) {
    lines.push(
      `Order to turn: p50 ${ms(orderLatency.p50)} ms, p95 ${ms(orderLatency.p95)} ms, max ${ms(orderLatency.max)} ms.`,
    );
  }
  lines.push(
    `Joining and starting every game took ${ms(report.connectMs)} ms. Client event loop delay: p99 ${ms(report.clientLoopDelay.p99)} ms, max ${ms(report.clientLoopDelay.max)} ms.`,
  );
  return lines.join("\n");
}
