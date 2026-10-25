# What the game records

Frontfall counts how it is played, to know which maps and modes people use, where they give up and what breaks. It does this without knowing who plays. This page lists everything the game sends, in full. The short version for players is in the README.

## Nothing that points to you

- No account, no cookie, no advertising or analytics service: reports go to the game's own server and nowhere else.
- No player name, no address, no identifier that outlives a game. The page draws a random number for each game, only so that the same game is not counted twice; it is never stored in the browser.
- The server reads each report, adds one to a few counters, and forgets the report. Only the counters are kept: how many games were played on a phone yesterday, not who played them.
- Your network address is held in memory for a few minutes to limit how often one address can report, and is never written down. The server's logs follow the rules in [server.md](server.md#logs).
- A browser set to **Do Not Track** or **Global Privacy Control** sends nothing at all.

## Reports

A page sends three kinds of report to `POST /api/usage`, as JSON of at most 1 kB. The server accepts the exact fields below and refuses anything else.

**A game**, once per game played, when it ends for you: on the end screen, when you go back to the menu, or when you close the tab.

| Field        | Values                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release`    | Version of the game, such as `0.5.0`                                                                                                                                                                                                      |
| `game`       | Random number of the game, used only to count it once                                                                                                                                                                                     |
| `mode`       | `solo`, `public` or `private`                                                                                                                                                                                                             |
| `map`        | The map's id, or `generated`                                                                                                                                                                                                              |
| `teams`      | `0` (everyone for themselves), `2`, `3` or `4`                                                                                                                                                                                            |
| `nations`    | Whether the map's nations played                                                                                                                                                                                                          |
| `bots`       | Number of bots, counted in ranges: 0, 1–5, 6–20, 21–50, 51+                                                                                                                                                                               |
| `humans`     | Number of human players, in ranges: 1, 2, 3–4, 5–8, 9+                                                                                                                                                                                    |
| `difficulty` | `easy`, `normal` or `hard`                                                                                                                                                                                                                |
| `disabled`   | Structures the game left out ([R-MODE-03](rules.md))                                                                                                                                                                                      |
| `minutes`    | Time you played, in ranges: under 2, 2–5, 5–10, 10–20, 20–40, 40+                                                                                                                                                                         |
| `outcome`    | `victory`; `defeat`, the game was lost or you were wiped out; `left`, you went back to the menu while still in the game; `closed`, the tab was closed; `disconnected`, an online game was lost to the connection or stopped by the server |
| `device`     | `phone`, `tablet` or `desktop`, from the size of the screen and the kind of pointer                                                                                                                                                       |
| `touch`      | Whether the screen is a touch screen                                                                                                                                                                                                      |
| `lang`       | Language of the game, `en` or `fr`                                                                                                                                                                                                        |
| `view`       | `flat` map or `globe`                                                                                                                                                                                                                     |

**An error**, at most five per visit: an error the game did not catch (`exception`, `rejection`), the simulation failing (`worker`), no WebGL 2 (`webgl`), the graphics context lost (`context_lost`), or a game out of step with the other players (`desync`). An error from the game's own code may come with its message, cut to 120 characters, with web addresses, file paths, anything in quotes and every number taken out, first by the page and again by the server. The message is not counted or stored: it is written once to the server's log, at most 60 times an hour, so that a developer can find the bug.

**A vote**, if you give one on the end screen: thumbs `up` or `down`, the game's `mode` and `outcome`, and, after a thumbs down, one reason if you pick it: `too_hard`, `too_long`, `unclear` (you did not know what to do) or `slow_or_buggy`. There is no free text. One vote per game.

## What is published

`GET /api/stats` returns the counters as JSON, for every day of the last 90 days (UTC) and in total, for anyone to read or export:

```json
{
  "release": "0.5.0",
  "since": "2026-10-25",
  "total": { "games": { "solo": 120, "public": 40 }, "device": { "phone": 52, "desktop": 108 } },
  "days": [{ "day": "2026-10-25", "counts": { "games": { "solo": 12 } } }]
}
```

Each counter is one dimension, such as `games` by mode or `map` by map, never a combination that could narrow down to one player. The same totals are in `/metrics` as `frontfall_usage_total{dimension, value}`. With `FRONTFALL_DATA` set, the server keeps the counters in `usage/usage.json` under that directory, readable by its own user only, so that they survive a restart.

## Ideas and bugs

The end screen and the menu link to GitHub: **Share an idea** opens the [Frontfall Ideas](https://github.com/nic0lasm/frontfall/discussions) discussions, **Report a bug** the bug form with the game's version filled in. Both need a GitHub account and are public; nothing is sent until you post.
