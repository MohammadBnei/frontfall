import { fileURLToPath } from "node:url";
import { systemClock } from "./clock.ts";
import { ConfigError, loadConfig, serverOptions, type ServerConfig } from "./config.ts";
import { exitOnCrash } from "./crash.ts";
import { jsonLogger } from "./log.ts";
import { createGameServer } from "./server.ts";

/** Past the drain, sockets get this long to close before the process exits anyway. */
const EXIT_GRACE_MS = 5_000;

declare const __FRONTFALL_RELEASE__: string | undefined;
/** Release of the game, the root package.json version, set when the server is bundled. */
const release = typeof __FRONTFALL_RELEASE__ === "string" ? __FRONTFALL_RELEASE__ : "dev";
declare const __FRONTFALL_SIMULATION__: string | undefined;
/** Simulation build of the sources, set when the server is bundled; see docs/protocol.md. */
const simulation = typeof __FRONTFALL_SIMULATION__ === "string" ? __FRONTFALL_SIMULATION__ : "dev";

const logger = jsonLogger();
exitOnCrash(process, logger, (status) => process.exit(status));

/** The settings of the environment; a wrong one stops the start, with every wrong one named. */
function readConfig(): ServerConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    logger.error("config_invalid", {
      count: error.problems.length,
      problems: error.problems.join("; "),
    });
    process.exit(1);
  }
}

const config = readConfig();
const server = createGameServer(
  serverOptions(config, {
    staticRoot: fileURLToPath(new URL("../../client/dist", import.meta.url)),
    release,
    simulation,
    logger,
  }),
);

let stopping = false;

function shutdown(): void {
  // A second signal, such as Ctrl+C pressed again, does not wait for the games.
  if (stopping) process.exit(0);
  stopping = true;
  logger.info("server_stopping", { drainSeconds: config.drainSeconds });
  systemClock.setTimeout(() => process.exit(0), config.drainSeconds * 1000 + EXIT_GRACE_MS).unref();
  void server.close().then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

void server.listen(config.port).then(() => {
  logger.info("server_started", {
    port: config.port,
    version: config.version,
    release,
    simulation,
    operators: config.operatorAccounts.size,
  });
});
