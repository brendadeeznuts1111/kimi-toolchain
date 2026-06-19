# {{PROJECT_NAME}}

> Replace this line with a one-line description of what this project does.

## Quickstart

```bash
bun install
bun run dev
bun run check:fast
```

## Scripts

| Command                       | What it does                                         |
| ----------------------------- | ---------------------------------------------------- |
| `bun run dev`                 | Start the dev server with hot reload                 |
| `bun run test`                | Run the full test suite                              |
| `bun run test:fast`           | Run unit tests only                                  |
| `bun run check`               | Full quality gate (format + lint + typecheck + test) |
| `bun run check:fast`          | Fast quality gate                                    |
| `bun run typecheck`           | TypeScript type checking                             |
| `bun run format`              | Format source with oxfmt                             |
| `bun run lint`                | Lint with oxlint + banned-terms check                |
| `bun run scan`                | Run upgrade-advisor scan                             |
| `bun run fix`                 | Auto-repair scaffolding (kimi-fix)                   |
| `bun run doctor`              | Full toolchain diagnostics (kimi-doctor)             |
| `bun run doctor:probe`        | Probe dashboard cards once (report only)             |
| `bun run doctor:probe:strict` | Probe cards; exit 1 if any not passing               |
| `bun run doctor:probe:serve`  | Start card probe cache server (`[doctor.probe].port`, default 5678) |

## Card probes

When a dashboard is running, card probes report live route health:

```bash
bun run dev                          # start app (optional)
bun run doctor:probe                 # one-shot table
kimi-doctor --probe-cards --json       # structured JSON
bun run doctor:probe:serve           # cache server — port from [doctor.probe] in dx.config.toml
kimi-doctor --serve-probe            # Herdr [doctor].tabs probe pane command
```

Configure port and refresh interval in `dx.config.toml` `[doctor.probe]` (scaffold default port **5678**, interval **15000** ms). Env `PROBE_SERVER_PORT` overrides TOML. Set `EXAMPLES_DASHBOARD_URL` / `HERDR_DASHBOARD_URL` in `.env` when auto-discovery on ports 3000 / 18412 is not enough. See `env.example` and [serve-probe.md](../../docs/references/serve-probe.md).

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict, ESNext)
- **Test runner:** `bun:test`
- **Formatter:** oxfmt
- **Linter:** oxlint

## Governance

Managed by [kimi-toolchain](https://github.com/brendadeeznuts1111/kimi-toolchain).
Run `kimi-governance score` to check project health.
