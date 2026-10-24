# Network protocol

Version 4. Clients and the game server talk over one WebSocket per player. The schemas live in [`packages/protocol`](../packages/protocol/src), which the client and the server both import; this page describes them for anyone writing a bot, a replay tool or another client.

The server never simulates the game ([ADR 0001](adr/0001-deterministic-lockstep.md)). It fills games with players, gives every player a number, then closes the orders it receives into one numbered turn every 100 ms and sends the same turns to every player. Each client runs the engine on those turns and reaches the same state.

## Connection

The socket opens at `ws` next to the page: `wss://nclsmgr.com/frontfall/ws` in production, `ws://localhost:8080/ws` locally. The server refuses the upgrade with `403` when an `Origin` header is sent and is not the configured one, with `429` when the player's address already holds too many connections, and with `503` when the server holds as many connections as it accepts. Browsers always send `Origin`; tools such as bots may leave it out.

Two kinds of frames travel on the socket:

- **Text frames** carry one JSON object with a `type` field. All control messages use them.
- **Binary frames** carry orders (client to server) and turns (server to client), which make up nearly all of the traffic. Their encoding is described [below](#binary-frames).

Every frame is validated after decoding. A client frame that cannot be decoded, has unknown fields or breaks a rule closes the connection with code `4001`. Frames larger than 1 KiB close it with `1009`.

The server pings every 25 seconds and drops a connection that missed the previous ping. Browsers answer pings on their own.

## A game, step by step

```text
client                                   server
  | -- hello { version: 4, name } ---------> |
  | <------------------ welcome { version } -- |
  | -- play ---------------------------------> |   or create, or join { game }
  | <-------------- lobby { players, ... } --- |   again after every change
  | <------- started { seed, players, ... } -- |
  | <----------------------- turns (binary) -- |   one frame per tick, from tick 0
  | -- order (binary) -----------------------> |
  | <------- turns: tick n holds the order --- |
  | -- hash { tick, hash } ------------------> |   every 50 ticks
```

1. **Hello.** The first message of every connection. The server checks the protocol version and the player name, then answers `welcome`. A connection that sends nothing within 10 seconds is closed with `4003`.
2. **Lobby.** The player joins a public game (`play`), opens a private one (`create`) or joins one by id (`join`). The server sends `lobby` to everyone in the game each time a player arrives or leaves.
3. **Start.** A public game counts down 30 seconds once it has two players, and starts at once when it is full. The host of a private game may change its map, bots and difficulty with `configure`, then starts it with `start`. Every player receives `started` with the seed, the final player numbers and a reconnect token.
4. **Turns.** From tick 0, the server sends one turn every 100 ms, with or without orders. A client runs tick `n` only after receiving turn `n`.
5. **End.** The server sends `ended` when every player is gone, when the game reaches four hours, or when a game has not started ten minutes after it opened. A client that leaves earlier sends `leave`. Either way, the connection can join another game.

### Player numbers

Players are numbered from 1 in the order they joined. Numbers in `lobby` messages can change while players come and go; the numbers in `started` are final and are the ids the engine uses (0 is the neutral owner of the map).

### Reconnecting

If the connection drops during a game, the seat stays reserved for two minutes. The client opens a new connection, says `hello`, then sends `rejoin` with its token and the first tick it has not run. The server answers with `started` again, then every turn from that tick, in frames of up to 2,000 turns, then the live turns. While the player is away, the game goes on without their orders.

A token works for one connection at a time. If the server still holds a connection for the seat, it answers `token_in_use` and checks that connection with a ping: a connection that does not answer within 5 seconds is dropped, and the next `rejoin` succeeds.

Before a game starts, a dropped connection gives its seat up. The client joins again with the same request.

## Client messages

### `hello`

```json
{ "type": "hello", "version": 4, "name": "Léa", "build": "0d25e267bbae" }
```

First message of every connection. `version` is `PROTOCOL_VERSION`. A server running another version closes the connection with `4000`: the page is out of date and must be reloaded. This message keeps the same shape in every version of the protocol, so the mismatch can always be reported.

`build`, optional, is the commit the page was built from. The server also closes the connection with `4000` when it runs another build, since the engine or the balance may differ and the game would desynchronise. `dev` builds, on either side, are always accepted.

The name is cleaned up (Unicode NFC, trimmed, runs of spaces collapsed) and must then hold 1 to 20 characters: letters and digits of any script, spaces, `.`, `_`, `'` and `-`, starting with a letter or a digit. Names that pass for the people running the game, such as `admin` or `Frontfall`, are refused. A refused name gets an `invalid_name` error and the client may send `hello` again. Once accepted, a second `hello` closes the connection.

### `play`

```json
{ "type": "play" }
```

Joins the public game with the most players that has not started, or opens a new one.

### `create`

```json
{ "type": "create" }
```

Opens a private game. The creator is its host. The game id in the next `lobby` message is the invitation: the client shares it as a link, `https://nclsmgr.com/frontfall/?game=<id>`. Game ids hold 72 random bits.

### `join`

```json
{ "type": "join", "game": "Xk3_9aB-q2Lm" }
```

Joins a game by id, public or private, before it starts.

### `rejoin`

```json
{ "type": "rejoin", "token": "q8Vb1aV9mN3x0WcY2tLk4Q", "from": 1200 }
```

Takes back a seat after a dropped connection; see [Reconnecting](#reconnecting). `from` is the first tick the client has not received.

### `configure`

```json
{ "type": "configure", "options": { "map": "europe", "bots": 6, "difficulty": "hard" } }
```

The host of a private game sets its map, its number of bots and how hard they play, until the game starts. Every option is sent each time. `map` is the id of a map in `maps/index.json`; `difficulty` is `easy`, `normal` or `hard`. The server adds at most 25 bots. Bots and seats share the most players the map allows (`players.max` in the catalog): the game keeps its 16 seats when they fit and fewer otherwise, but never fewer than the players already in. Every player receives the new options and `capacity` in `lobby`. A new private game starts on World, without bots, at `normal`.

### `start`

```json
{ "type": "start" }
```

The host of a private game starts it with the players present.

### `leave`

```json
{ "type": "leave" }
```

Leaves the current game for good. Before the start, the seat is freed; after it, the seat cannot be taken back. The server answers `ended` with reason `left`.

### `hash`

```json
{ "type": "hash", "tick": 1250, "hash": 3735928559 }
```

The client's 32-bit hash of its game state after running `tick`, sent for every tick that is a multiple of `HASH_INTERVAL` (50); other ticks are ignored, and so is a second hash from the same player for the same tick. Once every connected player has reported a tick, or a minute of play later, the server compares the hashes. Players whose hash differs from the majority's receive `desync`; when no majority exists, as with two players who disagree, every player who reported does. A client sending wrong hashes can only single itself out. The client of this repository computes them in its worker with the engine's `game.hash()` as it runs the turns, and sends them.

### `order`

Binary frame. An order of the local player, in the shape of the engine's `Order`:

| Order     | Fields                     | Meaning                                         |
| --------- | -------------------------- | ----------------------------------------------- |
| `spawn`   | `tile`                     | Choose a starting tile during the spawn phase   |
| `attack`  | `target`, `troops` (`> 0`) | Send troops towards a tile                      |
| `retreat` | `attack` (`> 0`)           | Call back one of the player's attacks by its id |
| `embark`  | `target`, `troops` (`> 0`) | Ship troops to a coastal tile                   |

Tiles are indexes in the map, below 2^31. The server checks only the shape of an order; whether it can be carried out is decided by the engine of every client, the same way everywhere. Orders sent outside a running game are ignored.

## Server messages

### `welcome`

```json
{ "type": "welcome", "version": 4 }
```

The hello was accepted.

### `lobby`

```json
{
  "type": "lobby",
  "game": "Xk3_9aB-q2Lm",
  "visibility": "public",
  "map": "world",
  "bots": 0,
  "difficulty": "normal",
  "capacity": 16,
  "players": [
    { "id": 1, "name": "Nico" },
    { "id": 2, "name": "Léa" }
  ],
  "you": 2,
  "host": null,
  "startsIn": 30000
}
```

The game being filled, sent after every change, the host's `configure` included. `host` is the host's number in a private game and `null` in a public one. `startsIn` is the time left before the start in milliseconds, or `null` while no countdown runs.

### `started`

```json
{
  "type": "started",
  "game": "Xk3_9aB-q2Lm",
  "map": "world",
  "seed": 1834567,
  "bots": 0,
  "difficulty": "normal",
  "tickRate": 10,
  "players": [
    { "id": 1, "name": "Nico" },
    { "id": 2, "name": "Léa" }
  ],
  "you": 2,
  "token": "q8Vb1aV9mN3x0WcY2tLk4Q"
}
```

Everything a client needs to create the same game as the others: map, seed, players and the number of bots each client adds and runs itself, at `difficulty`. The server relays only human orders. `token` is secret: it lets this player rejoin after a dropped connection. The message is sent again after a successful `rejoin`.

### `turns`

Binary frame. One or more consecutive turns:

```json
{
  "type": "turns",
  "turns": [
    { "tick": 1250, "orders": [] },
    {
      "tick": 1251,
      "orders": [{ "player": 2, "order": { "type": "attack", "target": 81234, "troops": 3000 } }]
    }
  ]
}
```

Live play sends one turn per frame. Within a turn, orders are listed in the order the server received them, and every client applies them in that order.

### `desync`

```json
{ "type": "desync", "tick": 1250, "hash": 3735928559, "expected": 305419896 }
```

This player's hash for `tick` differed from the majority's: its game no longer matches the others. `hash` is the one this player sent, `expected` the majority's, or `null` when no majority exists. With the seed, the options and the turns the client already holds, they make a complete report of the desync. Sent once per player, and again when that player rejoins.

### `ended`

```json
{ "type": "ended", "reason": "abandoned" }
```

The game is over for this connection. Reasons: `abandoned` (every player is gone), `timeout` (four hours, or a turn log grown past its size limit), `expired` (not started ten minutes after it opened), `left` (answer to `leave`).

### `error`

```json
{ "type": "error", "code": "game_full", "message": "the game is full" }
```

A request was refused; the connection stays open. `message` is for people, `code` for programs:

| Code               | Answer to                    | Meaning                                                |
| ------------------ | ---------------------------- | ------------------------------------------------------ |
| `invalid_name`     | `hello`                      | The name breaks the name rules                         |
| `not_found`        | `join`                       | No game has this id                                    |
| `game_full`        | `join`                       | The game has no free seat                              |
| `game_started`     | `join`, `configure`, `start` | The game has already started                           |
| `already_in_game`  | `play`, `create`, `join`     | Leave the current game first                           |
| `not_in_game`      | `configure`, `start`         | The connection is not in a game                        |
| `not_host`         | `configure`, `start`         | Only the host of a private game can change or start it |
| `invalid_settings` | `configure`                  | No published map has this id, or too many bots for it  |
| `too_many_games`   | `play`, `create`             | The server holds as many games as it can               |
| `token_invalid`    | `rejoin`                     | The game is over or the seat was given up              |
| `token_in_use`     | `rejoin`                     | Another connection holds the seat; retry in 1 s        |

## Close codes

| Code   | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| `1009` | A frame was larger than 1 KiB                                   |
| `1012` | The server is restarting; games in progress are lost            |
| `4000` | Another protocol version or build: reload the page              |
| `4001` | A frame could not be decoded or broke a rule                    |
| `4002` | More than 20 messages per second on average, or bursts above 40 |
| `4003` | No `hello` within 10 seconds, or out of any game for 5 minutes  |
| `4004` | Another connection took over this player (reserved)             |

## Binary frames

Integers are unsigned LEB128 varints: 7 bits per byte, low bits first, the high bit set on every byte but the last. Values go up to 2^53 - 1, use at most 8 bytes and must be minimally encoded. Tick 1,251 takes two bytes; an attack of 3,000 troops on tile 81,234 takes six.

The first byte of a frame gives its kind:

| Byte | Frame   | Direction        | Content                                |
| ---- | ------- | ---------------- | -------------------------------------- |
| `1`  | `turns` | server to client | first tick, turn count, then each turn |
| `2`  | `order` | client to server | one order                              |

A turn is its order count, then for each order the player number and the order. An order is its kind code followed by its fields, in this order:

| Code | Order     | Fields             |
| ---- | --------- | ------------------ |
| `0`  | `spawn`   | `tile`             |
| `1`  | `attack`  | `target`, `troops` |
| `2`  | `retreat` | `attack`           |
| `3`  | `embark`  | `target`, `troops` |

The table is `ORDER_KINDS` in [`orders.ts`](../packages/protocol/src/orders.ts). New orders are added at the end, so existing codes never change. A frame with trailing bytes, an unknown kind or a count larger than the rest of the frame could hold is refused. A client that receives a `turns` frame it cannot read stops and asks for a reload: skipping a turn would desynchronise its game.

A turn with 32 orders takes about a tenth of its JSON size (214 bytes against 2,059 in the protocol tests' example); an empty turn takes 4 to 6 bytes with its header, depending on the tick.

## HTTP endpoints

| Path         | Answer                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `/healthz`   | `ok`, with the running build in the `X-Frontfall-Version` header                                        |
| `/api/games` | Public games that have not started: `{ "games": [{ "id", "map", "players", "capacity", "startsIn" }] }` |

## Versioning

Client and server ship together in one image, so a mismatch only affects pages loaded before a deployment. Two checks catch them, both answered with close code `4000` and a reload. `PROTOCOL_VERSION` changes when a message changes shape or an order kind is added: version 2 added `retreat` and `embark`, version 3 the game options (`configure`, `bots` and `difficulty` in `lobby`, `difficulty` in `started`), version 4 the hashes in `desync`. The `build` sent in `hello` catches everything else, such as a change of the engine or the balance, which leaves the protocol as it is but would desynchronise an older page. The protocol makes no promise of compatibility between builds: an older page is always sent away.
