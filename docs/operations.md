# Operations

How the public server at [nclsmgr.com/frontfall](https://nclsmgr.com/frontfall/) runs, and what to do when it misbehaves. Configuration, limits, logs and metrics of the game server itself are described in [server.md](server.md).

The host is configured in [nic0lasm/nclsmgr.com](https://github.com/nic0lasm/nclsmgr.com); its [deploy/frontfall/README.md](https://github.com/nic0lasm/nclsmgr.com/blob/main/deploy/frontfall/README.md) sums up, in French, what the host expects from the image and what it provides in return.

## Where things are

| What            | Where                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Host            | A Debian VPS behind Cloudflare; Caddy terminates TLS, strips `/frontfall` and forwards to the game                          |
| Game            | Compose project `frontfall` in `/opt/frontfall`, one container `frontfall-frontfall-1`, on the internal network `frontfall` |
| Running version | `IMAGE_TAG` in `/opt/frontfall/.env`, the 12-character commit of `main` the image was built from                            |
| Images          | `ghcr.io/nic0lasm/frontfall:<tag>`, built by the Publish workflow for every push to `main`                                  |
| Deployment      | Publish connects over SSH to the `frontfall` account, whose only command is `/usr/local/sbin/frontfall-deployer <tag>`      |
| Compose file    | Maintained with the host configuration, outside this repository: the game repository only chooses the image tag             |
| Uptime check    | Better Stack requests `/healthz` every 3 minutes and emails the maintainer when it fails                                    |

The container restarts on its own after a crash or a reboot (`restart: unless-stopped`), but stays down after a manual `docker stop`. Docker reports it `unhealthy` after three failed health checks in a row; that does not restart it.

## Is it up?

```sh
curl -sSi https://nclsmgr.com/frontfall/healthz
```

`200 ok` with the running commit in `X-Frontfall-Version` means the server plays. `503 stalled` means it accepts requests but closes no turns; restart it. No answer, or a Cloudflare error page, means the container or Caddy is down. On the host:

```sh
docker ps --filter name=frontfall          # status and health
docker stats --no-stream frontfall-frontfall-1
docker exec frontfall-frontfall-1 wget -qO- http://127.0.0.1:8080/metrics
```

## Read the logs

The container logs to journald, one JSON object per line:

```sh
journalctl -t frontfall-frontfall-1 --since "30 min ago"
journalctl -t frontfall-frontfall-1 -f                                  # follow
journalctl -t frontfall-frontfall-1 -o cat --since today | jq -c 'select(.level != "info")'
```

`docker logs frontfall-frontfall-1` shows the same lines. Journald rotates them itself; `journalctl --disk-usage` shows the space they take.

## Restart

```sh
docker restart frontfall-frontfall-1
```

Games in progress live in memory and are lost: players get close code `1012` and land back on the menu. Prefer a quiet moment: the `frontfall_players` metric tells how many people are playing.

## Roll back

A bad release is undone by deploying the previous image with the same command Publish uses. On the host, as the administrator:

```sh
cat /opt/frontfall/.env                                     # the running tag
docker image ls ghcr.io/nic0lasm/frontfall                  # tags kept on the host, newest first
sudo -u frontfall env SSH_ORIGINAL_COMMAND=<tag> /usr/local/sbin/frontfall-deployer
curl -sI https://nclsmgr.com/frontfall/healthz | grep -i x-frontfall-version
```

The deployer pulls the image if the host no longer has it, waits for the container to be healthy and prints `Déployé : <tag>`. It takes under a minute when the image is on the host. Any tag of a commit on `main` works: `git log --first-parent --format=%h --abbrev=12 origin/main` lists them.

The next push to `main` deploys again. Revert the faulty commit on `main` before anything else is merged, or the rollback lasts only until then.

## After an alert

1. Check `/healthz` from your own machine: a Cloudflare or network incident is not a game outage.
2. On the host, `docker ps --filter name=frontfall`. If the container is stopped, start it with `docker start frontfall-frontfall-1`.
3. Read the last logs. A `server_started` line right before the alert means the container crashed and restarted; the lines before it say why.
4. If the alert follows a deployment, roll back to the previous tag.
5. If `/healthz` says `stalled`, restart, then look at `frontfall_turn_duration_seconds` and the number of games before the alert.
