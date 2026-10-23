import { fileURLToPath } from "node:url";
import { createGameServer } from "./server.ts";

/** Docker stops the container 10 s after SIGTERM; leave sockets time to close cleanly. */
const SHUTDOWN_GRACE_MS = 5_000;

const port = Number(process.env.PORT ?? 8080);
const server = createGameServer({
  staticRoot:
    process.env.FRONTFALL_STATIC ?? fileURLToPath(new URL("../../client/dist", import.meta.url)),
  allowedOrigin: process.env.FRONTFALL_ORIGINE,
  version: process.env.FRONTFALL_VERSION ?? "dev",
});

function shutdown(): void {
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  void server.close().then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.http.listen(port, () => {
  console.log(`Frontfall listening on http://localhost:${String(port)}`);
});
