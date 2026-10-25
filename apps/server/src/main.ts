import { fileURLToPath } from "node:url";
import { jsonLogger } from "./log.ts";
import { createGameServer } from "./server.ts";

/**
 * Running games may go on this long after SIGTERM. The container's stop
 * grace period must be longer, or Docker kills the games without a word.
 */
const DEFAULT_DRAIN_SECONDS = 20;

/** Past the drain, sockets get this long to close before the process exits anyway. */
const EXIT_GRACE_MS = 5_000;

const port = Number(process.env.PORT ?? 8080);
const logger = jsonLogger();
const version = process.env.FRONTFALL_VERSION ?? "dev";

declare const __FRONTFALL_RELEASE__: string | undefined;
/** Release of the game, the root package.json version, set when the server is bundled. */
const release = typeof __FRONTFALL_RELEASE__ === "string" ? __FRONTFALL_RELEASE__ : "dev";

/** Reads a numeric setting from the environment, ignoring it when unset or invalid. */
function optionalNumber<T>(name: string, use: (value: number) => T): T | undefined {
  const value = Number(process.env[name]);
  return process.env[name] && Number.isFinite(value) && value >= 0 ? use(value) : undefined;
}

const drainSeconds =
  optionalNumber("FRONTFALL_DRAIN_SECONDS", (seconds) => seconds) ?? DEFAULT_DRAIN_SECONDS;

const server = createGameServer({
  staticRoot:
    process.env.FRONTFALL_STATIC ?? fileURLToPath(new URL("../../client/dist", import.meta.url)),
  allowedOrigin: process.env.FRONTFALL_ORIGINE,
  version,
  release,
  logger,
  publicGame:
    optionalNumber("FRONTFALL_COUNTDOWN_SECONDS", (seconds) => ({
      countdownMs: seconds * 1000,
    })) ?? {},
  ...optionalNumber("FRONTFALL_MAX_GAMES", (maxRooms) => ({ maxRooms })),
  ...optionalNumber("FRONTFALL_MAX_CONNECTIONS", (maxConnections) => ({ maxConnections })),
  drainMs: drainSeconds * 1000,
});

let stopping = false;

function shutdown(): void {
  // A second signal, such as Ctrl+C pressed again, does not wait for the games.
  if (stopping) process.exit(0);
  stopping = true;
  logger.info("server_stopping", { drainSeconds });
  setTimeout(() => process.exit(0), drainSeconds * 1000 + EXIT_GRACE_MS).unref();
  void server.close().then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.http.listen(port, () => {
  logger.info("server_started", { port, version, release });
});
