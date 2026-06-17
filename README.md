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
bun run unify    # sync to ~/.kimi-code/, install PATH wrappers, validate
```

**Cursor:** open `~/kimi-toolchain` or `kimi-toolchain.code-workspace`.

See **UNIFIED.md** for how Kimi Code (`kimi`), kimi-toolchain (`kimi-doctor`), and `~/.kimi-code/` relate.

## New project

```bash
kimi-new my-app              # mkdir + bun init + kimi-fix
cd my-app
bun run check:fast
kimi login
kimi-doctor --quick
```

**Zero-install alternative** — run any command without installing:

```bash
bunx github:brendadeeznuts1111/kimi-toolchain kimi-doctor
bunx github:brendadeeznuts1111/kimi-toolchain kimi-governance score
```

> See [Bun documentation](https://bun.sh/docs/cli/bunx) for `bunx` usage.

## Commands

Run `bun run docs:sync` to audit README ↔ `package.json` script drift.

| `bun run lint:skills` | (synced from package.json) |
| `bun run scope:run` | (synced from package.json) |
| `bun run skills:table` | (synced from package.json) |
| `bun run lint:tochange` | (synced from package.json) |
| `bun run frontmatter` | (synced from package.json) |
### Core

| Command                        | Description                           |
| ------------------------------ | ------------------------------------- |
| `kimi-toolchain <tool> [...]`  | Unified router for toolchain commands |
| `kimi-doctor`                  | Full toolchain diagnostics            |
| `kimi-new <name> [--path dir]` | Create and scaffold a new Bun project |
| `kimi-fix <path> [--dry-run]`  | Auto-repair project scaffolding       |
| `kimi-fix doctor [path]`       | Check scaffold completeness           |

### Project Scripts

| Command                      | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `bun run doctor`             | Run kimi-doctor from repo                           |
| `bun run fix`                | Run kimi-fix from repo                              |
| `bun run new`                | Run kimi-new from repo                              |
| `bun run governance`         | Run kimi-governance from repo                       |
| `bun run test`               | Full test suite (unit + smoke; default 30s timeout) |
| `bun run test:fast`          | Unit tests only at 1500ms timeout (`test-gates.ts`) |
| `bun run test:coverage`      | Full suite with Bun coverage report                 |
| `bun run test:coverage:fast` | Unit coverage at 1500ms timeout (R-Score gate)    |
| `bun run test:coverage:ci`   | Full suite + coverage (60s timeout, lcov, `--bail`) |
| `bun run check`              | format:check + lint + typecheck + test (CI/hooks)   |
| `bun run check:fast`         | Same gates; unit tests at 1500ms timeout            |
| `bun run check:dry-run`      | List check steps without running them               |
| `bun run docs:sync`          | Patch README script table from package.json         |
| `bun run typecheck`          | TypeScript type check (no emit)                     |
| `bun run format`             | Format with oxfmt (write)                           |
| `bun run format:check`       | Verify formatting (CI gate)                         |
| `bun run format:check:ci`    | Format check with `--threads=4` (GitHub Actions)    |
| `bun run lint`               | Lint with oxlint + banned-terms scan                |
| `bun run lint:terms`         | Scan docs for banned internal branding tags         |
| `bun run sync`               | Sync repo assets and manifest to `~/.kimi-code/`    |
| `bun run sync:verify`        | Verify runtime files match the repo sync manifest   |
| `bun run sync:daemon`        | Sync on cron (every 5 min)                          |
| `bun run unify`              | Sync runtime, wrappers, validate                    |
| `bun run install-wrappers`   | Install `~/.local/bin/kimi-*` wrappers              |
| `bun run memory-check`       | Shell memory pressure snapshot                      |
| `bun run memory-budget`      | Per-app RSS breakdown via kimi-doctor               |

### Toolchain maintenance

| Command | Description |
| ------- | ----------- |
| `bun run verify-workspace` | Fail if cwd folder is not `kimi-toolchain` |
| `bun run cleanup-legacy` | Audit stale clone paths and Cursor slugs |
| `bun run cleanup-root` | Trim repo-root clutter |
| `bun run push` | Git push + runtime sync |
| `bun run bench` | Run `bench/core.bench.ts` |
| `bun run ci:local` | Local CI mirror (gates + coverage + governance) |
| `bun run finish-work` | Gates + optional commit/push close-loop |
| `bun run check:staged` | Fast gates on staged files only |
| `bun run lint:context` | Agent-doc bloat lint (`scripts/lint-context-bloat.ts`) |
| `bun run lint:taxonomy-coverage` | Error taxonomy coverage audit |
| `bun run manifest:generate` | Regenerate constants manifest |
| `bun run docs:sync` | README script drift check/patch |
| `bun run references:generate` | Regenerate `canonical-references.json` ecosystem link manifest |
| `bun run pr:diff` | PR diff helper |
| `bun run pr:status` | PR status helper |
| `bun run test:smoke` | Smoke CLI tests only |
| `bun run test:ci` | CI test profile |
| `bun run test:flake-hunt` | Flaky test hunt profile |
| `bun run test:shuffle` | Shuffled test order profile |
| `bun run test:pattern` | Pattern-filtered test runner |
| `bun run install-herdr-plugin` | Install Herdr kimi-toolchain plugin |
| `bun run bun-native:check` | Bun-native lint check |
| `bun run bun-native:report` | Bun-native migration report |
| `bun run bun-native:rules` | Bun-native lint rules |
| `bun run bun-native:batch` | Bun-native batch lint |
| `bun run bun-native:baseline` | Bun-native baseline snapshot |
| `bun run bun-native:migrate-imports` | Bun-native import codemod |
| `bun run bun-native:migrate-fs` | Bun-native fs codemod |

When tools, docs, skills, or generated runtime assets change, final handoff
validation includes `bun run sync && bun run sync:verify`.

### Governance

| Command                         | Description                                  |
| ------------------------------- | -------------------------------------------- |
| `kimi-governance score`         | Compute R-Score for current project          |
| `kimi-governance fix`           | Auto-generate missing governance files       |
| `kimi-governance coverage [N]`  | Test coverage gate (threshold %, default 70) |
| `kimi-governance docs`          | Detect README ↔ package.json script drift    |
| `kimi-governance adr "<title>"` | Scaffold a new ADR in `docs/adr/`            |

### Security

| Command                         | Description                                 |
| ------------------------------- | ------------------------------------------- |
| `kimi-guardian check`           | Lockfile integrity & CVE scan               |
| `kimi-guardian sign`            | Baseline lockfile hash                      |
| `kimi-guardian verify`          | Verify lockfile against stored hash         |
| `kimi-cloudflare-access status` | Read-only Cloudflare/DX/MCP local inventory |
| `kimi-cloudflare-access login`  | Store Cloudflare credentials in OS keychain |
| `kimi-cloudflare-access logout` | Remove stored Cloudflare credentials        |
| `kimi-cloudflare-access`        | Service token expiry sweep                  |
| `kimi-cloudflare-access apps`   | Access application policy audit             |
| `kimi-cloudflare-access fix`    | Rotate expired/expiring Cloudflare tokens   |

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

### Introspection & Self-Healing

| Command                         | Description                            |
| ------------------------------- | -------------------------------------- |
| `kimi-heal plan [--json]`       | Propose safe repair actions            |
| `kimi-heal apply --action <id>` | Apply a selected repair action         |
| `kimi-heal clusters [--json]`   | Summarize failure clusters             |
| `kimi-decision graph <traceId>` | Show the decision graph for a trace    |
| `kimi-decision why <id>`        | Explain recorded rationale + evidence  |
| `kimi-decision audit [--json]`  | Find low-quality or unverified entries |

### Snapshot

| Command                        | Description               |
| ------------------------------ | ------------------------- |
| `kimi-snapshot save`           | Save environment snapshot |
| `kimi-snapshot restore <id>`   | Restore from snapshot     |
| `kimi-snapshot list`           | List available snapshots  |
| `kimi-snapshot show <id>`      | Show snapshot details     |
| `kimi-snapshot cleanup [days]` | Remove old snapshots      |

## Project Structure

Layout maps: [AGENTS.md](./AGENTS.md#architecture) and [UNIFIED.md](./UNIFIED.md).
Live runtime at `~/.kimi-code/` is synced via `bun run sync` (`scripts/sync-to-desktop.ts` writes `toolchain-manifest.json`).

## Governance

- R-Score: `kimi-governance score --preflight --quick`
- License: MIT — [CONTRIBUTING.md](./CONTRIBUTING.md)
- Success metrics — **Drift latency**, **Error coverage**, **Integration agility**: [AGENTS.md](./AGENTS.md#success-metrics) (`kimi-doctor --success-metrics`). The metrics are not frozen; threshold changes need release cadence alignment and failure ledger evidence.

## Cloudflare API Token Setup

The `kimi-cloudflare-access` tool reads credentials from `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` environment variables, or from the OS keychain via `kimi-cloudflare-access login`.

`kimi-cloudflare-access status --json` is the read-only local inventory path for the DX homepage/dashboard. It reports credential presence, MCP wiring, Wrangler availability, identity profile coverage, project config files, diagnostics, and the DX Cloudflare contract without calling the Cloudflare API. The default path checks whether `wrangler` is available without spawning it; add `--versions` when version details are needed.

### Required token permissions

Create a dedicated API token at https://dash.cloudflare.com/profile/api-tokens with these permissions:

| Permission             | Commands                                |
| ---------------------- | --------------------------------------- |
| None                   | `status`                                |
| Account > Access: Read | `tokens`, `apps`, `doctor`, `dashboard` |
| Account > Access: Edit | `fix` (rotate service tokens)           |

### Login / logout

```bash
# Interactively store credentials in the OS keychain
kimi-cloudflare-access login

# Remove stored credentials
kimi-cloudflare-access logout
```

Credentials are stored with `Bun.secrets` under the service name `kimi-toolchain`. The first run may prompt for keychain access.

### CI / env-var override

For CI or non-TTY environments, set environment variables instead of using `login`:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
kimi-cloudflare-access doctor
```

Environment variables take precedence over stored credentials.

### Auth compatibility

Wrangler OAuth tokens and the Kimi Code Cloudflare MCP server authenticate through separate flows. They cannot be used by this CLI. Use a dedicated Cloudflare API token with the permissions above.

## Safety

- No secrets in source. Use `Bun.env` or `Bun.secrets`.
- Validate all external input at system boundaries.
