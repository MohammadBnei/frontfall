# Contributing to Frontfall

Thanks for taking the time to help. This page explains how to propose a change and what a pull request needs before it is merged.

## Your first contribution

1. Pick an issue labelled [`good first issue`](https://github.com/nic0lasm/frontfall/labels/good%20first%20issue) or [`help wanted`](https://github.com/nic0lasm/frontfall/labels/help%20wanted).
2. Comment on it to claim it, so nobody else starts the same work.
3. If you get stuck, ask in [Discussions](https://github.com/nic0lasm/frontfall/discussions). No question is too small.
4. Open a draft pull request early. Feedback on a sketch is cheaper than on a finished change.

## Before you start

- **Bugs**: open an issue with the bug form, including steps to reproduce.
- **Ideas and questions**: start in [Discussions](https://github.com/nic0lasm/frontfall/discussions). Agreeing on the idea first saves everyone a rewrite.
- **Larger changes**: comment on the issue to say you are working on it, and share your approach before writing much code.

## Set up

```sh
corepack enable
pnpm install
pnpm dev
```

The repository is a pnpm workspace:

| Path                | Contents                                    |
| ------------------- | ------------------------------------------- |
| `packages/engine`   | Deterministic simulation, no dependencies   |
| `packages/protocol` | Message schemas shared by client and server |
| `apps/server`       | Lobbies, turn relay, static file server     |
| `apps/client`       | Browser client, Three.js rendering          |
| `tools`             | Repository checks, clean-room scan          |
| `e2e`               | Playwright tests of the built game          |

Design documents live in `docs/`: the game rules ([rules.md](docs/rules.md)), their numbers ([balance.md](docs/balance.md)) and the architecture decisions ([adr/](docs/adr/)).

## Clean room

Frontfall is written from scratch. Gameplay work starts from [docs/rules.md](docs/rules.md); do not read other games' source code while working on Frontfall, and copy no code, assets, maps or text from them. Third-party assets must be public domain, CC0 or MIT-compatible, and listed in [CREDITS.md](CREDITS.md). The full policy, and the CI check that enforces it, are in [docs/clean-room.md](docs/clean-room.md).

## Rules of the engine

The simulation runs on every client and must give exactly the same result everywhere.

- Use the seeded `Random` from `@frontfall/engine`, never `Math.random`.
- Never read the clock (`Date`, `performance`) in `packages/engine`.
- Use integer arithmetic for game state. Functions such as `Math.sin` or `Math.pow` can differ in the last bit between browsers and are rejected.
- Neighbours and distances come from the grid, never from index arithmetic: the world wraps east to west.
- Every engine change comes with tests, citing the rule identifiers it implements (`R-ATTACK-03`).

ESLint enforces the first three rules, and the engine compiles without browser or Node types.

## Pull requests

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
2. Keep the change focused; split unrelated work into separate pull requests.
3. Title in [Conventional Commits](https://www.conventionalcommits.org/) form, for example `feat(engine): add troop growth`. CI checks it.
4. Make sure `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` and `pnpm build` pass. CI runs the same commands, plus the end-to-end tests (`pnpm build && pnpm test:e2e`, after a one-time `pnpm --filter @frontfall/e2e exec playwright install chromium`) and the clean-room scan. A pre-commit hook formats and lints the files you stage.
5. Fill in the template. Say how you checked the change, and separate what you **verified** (a test, a measurement, something you saw in game) from what is a **hypothesis** (a reasoned guess you could not confirm). Reviewers rely on that distinction.

Pull requests are squash-merged once CI is green and a maintainer has approved.

## Sign your commits off

Frontfall uses the [Developer Certificate of Origin](https://developercertificate.org/). Add a `Signed-off-by` line to each commit to certify that you wrote the change or have the right to submit it under the MIT license:

```sh
git commit -s -m "fix(client): keep the camera inside the map"
```

## Code style

Prettier formats, ESLint checks. Name things precisely, keep functions small, and write a comment only when it explains something the code cannot: a reason, a constraint, a trade-off.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## How changes reach main

`main` only accepts commits that are already green. CI and CodeQL run on every pushed branch; a branch is merged, by squashing a pull request or by fast-forwarding `main`, only after both pass on its last commit. Force-pushes and deletion of `main` are blocked, and its history stays linear.
