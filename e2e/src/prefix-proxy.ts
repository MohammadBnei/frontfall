import { createServer, request } from "node:http";
import { connect } from "node:net";

/**
 * Stands in for the production reverse proxy: the game is reachable under
 * PREFIX, which is stripped before the request reaches the game server, and
 * the player's address is passed in X-Client-IP.
 */
const PREFIX = "/frontfall";
const port = Number(process.env.PROXY_PORT ?? 8091);
const upstreamPort = Number(process.env.UPSTREAM_PORT ?? 8090);

function strip(url: string | undefined): string | undefined {
  return url?.startsWith(`${PREFIX}/`) ? url.slice(PREFIX.length) : undefined;
}

const proxy = createServer((incoming, outgoing) => {
  const path = strip(incoming.url);
  if (!path) {
    outgoing.writeHead(404).end();
    return;
  }
  const upstream = request(
    {
      host: "127.0.0.1",
      port: upstreamPort,
      path,
      method: incoming.method,
      headers: { ...incoming.headers, "x-client-ip": incoming.socket.remoteAddress },
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () => outgoing.writeHead(502).end());
  incoming.pipe(upstream);
});

proxy.on("upgrade", (incoming, socket, head) => {
  const path = strip(incoming.url);
  if (!path) {
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    return;
  }
  const upstream = connect(upstreamPort, "127.0.0.1", () => {
    const headers: string[] = [];
    for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
      headers.push(`${incoming.rawHeaders[i] ?? ""}: ${incoming.rawHeaders[i + 1] ?? ""}`);
    }
    headers.push(`X-Client-IP: ${incoming.socket.remoteAddress ?? ""}`);
    upstream.write(`GET ${path} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

proxy.listen(port, "127.0.0.1", () => {
  console.log(`Prefix proxy on http://127.0.0.1:${String(port)}${PREFIX}/`);
});
