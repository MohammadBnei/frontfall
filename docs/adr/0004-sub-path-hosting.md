# 0004 · Hosting under a sub-path

Status: Accepted · Date: 2026-10-23

## Context

The public server runs at `https://nclsmgr.com/frontfall/`, next to other sites on the same domain. Caddy strips the `/frontfall` prefix, so the game server sees `/`, `/healthz` and `/ws`. Cloudflare sits in front and closes WebSockets that stay silent for 100 seconds. Others will self-host the game, at the root of a domain or under a prefix of their choosing.

## Decision

- The client is built with relative URLs (Vite `base: "./"`). No asset path starts with `/`.
- The WebSocket URL is derived from the page: `new URL("ws", location.href)`, with `wss:` when the page is served over HTTPS. The client knows nothing of the prefix.
- One Node process serves the static client, `/healthz` and `/ws`. It needs no knowledge of the prefix either.
- The server pings every WebSocket every 25 seconds and drops those that do not answer; the client reconnects on its own with backoff.
- The server accepts WebSockets only from the origin in `FRONTFALL_ORIGINE` when it is set, and reads the player's address from `X-Client-IP`, which the reverse proxy sets and overwrites.
- The page loads nothing from other origins: no web fonts, CDN or analytics.
- An end-to-end test serves the built game both at `/` and behind a proxy that adds `/frontfall/`, and checks that the page loads, the WebSocket connects and no request leaves the prefix. After each deployment, the same test runs against the public server.

## Consequences

- The same image runs at any path and any domain without rebuilding.
- `X-Client-IP` is trusted, so the server must never be exposed without a proxy that overwrites it.
- Absolute URLs are a bug the end-to-end test catches before release.
