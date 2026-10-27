# Hosting your own server

Frontfall is one Docker image: a Node.js server that serves the game's pages and relays the turns of online games. It needs no database and no other service. A small virtual machine with 1 GB of memory runs it; the games themselves are simulated in the players' browsers.

## Try it on your machine

```sh
docker run --rm -p 8080:8080 ghcr.io/nic0lasm/frontfall:latest
```

Open http://localhost:8080. Solo games work at once. For online games, send the invitation link to someone who can reach your machine, or open it in a second tab.

## Run it for good

The [`compose.yaml`](../compose.yaml) at the root of the repository is a ready setup: copy it to your server, then

```sh
docker compose up -d
docker compose ps          # "healthy" after a few seconds
```

What it sets, and why:

| Line                                        | Why                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `image`                                     | `latest` follows each release of `main`. To choose when to update, pin a commit tag such as `ghcr.io/nic0lasm/frontfall:0d25e267bbae`, or a release tag such as `0.4.0`              |
| `FRONTFALL_DATA` and the volume             | The usage counts survive restarts in the `frontfall-data` volume, and so do the games in progress, unless the new image changes the [simulation build](protocol.md#simulation-build) |
| `FRONTFALL_ORIGINE`                         | The address players open, such as `https://games.example.org`: other sites then cannot open games on your server from their pages                                                    |
| `FRONTFALL_SEATS_PER_ADDRESS`, not set      | A public game takes at most 3 players from one address. Players behind one router, as at a LAN party, share it: set 0 to lift the limit, or a higher number                          |
| `FRONTFALL_CONNECTIONS_PER_MINUTE`, not set | One address opens at most 30 connections a minute after a first 40. Raise it if many players reach the server through one address                                                    |
| `read_only` and `tmpfs`                     | The server writes only to its data volume and `/tmp`                                                                                                                                 |
| `stop_grace_period`                         | On a stop, running games get 20 seconds to end, and players are told why                                                                                                             |
| `restart` and `mem_limit`                   | Back after a crash or a reboot; the image keeps its heap at 512 MB, well inside 1 GB                                                                                                 |

The usage counts also keep a copy of the previous save and one file per month in `usage/months/` of the volume, which you can keep or collect ([server](server.md#usage-counts)).

Every setting the server reads is listed in [server.md](server.md#configuration).

### Sign-in with Discord or Google

Optional: without it, players play as guests and the menu shows no sign-in. To offer it, create an application at the [Discord developer portal](https://discord.com/developers/applications) (OAuth2, redirect `https://<your address>/auth/discord/callback`) or an OAuth client of type "Web application" in the [Google Cloud console](https://console.cloud.google.com/apis/credentials) (redirect `https://<your address>/auth/google/callback`), then set, next to `FRONTFALL_DATA`:

```yaml
FRONTFALL_PUBLIC_URL: https://games.example.org
FRONTFALL_SESSION_SECRET: ${FRONTFALL_SESSION_SECRET} # openssl rand -base64 48, kept in an .env file
FRONTFALL_OAUTH_DISCORD_ID: "123456789012345678"
FRONTFALL_OAUTH_DISCORD_SECRET: ${FRONTFALL_OAUTH_DISCORD_SECRET}
```

The Google pair is `FRONTFALL_OAUTH_GOOGLE_ID` and `FRONTFALL_OAUTH_GOOGLE_SECRET`. The container must reach Discord and Google over HTTPS. Changing the session secret signs every player out and does nothing else; the accounts live in the data volume ([server.md](server.md#accounts)).

To update: `docker compose pull && docker compose up -d`. To build the image from the source instead: `docker build -t frontfall .`, then set `FRONTFALL_IMAGE=frontfall` when running `docker compose`.

## HTTPS and a domain

Browsers need HTTPS for anything but `localhost`, so put a reverse proxy in front. It must forward WebSocket upgrades on `/ws`, and set the `X-Client-IP` header to the player's address, which the server uses for its limits per address. The server trusts that header only from a private or loopback address, as a proxy on the same host or Docker network is.

With [Caddy](https://caddyserver.com/), which gets the certificate itself:

```caddyfile
games.example.org {
	reverse_proxy localhost:8080 {
		header_up X-Client-IP {client_ip}
	}
}
```

With nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Client-IP $remote_addr;
    proxy_read_timeout 120s;
}
```

The game also works under a path, such as `https://example.org/frontfall/`: have the proxy strip the prefix (`handle_path /frontfall/*` in Caddy, `location /frontfall/ { proxy_pass http://127.0.0.1:8080/; … }` in nginx). Its pages and its WebSocket use relative addresses, so nothing else changes ([ADR 0004](adr/0004-sub-path-hosting.md)).

A proxy that closes quiet connections must allow at least 30 seconds: the server pings every 25.

## Is it working?

| Address    | Answer                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `/healthz` | `ok`, with the build in `X-Frontfall-Version`; `503` when the server is stuck or stopping                |
| `/status`  | A page with the players online, the games running and the version                                        |
| `/metrics` | Prometheus metrics, only from the host: `docker compose exec frontfall wget -qO- localhost:8080/metrics` |

Logs are one JSON object per line: `docker compose logs -f`. [operations.md](operations.md) describes how the public server is run, from restarts to rollbacks; most of its commands work on yours with the name of your container.

The game serves its pages with a content security policy that keeps them out of frames and only runs their own code. A proxy may replace that header with its own.

Each release of Frontfall checks this setup: CI builds the image, starts it with `compose.yaml`, plays solo and private games against it, and restarts it to check that the data volume is kept.
