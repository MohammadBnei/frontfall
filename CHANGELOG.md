# Changelog

All notable changes to Frontfall are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project foundations: deterministic engine (seeded random generator, world grid that wraps east-west), turn relay server with lobbies, Three.js map view with endless east-west panning, CI, container image and automated deployment.
- Game rules specification ([docs/rules.md](docs/rules.md)) with rule identifiers, and starting balance values ([docs/balance.md](docs/balance.md)).
- Architecture decision records: deterministic lockstep, topology, renderer split, hosting under a sub-path.
- Clean-room policy and a CI job that compares every pull request with the reference codebase, by tokens for code and by hash for other files.
- End-to-end tests of the built game at `/` and under `/frontfall/`, run in CI and against the public server after each deployment.
- `/healthz` reports the running build in the `X-Frontfall-Version` header; the deployment waits for the new version to answer.
- Images are tagged with the version on `v*` tags.
- WebSocket connections are limited per player address, and the number of open games is capped.
- Pre-commit hook that formats and lints staged files.
- Map proposal issue form.

### Changed

- The engine compiles without browser or Node types, and its lint rules also reject `Date`, `crypto` and floating-point `Math` functions whose results vary between browsers.
- Node.js 24 is required.
- Static files are served with cache headers: hashed assets are immutable, the page is revalidated.
