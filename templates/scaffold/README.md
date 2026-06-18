# {{PROJECT_NAME}}

> Replace this line with a one-line description of what this project does.

## Quickstart

```bash
bun install
bun run dev
bun run check:fast
```

## Scripts

| Command              | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `bun run dev`        | Start the dev server (auto-assign port)              |
| `bun run test`       | Run the full test suite                              |
| `bun run test:fast`  | Run unit tests only (~2s)                            |
| `bun run check`      | Full quality gate (format + lint + typecheck + test) |
| `bun run check:fast` | Fast quality gate (~3s)                              |
| `bun run typecheck`  | TypeScript type checking                             |
| `bun run format`     | Format source with oxfmt                             |
| `bun run lint`       | Lint with oxlint + banned-terms check                |

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict, ESNext)
- **Test runner:** `bun:test`
- **Formatter:** oxfmt
- **Linter:** oxlint

## Governance

Managed by [kimi-toolchain](https://github.com/brendadeeznuts1111/kimi-toolchain).
Run `kimi-governance score` to check project health.
