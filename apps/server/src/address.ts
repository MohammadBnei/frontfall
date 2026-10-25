import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

/**
 * Loopback and private ranges: the host itself, or a reverse proxy on the same
 * machine or container network. Only such peers may tell the server who the
 * player is.
 */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return false;
}

/**
 * Address of the player. A reverse proxy in front of the server sets
 * X-Client-IP and overwrites any value the browser sent; the header is only
 * believed when the request comes from such a proxy, so a server exposed
 * directly cannot be fooled into per-address limits on a forged address.
 */
export function clientAddress(request: IncomingMessage): string {
  const peer = request.socket.remoteAddress;
  const header = request.headers["x-client-ip"];
  const forwarded = (Array.isArray(header) ? header[0] : header)?.trim();
  return (isPrivateAddress(peer) && forwarded) || (peer ?? "unknown");
}

/** Headers a reverse proxy adds to the requests it forwards. */
const PROXY_HEADERS = [
  "x-client-ip",
  "x-forwarded-for",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
];

/** A request from the host or its private network, not forwarded by a proxy. */
export function isLocalRequest(request: IncomingMessage): boolean {
  return (
    isPrivateAddress(request.socket.remoteAddress) &&
    !PROXY_HEADERS.some((name) => name in request.headers)
  );
}

/** A request from inside the container itself, as `docker exec` sends: for admin routes. */
export function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? "";
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  return (
    (ip === "::1" || ip.startsWith("127.")) &&
    !PROXY_HEADERS.some((name) => name in request.headers)
  );
}
