# Game server

`apps/server` is one Node.js process that serves the built client, fills games with players and relays their turns. It never simulates a game ([ADR 0001](adr/0001-deterministic-lockstep.md)); the messages it exchanges with clients are described in [protocol.md](protocol.md). The container image runs it on port 8080 behind a reverse proxy ([ADR 0004](adr/0004-sub-path-hosting.md)).

## Configuration

| Variable                      | Default                                 | Meaning                                                                                                                   |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                        | `8080`                                  | HTTP and WebSocket port                                                                                                   |
| `FRONTFALL_STATIC`            | `../../client/dist`                     | Directory of the built client                                                                                             |
| `FRONTFALL_ORIGINE`           | unset                                   | Only pages from this origin may open a WebSocket, such as `https://nclsmgr.com`. Unset allows any                         |
| `FRONTFALL_VERSION`           | `dev`                                   | Build identifier returned by `/healthz`; the image sets it to the commit                                                  |
| `FRONTFALL_MAX_GAMES`         | `500`                                   | Games open or running at once                                                                                             |
| `FRONTFALL_MAX_CONNECTIONS`   | `5000`                                  | Open WebSocket connections at once                                                                                        |
| `NODE_OPTIONS`                | `--max-old-space-size=512` in the image | Caps the JavaScript heap; raise it with the container's memory limit                                                      |
| `FRONTFALL_COUNTDOWN_SECONDS` | `60`                                    | Countdown of a game opened by "Play now", from its first player; 1 at least                                               |
| `FRONTFALL_DRAIN_SECONDS`     | `20`                                    | After `SIGTERM`, how long running games may go on; keep it below the container's stop grace period                        |
| `FRONTFALL_DATA`              | unset                                   | Directory kept across restarts, such as `/var/lib/frontfall`; the usage counts go in `usage/`. Unset keeps them in memory |

## Games

| Setting                        | Value                      | Notes                                                                                                   |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Players per game               | 2 to 16, set by the host   | A game set to start when full (the default) starts as its last seat is taken                            |
| Players to start a public game | 2                          | The host starts it; any number for a private game                                                       |
| "Play now" countdown           | 60 seconds                 | From the first player, 30 s at least after the second; alone at the end, the map's default bots fill in |
| Host away                      | 2 minutes                  | With other players waiting, the role goes to the one seen most recently                                 |
| Seat kept after a drop         | 5 minutes                  | The player rejoins with their token and every missed turn                                               |
| Lobby seat kept after a drop   | 30 seconds                 | The player gets their place back, and the host keeps the role (see below)                               |
| Longest game                   | 4 hours                    | Then the game ends with reason `timeout`                                                                |
| Games at once                  | 500                        | Further `play` and `create` requests get `too_many_games`                                               |
| Bots in a game                 | 25                         | Seats shrink to fit the map's `players.max`, never below the players present                            |
| Game not started               | 10 minutes after it opened | Then the game ends with reason `expired`                                                                |
| Lobbies per address            | 3 not yet started          | Public and private; further `create` requests get `too_many_lobbies`                                    |
| Public games listed            | 100                        | Waiting ones first, the fewest free seats first, then the oldest                                        |

A connection that drops without a close frame, as when a phone goes to sleep or the network fails, keeps its seat in a lobby for 30 seconds: the client takes it back with the token of the `lobby` message, or lands in the game if it started meanwhile. A page that closes its socket itself, on a reload or when the tab closes, gives its lobby seat up at once.

A game is freed as soon as it ends: when its last player leaves before the start, when it has not started ten minutes after it opened, when every player has been gone for five minutes, or at the time limit. Its turn log, about one byte per quiet tick, goes with it.

All running games share one timer that closes a turn every 100 ms. The `frontfall_turn_duration_seconds` histogram measures how long one pass over every game takes.

Games offer the maps listed in `maps/index.json` of the built client, read once at start. Without that file, only the default map, World, can be picked.

## Limits

One bad client must not spoil a game or the server. Each limit closes the offending connection with a code listed in [protocol.md](protocol.md#close-codes) and is counted in `frontfall_rejected_messages_total`.

| Limit                   | Value                                                         | On breach                              |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------- |
| Connections in all      | 5000                                                          | Upgrade refused with `503`             |
| Connections per address | 16, for players behind one router or mobile carrier           | Upgrade refused with `429`             |
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

| Event                 | Level | Fields                                                                                    |
| --------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `server_started`      | info  | `port`, `version`                                                                         |
| `server_stopping`     | info  |                                                                                           |
| `game_started`        | info  | `game`, `visibility`, `players`                                                           |
| `game_finished`       | info  | `game`, `reason`, `ticks`                                                                 |
| `player_rejoined`     | info  | `game`, `player`, `from`                                                                  |
| `desync`              | warn  | `game`, `tick`, `hash` (the player out of step), `expected` (the majority's, or `null`)   |
| `connection_rejected` | warn  | `client`, `reason`                                                                        |
| `client_error`        | warn  | `type`, `release`, `message` (scrubbed, see [privacy.md](privacy.md)); 60 an hour at most |
| `usage_in_memory`     | warn  | `reason`: no data directory, the usage counts are lost at the next restart                |
| `usage_not_loaded`    | warn  | `error`: the counts kept by the last run could not be read                                |
| `usage_not_saved`     | warn  | `error`                                                                                   |

Client addresses never appear in clear. `client` is a keyed hash of the address: stable while the process runs, so repeated abuse from one address can be spotted, and impossible to link to the address or across restarts, because the key is drawn at random on start. Player names are not logged.

## Metrics

`GET /metrics` returns the metrics in the Prometheus text format. It answers only requests that reach the server directly from a private or loopback address: any other request, and any request carrying `X-Client-IP`, `X-Forwarded-For`, `Forwarded`, `X-Real-IP` or `CF-Connecting-IP`, which every reverse proxy adds, gets `404`. On the production host:

```sh
curl -s localhost:8080/metrics
```

| Metric                                                | Type      | Meaning                                                            |
| ----------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `frontfall_games{state}`                              | gauge     | Games `open`, `starting` (counting down) and `running`             |
| `frontfall_players`                                   | gauge     | Players seated in a game with an open connection                   |
| `frontfall_connections`                               | gauge     | Open WebSocket connections                                         |
| `frontfall_games_started_total{visibility,map,teams}` | counter   | Games that started                                                 |
| `frontfall_games_finished_total{reason}`              | counter   | Games that finished: `abandoned`, `timeout`, `expired`, `empty`    |
| `frontfall_desyncs_total`                             | counter   | Games in which a client's state hash differed from the majority's  |
| `frontfall_rejoins_total`                             | counter   | Players who took their seat back after a dropped connection        |
| `frontfall_messages_received_total`                   | counter   | Messages received from clients                                     |
| `frontfall_rejected_messages_total{reason}`           | counter   | Connections closed: `invalid`, `oversized`, `rate_limited`, `idle` |
| `frontfall_game_duration_minutes`                     | histogram | Length of the games that finished                                  |
| `frontfall_turn_duration_seconds`                     | histogram | Time to close and send one turn of every running game              |
| `frontfall_usage_total{dimension,value}`              | counter   | Reports of players' pages ([privacy.md](privacy.md))               |
| `process_resident_memory_bytes`                       | gauge     | Resident memory of the process                                     |
| `process_cpu_seconds_total`                           | counter   | CPU time used by the process                                       |

## HTTP routes

| Path                 | Answer                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/healthz`           | `ok`, or `503` (see below), with the build in the `X-Frontfall-Version` header and the release in `X-Frontfall-Release` |
| `/api/games`         | Public games that have not started, and the number of games running, as JSON                                            |
| `/status`            | A page for people: players online, games running, lobbies, an announced restart, release and build                      |
| `/api/status`        | The same as JSON: `version`, `release`, `state`, `players`, `running`, `lobbies`, `restartInMs`                         |
| `/admin/maintenance` | `POST ?minutes=N` announces a restart in N minutes to every player, `0` calls it off; from inside the container only    |
| `/api/stats`         | Usage counts per day and in total, as JSON ([privacy.md](privacy.md)); the last 7 days are also on `/status`            |
| `/api/usage`         | `POST` only: a report of a player's page ([privacy.md](privacy.md)); `204`, or `400`, `403`, `413`, `415`, `429`        |
| `/metrics`           | Metrics, from the host only                                                                                             |
| `/ws`                | WebSocket upgrade                                                                                                       |
| anything else        | Files of the built client                                                                                               |

HTML, scripts, styles, JSON, SVG and map files (`.bin`) of 1 KiB or more are sent gzipped to browsers that accept it, with `Vary: Accept-Encoding`. Each file is compressed once, on its first request. Every file carries an `ETag` drawn from its content; maps and other files without a hashed name are sent with `no-cache`, so browsers revalidate them and get `304 Not Modified` until they change. Caddy and Cloudflare pass the compressed body on, and would not compress `.bin` files themselves.

## Health check

`/healthz` answers `200 ok` while the turn timer runs. The timer runs whether or not any game is in progress, so an idle server is healthy. It answers `503 stalled` when no turn has been closed for 5 seconds, and `200 ok` again from the next turn, and `503 stopping` to requests still in flight while it shuts down. A blocked event loop does not answer at all, which a check with a timeout reports as well. The deployment waits for this route, the image's `HEALTHCHECK` polls it, and an external uptime check alerts on it: Better Stack requests it from outside every 3 minutes and emails the maintainer when it fails, so an outage is known within about 6 minutes. What to do then is in [operations.md](operations.md). Docker only marks an unhealthy container as such; it does not restart it.

## Shutdown

Games live in memory only, so a restart would cut them short. Three things keep that from happening:

1. **The deployment announces the update, then waits.** Before rolling out a new image, the Publish workflow reads `running` from `/api/games`, the games started with a player connected or away but still holding a seat. If some are running, it asks the server, through its deploy command, to announce the update in 10 minutes (`ANNONCE_MINUTES`): every page shows a band counting the minutes down, players who arrive meanwhile included. Then it waits for `running` to reach 0, for those 10 minutes at most. Run the workflow by hand with `now` ticked to deploy at once.
2. **The server drains.** On `SIGTERM` it stops opening games: `play`, `create` and `join` get the error `restarting`, while players of a running game can still `rejoin`. Lobbies end at once with reason `restart`. Running games play on until their players leave or lose their seat, for `FRONTFALL_DRAIN_SECONDS` at most, and their players see the band with the time left; `/healthz` answers `503 stopping` meanwhile.
3. **Players are told.** When the drain ends, every game still running ends with reason `restart`, and every WebSocket closes with code `1012`. The page says the game was stopped for an update; reconnecting then finds the new build and asks for a reload.

The process exits 5 seconds after the drain at the latest. A second `SIGTERM` or `SIGINT` exits at once. With the default 20 seconds, a drain fits within the 30-second stop grace period of the production host; a longer drain needs a longer grace period, or Docker kills the process before players are told.
