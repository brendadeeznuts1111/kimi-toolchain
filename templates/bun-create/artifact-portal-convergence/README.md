---
title: "README"
tags: [templates]
category: meta
status: draft
priority: medium
---
# {{name}}

Artifact Portal convergence workspace — one `BenchmarkApiEnvelope` across Canvas, Dashboard, and Herdr, persisted under `.kimi/artifacts/artifact-portal/`.

Scaffolded from [kimi-toolchain](https://github.com/brendadeeznuts1111/kimi-toolchain). **Must live inside the kimi-toolchain git tree** (or set `KIMI_PROJECT_ROOT`).

## Quickstart

```bash
bun run portal:local          # offline publish (--local-only)
bun run verify                # convergence smoke test
bun run hooks:install         # symlink pre-push guard
```

## Pre-push guard (convergence only)

Portal slices install **only** the convergence pre-push guard. `hooks:install` **removes** pre-commit/commit-msg/other hooks and does **not** install format or typecheck. Inside kimi-toolchain (shared git), install is skipped — use `bun run test:portal-convergence` instead.

Every `git push` runs one deterministic check: `build:portal --local-only --json` + `jq` (`converged: true`, three components). No format, lint, or repo-wide `bun test`.

```bash
bun run hooks:install
# delegates to scripts/hooks-portal-install.sh at the kimi-toolchain repo root
```

Canonical hook: `scripts/pre-push-portal.sh`. Install SSOT: `scripts/hooks-portal-install.sh`.

## Commands

| Script          | Purpose                                    |
| --------------- | ------------------------------------------ |
| `portal:local`  | Publish diagnostics + manifest (offline)   |
| `portal`        | Probe-first publish (needs dashboard)      |
| `portal:json`   | Machine-readable build report              |
| `verify`        | Run `test/portal-convergence.unit.test.ts` |
| `status`        | List saved portal artifacts                |
| `hooks:install` | Install pre-push convergence guard         |

## Convergence contract

- Envelope: `BenchmarkApiEnvelope` with `metadata.convergence`
- Manifest: `convergedComponents: ["canvas","dashboard","herdr"]`
- Contract: `contracts/artifact-portal.json`

Deep dive: `examples/artifact-portal.md` in the parent repo.

## Live probe (optional)

```bash
# from kimi-toolchain root
PORT=5678 bun run dashboard -- --daemon --port=5678
bun run portal
curl -s http://127.0.0.1:5678/api/effect-benchmark | jq '.runner, .metadata.convergence'
```
## Related

- [INDEX.md](../INDEX.md) — Documentation index
