import { fileURLToPath } from "node:url";
import { jsonLogger } from "./log.ts";
import { createGameServer } from "./server.ts";

/** Docker stops the container 10 s after SIGTERM; leave sockets time to close cleanly. */
const SHUTDOWN_GRACE_MS = 5_000;

const port = Number(process.env.PORT ?? 8080);
const logger = jsonLogger();
const version = process.env.FRONTFALL_VERSION ?? "dev";

/** Reads a numeric setting from the environment, ignoring it when unset or invalid. */
function optionalNumber<T>(name: string, use: (value: number) => T): T | undefined {
  const value = Number(process.env[name]);
  return process.env[name] && Number.isFinite(value) && value >= 0 ? use(value) : undefined;
}

const server = createGameServer({
  staticRoot:
    process.env.FRONTFALL_STATIC ?? fileURLToPath(new URL("../../client/dist", import.meta.url)),
  allowedOrigin: process.env.FRONTFALL_ORIGINE,
  version,
  logger,
  publicGame:
    optionalNumber("FRONTFALL_COUNTDOWN_SECONDS", (seconds) => ({
      countdownMs: seconds * 1000,
    })) ?? {},
});

function shutdown(): void {
  logger.info("server_stopping");
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  void server.close().then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.http.listen(port, () => {
  logger.info("server_started", { port, version });
});
