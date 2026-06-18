# Project Templates

Elite-grade templates. No hardcoded ports. No brittle assumptions. Bun-native by default.

## CONTEXT.md Template

```markdown
# CONTEXT — {Project Name}

## Domain

What problem does this project solve? Who uses it? What is the single source of truth for data?

## Architecture
```

[High-level diagram or description of layers/data flow]

````

## Tech Stack

| Layer | Choice | Version | Rationale |
|-------|--------|---------|-----------|
| Runtime | Bun | `>=1.3.14` | Native APIs, fast test runner |
| Formatter | oxfmt | latest | Bun-native, Prettier-compatible |
| Linter | oxlint | latest | Fast correctness checks |
| Framework | | | |
| Database | | | |
| Deploy | | | |

## Key Decisions

| Decision | Context | Rejected Alternatives |
|----------|---------|----------------------|
| | | |

## Environment

Required env vars. **Never commit `.env`**. Always provide `.env.example`:

| Var | Purpose | Required? | Default |
|-----|---------|-----------|---------|
| `PORT` | HTTP server port | No | `0` (auto-assign) |
| `DATABASE_URL` | DB connection | Yes | — |
| `LOG_LEVEL` | debug/info/warn/error | No | `info` |

## Commands

```bash
# Dev — auto-assigns port, prints URL
bun run dev

# Test — fail-fast (--bail), unit files concurrent via bunfig
bun run test
bun run test:fast           # unit only @ 100ms
bun run check:fast          # format + lint + typecheck + test:fast

# Typecheck — no emit, strict
bun run typecheck

# Format — write (local) / check (CI)
bun run format
bun run format:check

# Lint — oxlint correctness
bun run lint

# Toolchain fix — auto-repair scaffolding
bun run fix
````

## Port Policy

- **Default to `0`** for auto-assignment. Log the actual port on startup.
- If a fixed port is required, read from `PORT` env var. Document collision handling.
- Never hardcode ports in source. Use `Bun.serve({ port: Number(Bun.env.PORT) || 0 })`.

## Safety

- No secrets in source. Use `Bun.env` or `Bun.secrets`.
- No `eval()`, `new Function()`, or dynamic imports from untrusted input.
- Validate external input with narrow interfaces, type guards, parser checks, and focused tests before adding schema packages.

## Governance

| Check              | Status | Notes                                |
| ------------------ | ------ | ------------------------------------ |
| LICENSE            |        | MIT / Apache-2.0 / BSD — add file    |
| CONTRIBUTING.md    |        | PR process, code style, testing      |
| CODEOWNERS         |        | `@username` for critical paths       |
| CHANGELOG.md       |        | Keep a Changelog format              |
| README.md          |        | Quickstart, badges, links            |
| CONTEXT.md         |        | This file — architecture & decisions |
| AGENTS.md          |        | Project agent guide (kimi-fix)       |
| CODE_REFERENCES.md |        | Local exemplar map for agent coding  |
| `.oxfmtrc.json`    |        | oxfmt formatter config               |
| `tsconfig.json`    |        | Bun bundler mode strict TS           |
| `bunfig.toml`      |        | Trusted deps + test coverage gates   |
| `.kimi-code/`      |        | Project MCP stub + skills dir        |

Run `bun run ~/.kimi-code/tools/kimi-governance.ts score` to check project health.

## Decisions

No ADRs yet. Create one: `bun run ~/.kimi-code/tools/kimi-governance.ts adr "<title>"`

## Notes

[Anything else an agent needs to know: conventions, gotchas, tribal knowledge]

````

## .oxfmtrc.json Template

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5",
  "ignorePatterns": ["bun.lock", "CHANGELOG.md"]
}
````

## .oxlintrc.json Template

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc"],
  "categories": {
    "correctness": "error"
  },
  "rules": {},
  "env": {
    "builtin": true
  }
}
```

## package.json Scripts Template

```json
{
  "scripts": {
    "test": "bun run scripts/run-tests.ts",
    "test:fast": "bun run scripts/run-tests.ts --fast",
    "test:coverage": "bun run scripts/run-tests.ts --coverage",
    "test:coverage:ci": "bun run scripts/run-tests.ts --ci --coverage",
    "check": "bun run scripts/check.ts",
    "check:fast": "bun run scripts/check.ts --fast",
    "check:dry-run": "bun run scripts/check.ts --dry-run",
    "docs:sync": "bun run scripts/readme-sync.ts --fix",
    "typecheck": "tsc --noEmit",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check -c .oxfmtrc.json .",
    "format:check:ci": "oxfmt --check --threads=4 -c .oxfmtrc.json .",
    "lint": "oxlint src test scripts && bun run scripts/lint-banned-terms.ts",
    "lint:terms": "bun run scripts/lint-banned-terms.ts"
  },
  "devDependencies": {
    "oxfmt": "latest",
    "oxlint": "latest",
    "typescript": "latest",
    "@types/bun": "latest"
  }
}
```

Install: `bun add -d oxfmt oxlint typescript @types/bun`

## tsconfig.json Template

Bun bundler mode — per [Bun TypeScript docs](https://bun.com/docs/runtime/typescript):

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["bun"]
  },
  "include": ["src/**/*", "test/**/*", "scripts/**/*"]
}
```

Run type checking separately: `bun run typecheck` (`tsc --noEmit`). Bun runtime does not typecheck.

## src/bun-globals.d.ts Template

Temporary shims for Bun 1.3+ runtime APIs ahead of `bun-types`. Remove entries as `@types/bun` catches up:

```typescript
/// <reference types="bun" />

declare module "bun" {
  const cwd: string;
  const pid: number;

  interface BunFile {
    textSync(encoding?: string): string;
  }
}

interface ReadableStream<R = any> {
  [Symbol.asyncIterator](): AsyncIterator<R>;
}
```

## .env.example Template

```bash
# ── Required ──
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
API_KEY=replace_me_in_dot_env

# ── Optional ──
# PORT=0                    # 0 = auto-assign. Override only if needed.
# LOG_LEVEL=info            # debug | info | warn | error
# NODE_ENV=development      # development | test | production
# BUN_RUNTIME_TRANSPILER_CACHE_PATH=./.bun-cache
```

## bunfig.toml Template

```toml
[install]
# Policy tables (official | hardened | current): src/lib/bun-install-config.ts
optional = true
dev = true
peer = true
production = false
dryRun = false
saveTextLockfile = true
frozenLockfile = true
exact = false
ignoreScripts = false
concurrentScripts = 8
linker = "isolated"
globalDir = "~/.bun/install/global"
globalBinDir = "~/.bun/bin"
minimumReleaseAge = 259200
minimumReleaseAgeExcludes = ["@types/bun", "@types/node", "typescript"]

[install.cache]
dir = "~/.bun/install/cache"

[test]
# Unit tests run concurrently; smoke tests stay sequential
concurrentTestGlob = ["test/*.unit.test.ts"]
coverageSkipTestFiles = true

coverageThreshold = { lines = 0.35, functions = 0.25 }
```

## dx.config.toml Template

Authoritative sources — do not duplicate stale inline blocks here:

| Profile | Scaffold file | Notes |
| ------- | ------------- | ----- |
| **app** (default) | `templates/scaffold/dx.config.app.toml` | Standard DX/CI/quality |
| **toolchain** | `templates/scaffold/dx.config.toolchain.toml` | Adds `[finishWork]`, `[herdr]`, finish-work scripts |
| Live reference | `dx.config.toml` in kimi-toolchain | Full runtime sync + `ci:local` blocks |

`kimi-fix` renders `{{DX_AGENTS_PATH}}` from `$HOME/.config/dx/AGENTS.md`. Herdr symlink chain and finish-work loader: [CODE_REFERENCES.md](CODE_REFERENCES.md) § DX Workspace Layout.

### Scaffold profiles (`kimi-fix`)

| Profile | Command | `dx.config` source | Extras |
|---------|---------|-------------------|--------|
| **app** (default) | `kimi-fix <path>` | `templates/scaffold/dx.config.app.toml` | Standard DX/CI/quality — no `[sync]`, `ci:local`, `[finishWork]`, or `[herdr]` |
| **toolchain** | `kimi-fix <path> --profile toolchain` | `templates/scaffold/dx.config.toolchain.toml` | `[finishWork]`, `[herdr]`, `scripts/finish-work.ts` |

Full runtime sync/ci.local blocks live only in the **kimi-toolchain reference** `dx.config.toml`, not in scaffold templates.

**Effect gates (canonical):** Use `kimi-doctor --effect-gates` in `[agents].prePush` and `[finishWork].gates` everywhere — scaffold templates and live `dx.config.toml` match. `bun run doctor` in `package.json` is an in-tree dev alias only; do not put it in gate config.

**Profile drift:** `kimi-fix` never overwrites existing `dx.config.toml` or finish-work scripts. Re-scaffolding with a different `--profile` logs a warning; delete the stale files and re-run, or scaffold into a fresh tree.

**finish-work staging:** `git add -u` only (tracked files). Untracked files and secrets are never blanket-staged.

### Migrating to the toolchain profile

App → toolchain: back up custom `dx.config.toml`, remove stale scaffold files, run `kimi-fix <path> --profile toolchain`, verify `bun run finish-work --dry-run` lists `kimi-doctor --effect-gates` (not `bun run doctor --effect-gates`). Details: [CODE_REFERENCES.md](CODE_REFERENCES.md) § DX Workspace Layout.

### Herdr project profile (`[herdr]`)

Authoritative `[herdr]` blocks: `templates/scaffold/dx.config.toolchain.toml` and live `dx.config.toml`. Layout model, symlink chain, finish-work scripts, and `herdr-project` contract: [CODE_REFERENCES.md](CODE_REFERENCES.md) § Herdr orchestration / DX Workspace Layout. Production validation scope: `docs/SCOPE.md`.

```bash
bun run finish-work --dry-run
bun run finish-work --message "feat: workspace layout" --push
```

## CHANGELOG.md Template

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

-

### Changed

-

### Deprecated

-

### Removed

-

### Fixed

-

### Security

-
```

## CODEOWNERS Template

```
# Global owner
* @username

# Critical paths
/src/core/ @username
/docs/adr/ @username
```

## AGENTS.md Minimal Template

Generated by `kimi-fix` via `buildAgentsMd()` in `src/lib/scaffold-agents.ts` (title from `package.json` `name`). Customize the one-line project description after scaffold. Tests: `test/scaffold-agents.unit.test.ts`.

## CI Workflow Template (`.github/workflows/ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read
  checks: write
  pull-requests: write

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Format check
        run: bun run format:check:ci

      - name: Lint
        run: bun run lint

      - name: Type check
        run: bun run typecheck

      - name: Test + coverage
        run: bun run test:coverage:ci
```

> **Server CI status:** For this repository, GitHub Actions is disabled because the account is locked due to a billing issue. The workflow template above is preserved for reference and for new projects, but the active enforcement surface is `bun run ci:local` and the pre-push hooks installed by `kimi-githooks install`. The disabled workflow is archived at `.github/workflows-disabled/ci.yml`.

## Tool invocation & Bun-native patterns

Cross-tool calls, logging, SQLite, spawn limits, and Bun API choices: [CODE_REFERENCES.md](CODE_REFERENCES.md) and `~/.kimi-code/AGENTS.md` § Bun-native coding standards.

## Kimi Code MCP — user `~/.kimi-code/mcp.json`

Toolchain seeds this via `bun run sync`. Manual reference:

```json
{
  "mcpServers": {
    "unified-shell": {
      "command": "/absolute/path/to/bun",
      "args": ["run", "/Users/you/.kimi-code/tools/unified-shell-bridge.ts"],
      "env": {
        "TERMINAL_BINDING_ENABLED": "true",
        "KIMI_SHELL_MODE": "unified"
      }
    }
  }
}
```

Tool exposed to Kimi: `mcp__unified-shell__execute`. See `templates/kimi-config-permissions.toml` for `config.toml` permission rules.

## Kimi Code MCP — project `.kimi-code/mcp.json`

Project entries override user-level servers with the same name:

```json
{
  "mcpServers": {}
}
```

Scaffolded by `kimi-fix`. Only add stdio servers in trusted repos.

## IDE ACP (Zed / JetBrains)

Kimi Code ACP wiring (`kimi acp`, absolute path to `~/.kimi-code/bin/kimi`): `skills/kimi-toolchain/SKILL.md` and [UNIFIED.md](UNIFIED.md) § Editor workflows. Run `kimi login` once before first IDE session.

## bun create Template (`templates/bun-create/kimi-toolchain/`)

Minimal skeleton for `bun create kimi-toolchain <name>`. One file only:

```
templates/bun-create/kimi-toolchain/
└── package.json    ← bun-create.postinstall: toolchain → kimi-fix
```

The template is intentionally minimal — `kimi-fix` generates everything else (tsconfig, bunfig, README, entry point, AGENTS.md, dx.config, scripts, .kimi-code/). See `templates/scaffold/` for all templates that `kimi-fix` deploys.

The template delegates hardening to a two-step `bun-create.postinstall`:

```json
{
  "name": "kimi-toolchain",
  "bun-create": {
    "postinstall": [
      "bun install -g github:brendadeeznuts1111/kimi-toolchain",
      "kimi-fix ."
    ]
  }
}
```

After `bun create` copies the skeleton, `bun-create.postinstall` runs:
1. `bun install -g` ensures toolchain is available (idempotent — fast no-op if already installed)
2. `kimi-fix .` — injects hardened bunfig, tsconfig, oxfmt/oxlint, AGENTS.md, dx.config.toml, src/index.ts, README.md, scripts/, .kimi-code/, governance fix, guardian fix, githooks install, devDeps (@types/bun, oxfmt, oxlint, typescript)

The `bun-create` section is auto-stripped from the destination `package.json` by Bun.

### Install

```bash
cp -r templates/bun-create/kimi-toolchain ~/.bun-create/kimi-toolchain
```

Or set `BUN_CREATE_DIR` to point at the repo: `export BUN_CREATE_DIR="$HOME/kimi-toolchain/templates/bun-create"`

### Usage

```bash
bun create kimi-toolchain my-app
cd my-app
bun run check:fast
```

### AI agent rules

`bun init` auto-generates `CLAUDE.md` (Claude CLI) and `.cursor/rules/*.mdc` (Cursor) when those tools are detected. `kimi-fix` generates `AGENTS.md` (agent-agnostic, includes DX layer references) but does not generate Claude- or Cursor-specific files. To add them after scaffold, run `bun init -y` (non-destructive).

See [bun create docs](https://bun.com/docs/runtime/templating/create) for the full local-template execution flow (destructive overwrite, `bun-create` hooks, `git init`, framework auto-detection).
