# Game server

`apps/server` is one Node.js process that serves the built client, fills games with players and relays their turns. It never simulates a game ([ADR 0001](adr/0001-deterministic-lockstep.md)); the messages it exchanges with clients are described in [protocol.md](protocol.md). The container image runs it on port 8080 behind a reverse proxy ([ADR 0004](adr/0004-sub-path-hosting.md)).

## Configuration

| Variable                      | Default                                 | Meaning                                                                                           |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `PORT`                        | `8080`                                  | HTTP and WebSocket port                                                                           |
| `FRONTFALL_STATIC`            | `../../client/dist`                     | Directory of the built client                                                                     |
| `FRONTFALL_ORIGINE`           | unset                                   | Only pages from this origin may open a WebSocket, such as `https://nclsmgr.com`. Unset allows any |
| `FRONTFALL_VERSION`           | `dev`                                   | Build identifier returned by `/healthz`; the image sets it to the commit                          |
| `FRONTFALL_MAX_GAMES`         | `500`                                   | Games open or running at once                                                                     |
| `FRONTFALL_MAX_CONNECTIONS`   | `5000`                                  | Open WebSocket connections at once                                                                |
| `NODE_OPTIONS`                | `--max-old-space-size=512` in the image | Caps the JavaScript heap; raise it with the container's memory limit                              |
| `FRONTFALL_COUNTDOWN_SECONDS` | `30`                                    | Countdown of a public game once it has two players                                                |

## Games

| Setting                        | Value                      | Notes                                                                        |
| ------------------------------ | -------------------------- | ---------------------------------------------------------------------------- |
| Players per game               | 16                         | A public game starts at once when full                                       |
| Players to start a public game | 2                          | Then the countdown runs; it stops if a player leaves below 2                 |
| Seat kept after a drop         | 2 minutes                  | The player rejoins with their token and every missed turn                    |
| Longest game                   | 4 hours                    | Then the game ends with reason `timeout`                                     |
| Games at once                  | 500                        | Further `play` and `create` requests get `too_many_games`                    |
| Bots in a private game         | 25                         | Seats shrink to fit the map's `players.max`, never below the players present |
| Game not started               | 10 minutes after it opened | Then the game ends with reason `expired`                                     |
| Private games per address      | 3 not yet started          | Further `create` requests get `too_many_games`                               |

A game is freed as soon as it ends: when its last player leaves before the start, when it has not started ten minutes after it opened, when every player has been gone for two minutes, or at the time limit. Its turn log, about one byte per quiet tick, goes with it.

All running games share one timer that closes a turn every 100 ms. The `frontfall_turn_duration_seconds` histogram measures how long one pass over every game takes.

Private games offer the maps listed in `maps/index.json` of the built client, read once at start. Without that file, only the default map, World, can be picked.

## Limits

One bad client must not spoil a game or the server. Each limit closes the offending connection with a code listed in [protocol.md](protocol.md#close-codes) and is counted in `frontfall_rejected_messages_total`.

| Limit                   | Value                                                         | On breach                              |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------- |
| Connections in all      | 5000                                                          | Upgrade refused with `503`             |
| Connections per address | 8                                                             | Upgrade refused with `429`             |
| Frame size              | 1 KiB                                                         | Closed with `1009`                     |
| Messages per connection | 20 per second, bursts of 40                                   | Closed with `4002`                     |
| Invalid frame           | any frame that fails decoding or checks                       | Closed with `4001`                     |
| Time to say `hello`     | 10 seconds                                                    | Closed with `4003`                     |
| Time out of any game    | 5 minutes after `hello` or the last game                      | Closed with `4003`                     |
| Silence                 | a ping unanswered for 12.5 seconds; pings go every 25 seconds | Connection dropped                     |
| Orders per player       | 10 per turn                                                   | Further orders of the turn are dropped |
| Turn log of a game      | 64 MiB                                                        | Game ends with `timeout`               |

The address of a player is the `X-Client-IP` header, which the reverse proxy must set and overwrite. The server believes that header only when the connection itself comes from a private or loopback address, as a proxy on the same host or Docker network does; from any other peer the header is ignored and the TCP peer address is used. Player names follow the rules in [protocol.md](protocol.md#hello).

## Logs

The server writes one JSON object per line on standard output, read with `docker logs`:

```json
{
  "time": "2026-10-23T21:40:12.031Z",
  "level": "info",
  "event": "game_started",
  "game": "Xk3_9aB-q2Lm",
  "visibility": "public",
  "players": 5
}
```

| Event                 | Level | Fields                                                                                  |
| --------------------- | ----- | --------------------------------------------------------------------------------------- |
| `server_started`      | info  | `port`, `version`                                                                       |
| `server_stopping`     | info  |                                                                                         |
| `game_started`        | info  | `game`, `visibility`, `players`                                                         |
| `game_finished`       | info  | `game`, `reason`, `ticks`                                                               |
| `player_rejoined`     | info  | `game`, `player`, `from`                                                                |
| `desync`              | warn  | `game`, `tick`, `hash` (the player out of step), `expected` (the majority's, or `null`) |
| `connection_rejected` | warn  | `client`, `reason`                                                                      |

Client addresses never appear in clear. `client` is a keyed hash of the address: stable while the process runs, so repeated abuse from one address can be spotted, and impossible to link to the address or across restarts, because the key is drawn at random on start. Player names are not logged.

## Metrics

`GET /metrics` returns the metrics in the Prometheus text format. It answers only requests that reach the server directly from a private or loopback address: any other request, and any request carrying `X-Client-IP`, `X-Forwarded-For`, `Forwarded`, `X-Real-IP` or `CF-Connecting-IP`, which every reverse proxy adds, gets `404`. On the production host:

```sh
curl -s localhost:8080/metrics
```

| Metric                                      | Type      | Meaning                                                            |
| ------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `frontfall_games{state}`                    | gauge     | Games `open`, `starting` (counting down) and `running`             |
| `frontfall_players`                         | gauge     | Players seated in a game with an open connection                   |
| `frontfall_connections`                     | gauge     | Open WebSocket connections                                         |
| `frontfall_games_started_total`             | counter   | Games that started                                                 |
| `frontfall_games_finished_total{reason}`    | counter   | Games that finished: `abandoned`, `timeout`, `expired`, `empty`    |
| `frontfall_desyncs_total`                   | counter   | Games in which a client's state hash differed from the majority's  |
| `frontfall_rejoins_total`                   | counter   | Players who took their seat back after a dropped connection        |
| `frontfall_messages_received_total`         | counter   | Messages received from clients                                     |
| `frontfall_rejected_messages_total{reason}` | counter   | Connections closed: `invalid`, `oversized`, `rate_limited`, `idle` |
| `frontfall_turn_duration_seconds`           | histogram | Time to close and send one turn of every running game              |
| `process_resident_memory_bytes`             | gauge     | Resident memory of the process                                     |
| `process_cpu_seconds_total`                 | counter   | CPU time used by the process                                       |

## HTTP routes

| Path          | Answer                                                   |
| ------------- | -------------------------------------------------------- |
| `/healthz`    | `ok`, with the build in the `X-Frontfall-Version` header |
| `/api/games`  | Public games that have not started, as JSON              |
| `/metrics`    | Metrics, from the host only                              |
| `/ws`         | WebSocket upgrade                                        |
| anything else | Files of the built client                                |

HTML, scripts, styles, JSON, SVG and map files (`.bin`) of 1 KiB or more are sent gzipped to browsers that accept it, with `Vary: Accept-Encoding`. Each file is compressed once, on its first request. Every file carries an `ETag` drawn from its content; maps and other files without a hashed name are sent with `no-cache`, so browsers revalidate them and get `304 Not Modified` until they change. Caddy and Cloudflare pass the compressed body on, and would not compress `.bin` files themselves.

## Shutdown

On `SIGTERM` the server closes every WebSocket with code `1012` and stops listening; it exits within 5 seconds, before Docker's 10-second limit. Games in progress are lost: they live in memory only.
