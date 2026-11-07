import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Frame } from "@frontfall/protocol";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type {
  Connection,
  HttpRequest,
  HttpResponse,
  RequestBody,
  Transport,
  TransportHandler,
} from "./transport.ts";

/** The bare answers to a refused WebSocket, written on the socket before any handshake. */
const REFUSALS = {
  403: "HTTP/1.1 403 Forbidden\r\n\r\n",
  429: "HTTP/1.1 429 Too Many Requests\r\n\r\n",
} as const;

export function toFrame(data: RawData, isBinary: boolean): Frame {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  return isBinary
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes.toString("utf8");
}

/** A Node request behind the transport's interface. */
function httpRequest(request: IncomingMessage): HttpRequest & { readonly reading: boolean } {
  let reading = false;
  return {
    method: request.method ?? "GET",
    url: request.url ?? "",
    header(name) {
      const value = request.headers[name];
      return Array.isArray(value) ? value.join(", ") : value;
    },
    // Read when asked: the socket forgets its peer once it is gone.
    get peer() {
      return request.socket.remoteAddress;
    },
    get reading() {
      return reading;
    },
    body(limit) {
      reading = true;
      return new Promise<RequestBody>((resolve) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        request.on("data", (chunk: Buffer) => {
          if (done) return;
          size += chunk.length;
          if (size > limit) {
            done = true;
            resolve({ kind: "too_large" });
            return;
          }
          chunks.push(chunk);
        });
        request.on("end", () => {
          if (done) return;
          done = true;
          resolve({ kind: "read", bytes: Buffer.concat(chunks) });
        });
        request.on("error", () => {
          if (done) return;
          done = true;
          resolve({ kind: "aborted" });
        });
      });
    },
  };
}

function httpResponse(
  request: IncomingMessage,
  wrapped: { readonly reading: boolean },
  response: ServerResponse,
): HttpResponse {
  return {
    send(status, headers, body) {
      response.writeHead(status, headers as OutgoingHttpHeaders | undefined).end(body);
      // A body nobody reads is drained, so the connection can serve the next request.
      if (!wrapped.reading) request.resume();
    },
    abort() {
      request.destroy();
    },
  };
}

/** A `ws` socket behind the transport's interface. */
function connection(socket: WebSocket): Connection {
  return {
    get open() {
      return socket.readyState === socket.OPEN;
    },
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
    send(frame, sent) {
      if (sent) socket.send(frame, sent);
      else socket.send(frame);
    },
    ping() {
      socket.ping();
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    terminate() {
      socket.terminate();
    },
  };
}

/** HTTP from `node:http` and WebSockets from `ws`, on one port. */
export class NodeTransport implements Transport {
  private http: Server | undefined;
  private sockets: WebSocketServer | undefined;
  private readonly wrapped = new WeakMap<WebSocket, Connection>();

  serve(handler: TransportHandler): void {
    const http = createServer((request, response) => {
      const wrapped = httpRequest(request);
      handler.request(wrapped, httpResponse(request, wrapped, response));
    });
    // Headers that trickle in, or a body that never ends, must not hold a socket
    // for minutes: a proxy usually cuts them sooner, a server reached directly relies on this.
    http.headersTimeout = 10_000;
    http.requestTimeout = 30_000;

    const sockets = new WebSocketServer({ noServer: true, maxPayload: handler.maxPayloadBytes });
    http.on("upgrade", (request: IncomingMessage, socket, head) => {
      const answer = handler.upgrade(httpRequest(request));
      if ("refuse" in answer) {
        socket.end(REFUSALS[answer.refuse]);
        return;
      }
      // On the raw socket, not the WebSocket: a refused handshake never makes one.
      if (answer.released) socket.once("close", answer.released);
      sockets.handleUpgrade(request, socket, head, (ws) => {
        const opened = connection(ws);
        this.wrapped.set(ws, opened);
        const events = answer.accept(opened);
        ws.on("pong", () => {
          events.pong();
        });
        // Protocol errors, such as an oversized frame: ws closes the socket itself.
        ws.on("error", (error: Error & { code?: string }) => {
          events.error(
            error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" ? "oversized" : "invalid",
          );
        });
        ws.on("message", (data, isBinary) => {
          events.message(toFrame(data, isBinary));
        });
        ws.on("close", (code) => {
          events.close(code);
        });
      });
    });
    this.http = http;
    this.sockets = sockets;
  }

  listen(port: number, host?: string): Promise<{ port: number }> {
    const http = this.served().http;
    return new Promise((resolve) => {
      const listening = (): void => {
        resolve({ port: (http.address() as AddressInfo).port });
      };
      if (host === undefined) http.listen(port, listening);
      else http.listen(port, host, listening);
    });
  }

  *connections(): Iterable<Connection> {
    for (const ws of this.served().sockets.clients) {
      const found = this.wrapped.get(ws);
      if (found) yield found;
    }
  }

  get connectionCount(): number {
    return this.served().sockets.clients.size;
  }

  close(): Promise<void> {
    const http = this.served().http;
    return new Promise((resolve) => {
      http.close(() => {
        resolve();
      });
    });
  }

  private served(): { http: Server; sockets: WebSocketServer } {
    if (!this.http || !this.sockets) throw new Error("the transport serves no server yet");
    return { http: this.http, sockets: this.sockets };
  }
}
