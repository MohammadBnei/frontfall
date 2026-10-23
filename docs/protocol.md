# Protocol

Clients and the server talk over one WebSocket, in JSON text frames. Every
message is an object with a `type` field. The schemas live in
[`packages/protocol/src/messages.ts`](../packages/protocol/src/messages.ts);
both sides validate each message on arrival with them. This page describes the
protocol as those schemas define it today. It is not versioned yet and will
change before 1.0.

The server never simulates the game. It assigns players an id, collects their
intents, and closes them into numbered turns ten times per second
(`TICK_RATE`). Every client replays the same turns on the same seed and gets
the same game.

## Connection

The socket lives at `ws`, relative to the page that serves the game, so the
game works at the root of a domain or under a sub-path:

| Page                             | WebSocket URL                    |
| -------------------------------- | -------------------------------- |
| `https://nclsmgr.com/frontfall/` | `wss://nclsmgr.com/frontfall/ws` |
| `http://localhost:8080/`         | `ws://localhost:8080/ws`         |

The scheme follows the page: `wss:` for `https:`, `ws:` otherwise. The server
itself only accepts the upgrade on the path `/ws`; a reverse proxy in front of
it strips the sub-path ([ADR 0004](adr/0004-sub-path-hosting.md)).

The upgrade is refused before any message is exchanged when:

| Condition                                                   | Response                |
| ----------------------------------------------------------- | ----------------------- |
| Path other than `/ws`                                       | `403 Forbidden`         |
| `Origin` differs from `FRONTFALL_ORIGINE`, when that is set | `403 Forbidden`         |
| The address already has 8 open sockets                      | `429 Too Many Requests` |

The address is the `X-Client-IP` header set by the reverse proxy, or the TCP
peer address without one.

Once open:

- A frame larger than 4 KiB closes the socket (code 1009).
- The server pings every 25 seconds and terminates a socket that has not
  answered the previous ping. Browsers answer pings on their own.
- On shutdown the server sends `error` with `server restarting`, then closes
  with code 1012.
- The official client reconnects after every close, waiting 0.5 s, then 1 s,
  2 s and so on up to 10 s; the delay resets once a connection opens. A
  reconnection is a new player: ids are not kept across sockets.

## Shared types

| Name       | Definition                                                           |
| ---------- | -------------------------------------------------------------------- |
| `playerId` | String, 1 to 64 characters. The server issues `p1`, `p2`, … per game |
| `tile`     | Integer ≥ 0: the index `y × width + x` of a cell in the world grid   |

### Intent

An order from a player. The server relays intents without checking them
against the game state; each client's engine decides what they do.

| `type`   | Field    | Type        | Meaning                        |
| -------- | -------- | ----------- | ------------------------------ |
| `spawn`  | `tile`   | `tile`      | Cell where the player starts   |
| `attack` | `target` | `tile`      | Cell to attack                 |
|          | `troops` | integer ≥ 1 | Troops committed to the attack |

```json
{ "type": "spawn", "tile": 4194303 }
```

```json
{ "type": "attack", "target": 4198400, "troops": 250 }
```

## Client to server

### `join`

Sent once, right after the socket opens. Enters the named lobby, creating it
if no game of that name is running.

| Field   | Type                                      | Meaning                    |
| ------- | ----------------------------------------- | -------------------------- |
| `lobby` | string, 1 to 64 characters                | Name of the game to join   |
| `name`  | string, 1 to 24 characters after trimming | Display name; not used yet |

```json
{ "type": "join", "lobby": "public", "name": "Guest" }
```

The server answers with `joined`. A second `join` on the same socket is
ignored. When 500 games are already running and the lobby does not exist, the
server answers with `error` (`too many games in progress`) and the socket stays
open without a game.

### `intent`

Sent whenever the player gives an order. The server appends it to the turn in
progress; it reaches every player, the sender included, in the next `turn`.

| Field    | Type     | Meaning   |
| -------- | -------- | --------- |
| `intent` | `Intent` | The order |

```json
{ "type": "intent", "intent": { "type": "attack", "target": 4198400, "troops": 250 } }
```

An intent sent before `join` is ignored.

## Server to client

### `joined`

Answer to `join`.

| Field    | Type       | Meaning                                                       |
| -------- | ---------- | ------------------------------------------------------------- |
| `player` | `playerId` | Id of this player in the game                                 |
| `seed`   | integer    | Seed of the game's random generator, the same for all players |

```json
{ "type": "joined", "player": "p3", "seed": 1804289383 }
```

### `turn`

Sent to every player of a game ten times per second, from the moment the game
is created until its last player leaves. Turns are numbered from 0 and sent in
order, including empty ones. A player who joins late receives turns from the
current tick on, not the earlier ones.

| Field          | Type                                            | Meaning                                                                 |
| -------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `turn.tick`    | integer ≥ 0                                     | Number of the turn                                                      |
| `turn.intents` | array of `{ player: playerId, intent: Intent }` | Intents received during the tick, in the order the server accepted them |

```json
{
  "type": "turn",
  "turn": {
    "tick": 42,
    "intents": [
      { "player": "p1", "intent": { "type": "spawn", "tile": 4194303 } },
      { "player": "p3", "intent": { "type": "attack", "target": 4198400, "troops": 250 } }
    ]
  }
}
```

### `error`

Sent when a message is rejected or the server is going away. The socket stays
open unless the server is shutting down.

| Field     | Type   | Meaning               |
| --------- | ------ | --------------------- |
| `message` | string | Human-readable reason |

```json
{ "type": "error", "message": "malformed JSON" }
```

| Cause                               | `message`                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Frame is not valid JSON             | `malformed JSON`                                                                                            |
| JSON does not match `ClientMessage` | The zod validation report, for example `✖ Invalid input: expected number, received string → at intent.tile` |
| Game limit reached on `join`        | `too many games in progress`                                                                                |
| Server shutting down                | `server restarting`                                                                                         |

Clients drop any server message that fails validation.
