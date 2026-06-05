# kimi-toolchain

> Bun-native developer tooling: governance, diagnostics, security, and scaffolding
>
> `https://github.com/brendadeeznuts1111/kimi-toolchain`

## Install

```bash
# Global install (recommended)
bun install -g github:brendadeeznuts1111/kimi-toolchain

# Or clone and link
git clone https://github.com/brendadeeznuts1111/kimi-toolchain.git ~/kimi-toolchain
cd ~/kimi-toolchain
bun install -g .
bun run unify    # sync → ~/.kimi-code/, install PATH wrappers, validate
```

See **UNIFIED.md** for how Kimi Code (`kimi`), kimi-toolchain (`kimi-doctor`), and `~/.kimi-code/` relate.

**Zero-install alternative** — run any command without installing:

```bash
bunx github:brendadeeznuts1111/kimi-toolchain kimi-doctor
bunx github:brendadeeznuts1111/kimi-toolchain kimi-governance score
```

> See [Bun documentation](https://bun.sh/docs/cli/bunx) for `bunx` usage.

## Commands

### Core

| Command                       | Description                     |
| ----------------------------- | ------------------------------- |
| `kimi-doctor`                 | Full toolchain diagnostics      |
| `kimi-fix <path> [--dry-run]` | Auto-repair project scaffolding |

### Project Scripts

| Command                      | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `bun run doctor`             | Run kimi-doctor from repo                           |
| `bun run fix`                | Run kimi-fix from repo                              |
| `bun run governance`         | Run kimi-governance from repo                       |
| `bun run test`               | Full test suite (unit + smoke; default 5s timeout)  |
| `bun run test:fast`          | Unit tests only at `--timeout 100` (~90ms)          |
| `bun run test:coverage`      | Full suite with Bun coverage report                 |
| `bun run test:coverage:fast` | Unit coverage at 100ms timeout (R-Score gate)       |
| `bun run test:coverage:ci`   | Full suite + coverage (60s timeout, lcov, `--bail`) |
| `bun run check`              | format:check + lint + typecheck + test (CI/hooks)   |
| `bun run check:fast`         | Same gates; unit tests at `--timeout 100`           |
| `bun run check:dry-run`      | List check steps without running them               |
| `bun run typecheck`          | TypeScript type check (no emit)                     |
| `bun run format`             | Format with oxfmt (write)                           |
| `bun run format:check`       | Verify formatting (CI gate)                         |
| `bun run format:check:ci`    | Format check with `--threads=4` (GitHub Actions)    |
| `bun run lint`               | Lint with oxlint + banned-terms scan                |
| `bun run lint:terms`         | Scan docs for banned internal branding tags         |
| `bun run sync`               | Sync repo to `~/.kimi-code/`                        |
| `bun run sync:daemon`        | Sync on cron (every 5 min)                          |
| `bun run unify`              | Sync runtime, wrappers, validate                    |
| `bun run install-wrappers`   | Install `~/.local/bin/kimi-*` wrappers              |
| `bun run memory-check`       | Shell memory pressure snapshot                      |
| `bun run memory-budget`      | Per-app RSS breakdown via kimi-doctor               |

### Governance

| Command                         | Description                                  |
| ------------------------------- | -------------------------------------------- |
| `kimi-governance score`         | Compute R-Score for current project          |
| `kimi-governance fix`           | Auto-generate missing governance files       |
| `kimi-governance coverage [N]`  | Test coverage gate (threshold %, default 70) |
| `kimi-governance docs`          | Detect README ↔ package.json script drift    |
| `kimi-governance adr "<title>"` | Scaffold a new ADR in `docs/adr/`            |

### Security

| Command                | Description                         |
| ---------------------- | ----------------------------------- |
| `kimi-guardian check`  | Lockfile integrity & CVE scan       |
| `kimi-guardian sign`   | Baseline lockfile hash              |
| `kimi-guardian verify` | Verify lockfile against stored hash |

### Memory & Sessions

| Command                                 | Description                             |
| --------------------------------------- | --------------------------------------- |
| `kimi-memory doctor`                    | Session store health check              |
| `kimi-memory trends`                    | Persistent warning tracking across runs |
| `kimi-memory store <id> [decisions...]` | Save a session snapshot                 |
| `kimi-memory recall [limit]`            | Show recent sessions                    |
| `kimi-memory resume`                    | Check if last session is stale          |
| `kimi-memory autosave [start\|stop]`    | Auto-save every 30s                     |
| `kimi-memory graph`                     | Show project knowledge graph            |
| `kimi-memory impact <node-id>`          | Cross-project impact analysis           |
| `kimi-memory search <query>`            | Search knowledge nodes                  |
| `kimi-memory prune [days]`              | Remove old sessions (default 30)        |

### Git Hooks

| Command                 | Description                         |
| ----------------------- | ----------------------------------- |
| `kimi-githooks install` | Install pre-commit + pre-push hooks |
| `kimi-githooks doctor`  | Check hook installation health      |
| `kimi-githooks fix`     | Re-install missing/outdated hooks   |

### Context & Release

| Command                      | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `kimi-context-gen scan`      | Scan project and generate CONTEXT.md         |
| `kimi-context-gen update`    | Regenerate CONTEXT.md                        |
| `kimi-context-gen freshness` | Check if CONTEXT.md is stale                 |
| `kimi-release changelog`     | Generate changelog from conventional commits |
| `kimi-release semver`        | Compute next semantic version                |
| `kimi-release validate`      | Validate commit message format               |

### Resource Governor

| Command                              | Description                      |
| ------------------------------------ | -------------------------------- |
| `kimi-resource-governor limits`      | Show current resource limits     |
| `kimi-resource-governor parallel`    | Show parallel execution slots    |
| `kimi-resource-governor spawn <cmd>` | Run command with resource limits |
| `kimi-resource-governor cache`       | Show diagnostic cache status     |
| `kimi-resource-governor status`      | Overall governor status          |

### Debug

| Command              | Description               |
| -------------------- | ------------------------- |
| `kimi-debug last`    | Show last failure         |
| `kimi-debug diff`    | Compare last two failures |
| `kimi-debug trace`   | Trace execution path      |
| `kimi-debug analyze` | Analyze failure pattern   |

### Snapshot

| Command                        | Description               |
| ------------------------------ | ------------------------- |
| `kimi-snapshot save`           | Save environment snapshot |
| `kimi-snapshot restore <id>`   | Restore from snapshot     |
| `kimi-snapshot list`           | List available snapshots  |
| `kimi-snapshot show <id>`      | Show snapshot details     |
| `kimi-snapshot cleanup [days]` | Remove old snapshots      |

## Project Structure

```
src/
  bin/          # CLI tools (kimi-doctor, kimi-governance, etc.)
  lib/          # Shared utilities (utils.ts)
  hooks/        # postinstall.ts, pre-push
  guardian/     # Lockfile verifier
  drift/        # Dependency drift detector
```

Live runtime at `~/.kimi-code/` (managed by postinstall hook).

## Governance

- R-Score: run `kimi-governance score`
- License: MIT
- [CONTRIBUTING.md](./CONTRIBUTING.md)

## Safety

- No secrets in source. Use `Bun.env` or `Bun.secrets`.
- Validate all external input at system boundaries.
